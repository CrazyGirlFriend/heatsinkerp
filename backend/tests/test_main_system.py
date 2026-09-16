import io
import json
from pathlib import Path
from dataclasses import replace
from email.message import Message
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit
from unittest.mock import Mock

import pytest
from sqlalchemy import func, select

from app import main_system
from app.config import settings
from app.database import SessionLocal
from app.models import MaterialTransfer
from app.schemas import MaterialTransferDocumentFields
from test_warehouse_receipts import warehouse


def record(**changes):
    document = dict.fromkeys(MaterialTransferDocumentFields.model_fields)
    document.update(material_name="铜钼 CuMo70", product_code="P-001", part_no="J-001",
                    source_batch_no="RAW-001", customer_code="C-001",
                    finished_specification="30×20×2 mm", transfer_specification="32×22×2 mm",
                    technical_requirements="按图纸交付", special_process="表面清洁",
                    material_shape="片", outsourced_unit="外协甲", material_description="测试物料",
                    purpose_category="散热", category_level3="钼铜片", order_category="正式订单",
                    finished_quantity=500, material_type="semi_finished")
    return {"schema_version": "1.0", "serial_no": "001-A/中文", "revision": "17",
            "updated_at": "2026-09-15T08:30:00+08:00", "active": True,
            "document": document, **changes}


class Reply(io.BytesIO):
    status = 200

    def __init__(self, raw, content_type="application/json"):
        super().__init__(raw)
        self.headers = Message()
        self.headers["Content-Type"] = content_type


@pytest.fixture
def upstream(monkeypatch):
    monkeypatch.setattr(main_system, "settings", replace(settings,
        main_system_base_url="https://erp.example.test", main_system_token="test-only-token"))
    opener = Mock()
    opener.open.side_effect = lambda *args, **kwargs: Reply(json.dumps(record()).encode())
    monkeypatch.setattr(main_system, "build_opener", lambda *handlers: opener)
    return opener


def test_lookup_is_authenticated_uncached_and_never_creates_inventory(client, upstream):
    client.headers.pop("Authorization")
    assert client.get('/api/main-system/serial-material', params={'serial_no': 'x'}).status_code == 401
    assert not upstream.open.called
    login = client.post('/api/auth/login', json={'username': 'admin', 'password': 'Admin123!'}).json()
    response = client.get('/api/main-system/serial-material', params={'serial_no': '001-A/中文'},
                          headers={'Authorization': 'Bearer ' + login['access_token']})
    assert response.status_code == 200, response.text
    assert response.headers['cache-control'] == 'no-store'
    assert response.json()['document'] == record()['document']
    assert len(response.json()['snapshot_hash']) == 64
    request = upstream.open.call_args.args[0]
    assert urlsplit(request.full_url).path == '/api/integration/v1/serial-materials'
    assert parse_qs(urlsplit(request.full_url).query) == {'serial_no': ['001-A/中文']}
    assert request.get_header('Authorization') == 'Bearer test-only-token'
    assert request.get_header('X-request-id')
    with SessionLocal() as db:
        assert db.scalar(select(func.count(MaterialTransfer.id))) == 0


@pytest.mark.parametrize('upstream_status,expected', [(404,404), (401,502), (403,502), (429,503), (500,502), (302,502)])
def test_upstream_errors_are_sanitized(client, upstream, upstream_status, expected):
    upstream.open.side_effect = HTTPError('https://private/secret', upstream_status, 'secret', {}, io.BytesIO(b'private details'))
    response = client.get('/api/main-system/serial-material?serial_no=ABC')
    assert response.status_code == expected
    assert 'secret' not in response.text and 'private' not in response.text
    if upstream_status == 401:
        assert response.json()['detail'] == 'main system credentials were rejected'
    if upstream_status == 403:
        assert response.json()['detail'] == 'main system credentials lack read permission'


@pytest.mark.parametrize('error,expected', [(TimeoutError(),504), (URLError(TimeoutError()),504), (URLError('private'),502), (ConnectionResetError(),502)])
def test_transport_errors(client, upstream, error, expected):
    upstream.open.side_effect = error
    assert client.get('/api/main-system/serial-material?serial_no=A').status_code == expected


@pytest.mark.parametrize('change', ['missing-field', 'wrong-type', 'wrong-serial', 'naive-time', 'numeric-time', 'wrong-version', 'extra-field', 'blank-material'])
def test_invalid_contract_is_rejected(client, upstream, change):
    value = record()
    if change == 'missing-field': value['document'].pop('part_no')
    if change == 'wrong-type': value['document']['finished_quantity'] = '500'
    if change == 'wrong-serial': value['serial_no'] = 'other'
    if change == 'naive-time': value['updated_at'] = '2026-09-15T08:30:00'
    if change == 'numeric-time': value['updated_at'] = 1726341000
    if change == 'wrong-version': value['schema_version'] = '2.0'
    if change == 'extra-field': value['document']['unknown'] = 'x'
    if change == 'blank-material': value['document']['material_name'] = '  '
    upstream.open.side_effect = lambda *a, **kw: Reply(json.dumps(value).encode())
    response = client.get('/api/main-system/serial-material', params={'serial_no': '001-A/中文'})
    assert response.status_code == 502, response.text


@pytest.mark.parametrize('raw,content_type', [(b'x'*65537,'application/json'), (b'<html>','text/html'), (b'bad','application/json')])
def test_response_size_content_and_json(client, upstream, raw, content_type):
    upstream.open.side_effect = lambda *a, **kw: Reply(raw, content_type)
    assert client.get('/api/main-system/serial-material?serial_no=A').status_code == 502


def test_disabled_and_blank_queries(client, monkeypatch):
    monkeypatch.setattr(main_system, 'settings', replace(settings, main_system_base_url=''))
    assert client.get('/api/main-system/serial-material?serial_no=A').status_code == 503
    assert client.get('/api/main-system/serial-material', params={'serial_no': '  '}).status_code == 422


@pytest.mark.parametrize('values', [
    {'main_system_base_url':'http://example.test', 'main_system_token':'x'},
    {'main_system_base_url':'https://user:pass@example.test', 'main_system_token':'x'},
    {'main_system_base_url':'https://example.test?a=b', 'main_system_token':'x'},
    {'main_system_base_url':'https://example.test:invalid', 'main_system_token':'x'},
    {'main_system_base_url':'https://example.test', 'main_system_token':''},
    {'main_system_base_url':'https://example.test', 'main_system_token':'x\r\nInjected: yes'},
    {'main_system_timeout_seconds':0}, {'main_system_timeout_seconds':31},
])
def test_secure_configuration(values):
    with pytest.raises(ValueError): replace(settings, **values)


def receipt_payload(client):
    value = client.get('/api/main-system/serial-material', params={'serial_no':'001-A/中文'}).json()
    return {'serial_no':value['serial_no'], 'expected_snapshot_hash':value['snapshot_hash'],
            'material_type':'semi_finished', 'quantity':100, 'weight':'10.125',
            'notes':'实物清点入库', 'idempotency_key':'master-receipt-1'}


def test_intake_snapshots_full_master_and_retries_without_upstream(client, warehouse, upstream):
    payload = receipt_payload(client)
    url = f"/api/main-system/warehouses/{warehouse['team']['id']}/receipts"
    first = client.post(url, headers=warehouse['headers'], json=payload)
    assert first.status_code == 201, first.text
    saved = first.json()
    for key, value in record()['document'].items():
        assert saved[key] == value
    assert saved['quantity'] == 100 and saved['weight'] == 10.125
    assert saved['locked'] and saved['status'] == 'received'
    assert saved['history'][0]['changes']['main_system_revision']['after'] == '17'
    assert saved['history'][0]['changes']['main_system_snapshot_hash']['after'] == payload['expected_snapshot_hash']
    upstream.open.side_effect = TimeoutError()
    repeated = client.post(url, headers=warehouse['headers'], json=payload)
    assert repeated.status_code == 201 and repeated.json() == saved
    assert client.post(url, headers=warehouse['headers'], json={**payload,'quantity':101}).status_code == 409
    assert client.get(warehouse['url']).json()['total'] == 1
    # Existing dispatch workflow inherits all customer fields without another main-system request.
    dispatched = client.post(f"/api/team-materials/{warehouse['team']['id']}/dispatches", headers=warehouse['headers'], json={
        'next_team_id':warehouse['other']['id'], 'idempotency_key':'dispatch-master',
        'lines':[{'source_transfer_id':saved['id'], 'quantity':20, 'weight':'2.000'}]})
    assert dispatched.status_code == 201, dispatched.text
    for key, value in record()['document'].items():
        assert dispatched.json()['items'][0][key] == value


@pytest.mark.parametrize('change', ['changed','inactive','tampered','admin','other-team','timeout'])
def test_intake_rejects_changed_or_forged_material_without_stock(client, warehouse, upstream, change):
    payload = receipt_payload(client)
    url = f"/api/main-system/warehouses/{warehouse['team']['id']}/receipts"
    headers = warehouse['headers']
    expected = 409
    if change == 'changed': upstream.open.side_effect = lambda *a, **kw: Reply(json.dumps(record(revision='18')).encode())
    if change == 'inactive': upstream.open.side_effect = lambda *a, **kw: Reply(json.dumps(record(active=False)).encode())
    if change == 'tampered': payload['customer_code'] = 'FORGED'; expected = 422
    if change == 'admin': headers = {}; expected = 403
    if change == 'other-team': headers = warehouse['other_headers']; expected = 403
    if change == 'timeout': upstream.open.side_effect = TimeoutError(); expected = 504
    response = client.post(url, headers=headers, json=payload)
    assert response.status_code == expected, response.text
    assert client.get(warehouse['url']).json()['total'] == 0


def test_redirect_handler_does_not_forward_credentials():
    assert main_system.NoRedirects().redirect_request(None,None,302,'',{},'https://other.test') is None


def test_schema_requires_every_document_key():
    schema = main_system.MainSystemSerial.model_json_schema()
    assert set(schema['$defs']['MainSystemDocument']['required']) == set(MaterialTransferDocumentFields.model_fields)
    root = Path(__file__).resolve().parents[2]
    published = json.loads((root / 'docs/contracts/main-system-serial.schema.json').read_text())
    assert schema == published
    provider = json.loads((root / 'docs/contracts/main-system-provider.openapi.json').read_text())
    document_schema = provider['components']['schemas']['MainSystemDocument']
    assert document_schema == schema['$defs']['MainSystemDocument']
    provider_schema = provider['components']['schemas']['MainSystemSerial']
    expected = {key: value for key, value in schema.items() if key != '$defs'}
    expected = json.loads(json.dumps(expected).replace('#/$defs/', '#/components/schemas/'))
    assert provider_schema == expected
    text = (root / 'docs/main-system-integration.md').read_text()
    example = text.split('```json\n', 1)[1].split('\n```', 1)[0]
    assert main_system.MainSystemSerial.model_validate_json(example).serial_no == '001-A/中文'


@pytest.mark.parametrize('changed', [
    {'quantity':-1}, {'quantity':1.5}, {'quantity':0,'weight':0}, {'weight':'1.2345'},
    {'notes':'  '}, {'expected_snapshot_hash':'wrong'}, {'next_team_id':3},
])
def test_invalid_intake_never_calls_main_system(client, warehouse, upstream, changed):
    payload = receipt_payload(client)
    upstream.reset_mock()
    url = f"/api/main-system/warehouses/{warehouse['team']['id']}/receipts"
    assert client.post(url, headers=warehouse['headers'], json={**payload,**changed}).status_code == 422
    assert not upstream.open.called
    assert client.get(warehouse['url']).json()['total'] == 0
