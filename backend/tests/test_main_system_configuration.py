import importlib.util
from dataclasses import replace
from pathlib import Path
from unittest.mock import Mock

import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException
from sqlalchemy import select, func, create_engine, inspect
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

from app import main_system, main_system_configuration as config
from app.database import SessionLocal
from app.models import MainSystemConfiguration, MaterialTransfer
from sqlalchemy.dialects import mysql
from sqlalchemy.schema import CreateTable
from test_main_system import record
from test_material_transfers import _team, _leader

URL = '/api/main-system/configuration'


@pytest.fixture
def prepared(client, monkeypatch):
    monkeypatch.setattr(config, 'settings', replace(config.settings,
        main_system_config_key=Fernet.generate_key().decode(), main_system_base_url='', main_system_token='',
        main_system_allowed_origins='https://erp.example.test,https://second.example.test'))
    return client


def save(client, **changes):
    return client.put(URL, json={'enabled':False,'base_url':'https://erp.example.test',
        'token':'private-test-token','timeout_seconds':5,'expected_version':0, **changes})


def test_only_admin_can_read_save_and_test(prepared):
    client = prepared
    group = _team(client,'ROLL','轧制')
    _, headers = _leader(client,'config-team',group['id'])
    assert client.get(URL, headers=headers).status_code == 403
    assert client.put(URL, headers=headers, json={}).status_code == 403
    assert client.post(URL+'/test', headers=headers, json={'serial_no':'A','expected_version':0}).status_code == 403
    client.headers.pop('Authorization')
    assert client.get(URL).status_code == 401


def test_encrypted_save_masking_blank_preserves_and_immediate_activation(prepared):
    client = prepared
    initial = client.get(URL)
    assert initial.json()['version'] == 0 and initial.json()['key_ready']
    assert initial.headers['cache-control'] == 'no-store'
    first = save(client, enabled=True)
    assert first.status_code == 200, first.text
    assert first.json()['version'] == 1 and first.json()['has_token']
    assert 'private-test-token' not in first.text
    with SessionLocal() as db:
        value = db.get(MainSystemConfiguration,1).token_ciphertext
        assert value != 'private-test-token'
        assert config.cipher().decrypt(value.encode()) == b'private-test-token'
    active = config.effective_settings()
    assert active.main_system_token == 'private-test-token'
    assert save(client, token='', expected_version=1, timeout_seconds=7).status_code == 200
    assert config.effective_settings().main_system_base_url == ''
    assert save(client, token='', enabled=True, expected_version=2).status_code == 200
    assert config.effective_settings().main_system_token == 'private-test-token'
    assert 'token_ciphertext' not in client.get(URL).text


def test_stale_version_and_new_address_require_explicit_credential(prepared):
    assert save(prepared).status_code == 200
    assert save(prepared).status_code == 409
    result = save(prepared, token='', base_url='https://second.example.test', expected_version=1)
    assert result.status_code == 422
    assert save(prepared, token='new-test-token', base_url='https://second.example.test', expected_version=1).status_code == 200


@pytest.mark.parametrize('changes', [
    {'base_url':'http://erp.example.test'}, {'base_url':'https://untrusted.example.test'},
    {'base_url':'https://erp.example.test@attacker.test'}, {'base_url':'https://erp.example.test:444'},
    {'base_url':'https://erp.example.test/path?token=x'}, {'token':'secret\ninjected'},
    {'timeout_seconds':31}, {'timeout_seconds':0}, {'enabled':True,'token':''},
    {'enabled':True,'base_url':''},
])
def test_invalid_configuration_is_not_saved(prepared, changes):
    response = save(prepared, **changes)
    assert response.status_code == 422, response.text
    assert prepared.get(URL).json()['version'] == 0


def test_validation_errors_never_echo_token(prepared):
    token = 'SENSITIVE-' * 1000
    response = save(prepared, token=token)
    assert response.status_code == 422 and 'SENSITIVE' not in response.text
    response = prepared.put(URL, json={'token':{'secret':'confidential'}})
    assert response.status_code == 422 and 'confidential' not in response.text


def test_missing_key_and_wrong_key_fail_closed(prepared, monkeypatch):
    saved_settings = config.settings
    monkeypatch.setattr(config,'settings',replace(saved_settings,main_system_config_key=''))
    assert not prepared.get(URL).json()['key_ready']
    assert save(prepared).status_code == 503
    monkeypatch.setattr(config,'settings',saved_settings)
    assert save(prepared,enabled=True).status_code == 200
    monkeypatch.setattr(config,'settings',replace(saved_settings,main_system_config_key=Fernet.generate_key().decode()))
    with pytest.raises(HTTPException) as exc: config.effective_settings()
    assert exc.value.status_code == 503
    assert save(prepared,expected_version=1,token='replacement',enabled=True).status_code == 200


def test_test_uses_saved_disabled_configuration_and_writes_no_stock(prepared, monkeypatch):
    assert save(prepared).status_code == 200
    master = main_system.MainSystemSerial.model_validate_json(__import__('json').dumps(record()))
    fetch = Mock(return_value=master)
    monkeypatch.setattr(main_system,'fetch_serial',fetch)
    result = prepared.post(URL+'/test',json={'serial_no':'001-A/中文','expected_version':1})
    assert result.status_code == 200, result.text
    assert result.json()['ok'] and result.json()['data']['document']['part_no'] == 'J-001'
    assert fetch.call_args.kwargs['connection'].main_system_token == 'private-test-token'
    assert 'private-test-token' not in result.text
    assert prepared.get(URL).json()['last_test_ok'] is True
    with SessionLocal() as db: assert db.scalar(select(func.count(MaterialTransfer.id))) == 0
    fetch.side_effect = HTTPException(502,'upstream-secret')
    failed = prepared.post(URL+'/test',json={'serial_no':'001-A/中文','expected_version':1})
    assert failed.status_code == 200 and not failed.json()['ok']
    assert 'upstream-secret' not in failed.text
    assert not prepared.get(URL).json()['last_test_ok']


@pytest.mark.parametrize('detail,message', [
    ('main system credentials were rejected', '主系统认证失败，访问令牌无效或已过期'),
    ('main system credentials lack read permission', '认证凭证无资料读取权限，请联系主系统管理员授权'),
])
def test_authentication_failure_is_actionable_without_exposing_credentials(prepared, monkeypatch, detail, message):
    assert save(prepared).status_code == 200
    monkeypatch.setattr(main_system, 'fetch_serial', Mock(side_effect=HTTPException(502, detail)))
    response = prepared.post(URL+'/test', json={'serial_no':'A','expected_version':1})
    assert response.status_code == 200
    assert response.json()['ok'] is False and response.json()['message'] == message
    assert prepared.get(URL).json()['last_test_message'] == message
    assert 'private-test-token' not in response.text


def test_late_test_does_not_overwrite_new_configuration(prepared, monkeypatch):
    assert save(prepared).status_code == 200
    def changing(*args, **kwargs):
        assert save(prepared,expected_version=1,token='replacement').status_code == 200
        raise HTTPException(504,'timeout')
    monkeypatch.setattr(main_system,'fetch_serial',changing)
    assert prepared.post(URL+'/test',json={'serial_no':'A','expected_version':1}).status_code == 409
    assert prepared.get(URL).json()['last_test_at'] is None


def test_empty_and_stale_tests_do_not_call_upstream(prepared, monkeypatch):
    fetch = Mock()
    monkeypatch.setattr(main_system,'fetch_serial',fetch)
    assert prepared.post(URL+'/test',json={'serial_no':'A','expected_version':0}).status_code == 409
    assert save(prepared).status_code == 200
    assert prepared.post(URL+'/test',json={'serial_no':'A','expected_version':0}).status_code == 409
    assert prepared.post(URL+'/test',json={'serial_no':'  ','expected_version':1}).status_code == 422
    assert not fetch.called


def test_singleton_primary_key_has_no_mysql_auto_increment(monkeypatch):
    table = MainSystemConfiguration.__table__
    assert 'AUTO_INCREMENT' not in str(CreateTable(table).compile(dialect=mysql.dialect()))
    path = Path(__file__).resolve().parents[1] / 'alembic/versions/20260915_0012_main_system_configuration.py'
    spec = importlib.util.spec_from_file_location('config_mysql_migration', path)
    migration = importlib.util.module_from_spec(spec); spec.loader.exec_module(migration)
    inspector = Mock()
    inspector.get_table_names.return_value = []
    inspector.get_columns.return_value = [{'name': column.name} for column in table.columns]
    monkeypatch.setattr(migration.sa, 'inspect', lambda bind: inspector)
    monkeypatch.setattr(migration.op, 'get_bind', lambda: None)
    create = Mock()
    monkeypatch.setattr(migration.op, 'create_table', create)
    migration.upgrade()
    name, *columns = create.call_args.args
    ddl = str(CreateTable(migration.sa.Table(name, migration.sa.MetaData(), *columns)).compile(dialect=mysql.dialect()))
    assert 'AUTO_INCREMENT' not in ddl and 'CHECK (id = 1)' in ddl


def test_migration_creation_and_retry_preserve_configuration():
    path = Path(__file__).resolve().parents[1] / 'alembic/versions/20260915_0012_main_system_configuration.py'
    spec = importlib.util.spec_from_file_location('config_migration',path)
    migration = importlib.util.module_from_spec(spec); spec.loader.exec_module(migration)
    engine = create_engine('sqlite:///:memory:')
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            connection.exec_driver_sql("INSERT INTO main_system_configuration (id,enabled,base_url,token_ciphertext,timeout_seconds,version,updated_by,updated_at) VALUES (1,0,'https://example.test','cipher',5,1,'Admin','2026-09-15')")
            migration.upgrade()
        assert connection.exec_driver_sql('SELECT token_ciphertext FROM main_system_configuration').scalar() == 'cipher'
        assert 'main_system_configuration' in inspect(connection).get_table_names()
    engine.dispose()
