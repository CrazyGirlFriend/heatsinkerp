"""Warehouse intake ownership, immutable stock origins, and ledger continuity."""
import importlib.util
from pathlib import Path
from unittest.mock import patch

import pytest
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine, func, inspect, select
from sqlalchemy.exc import IntegrityError

from app.database import SessionLocal, engine as app_engine
from app.models import MaterialTransfer, MaterialTransferEvent, TransferBatchNumberSequence
from test_material_transfers import _leader, _team


@pytest.fixture()
def warehouse(client):
    response = client.post('/api/teams', json={'code': 'FACTORY-WAREHOUSE', 'name': '库房', 'kind': 'warehouse'})
    assert response.status_code == 201, response.text
    team = response.json()
    _, headers = _leader(client, 'warehouse-leader', team['id'])
    other = _team(client, 'ROLL', '轧制')
    _, other_headers = _leader(client, 'rolling-leader', other['id'])
    return {'team': team, 'headers': headers, 'other': other, 'other_headers': other_headers,
            'url': f"/api/team-materials/{team['id']}/receipts"}


def intake(client, setup, **overrides):
    return client.post(setup['url'], headers=setup['headers'], json={
        'serial_no': 'WAREHOUSE-001', 'material_name': '铜钼', 'material_type': 'semi_finished',
        'quantity': 100, 'weight': '10.125', 'notes': '外部来料，实物清点后手工入库',
        'source_batch_no': 'RAW-001', 'idempotency_key': 'warehouse-intake-1', **overrides,
    })


def test_manual_intake_is_a_locked_stock_origin_not_a_self_transfer(client, warehouse):
    response = intake(client, warehouse)
    assert response.status_code == 201, response.text
    receipt = response.json()
    assert receipt['entry_kind'] == 'warehouse_receipt'
    assert receipt['source_team'] is None and receipt['source_team_id'] is None
    assert receipt['source_transfer_id'] is None and receipt['dispatch_no'] is None
    assert receipt['next_team']['id'] == warehouse['team']['id']
    assert receipt['status'] == 'received' and receipt['stock_tracked'] and receipt['locked']
    assert receipt['allowed_actions'] == [] and receipt['version'] == 1
    assert receipt['barcode_payload'] == receipt['batch_no'] and receipt['barcode_type'] == 'CODE128'
    assert receipt['created_at'] == receipt['received_at']
    assert [event['action'] for event in receipt['history']] == ['stocked']
    assert receipt['history'][0]['changes']['entry_kind']['after'] == 'warehouse_receipt'
    detail_url = f"/api/material-transfers/{receipt['batch_no']}"
    assert client.get(detail_url).json() == receipt
    assert client.patch(detail_url, headers=warehouse['headers'], json={'quantity': 200}).status_code == 403
    assert client.delete(detail_url, headers=warehouse['headers']).status_code == 403
    assert client.post(detail_url+'/confirm', headers=warehouse['headers'], json={'idempotency_key': 'double-receive'}).status_code == 409
    base = f"/api/team-materials/{warehouse['team']['id']}"
    overview = client.get(base+'/overview').json()
    assert overview['totals']['available_quantity'] == 100
    assert overview['totals']['available_weight'] == 10.125
    assert overview['pending_incoming']['count'] == 0
    assert client.get(base+'/dispatches').json()['total'] == 0
    assert client.get(base+'/stock').json()['items'][0]['transfer']['id'] == receipt['id']


def test_only_the_bound_warehouse_leader_can_intake(client, warehouse):
    payload = {'serial_no': 'WH', 'material_name': '铜', 'material_type': 'semi_finished',
               'quantity': 1, 'weight': 1, 'notes': '验收', 'idempotency_key': 'denied'}
    assert client.post(warehouse['url'], json=payload).status_code == 403
    assert client.post(warehouse['url'], headers=warehouse['other_headers'], json=payload).status_code == 403
    other_url = f"/api/team-materials/{warehouse['other']['id']}/receipts"
    assert client.post(other_url, headers=warehouse['other_headers'], json=payload).status_code == 403
    assert client.get(other_url).status_code == 403
    with SessionLocal() as db:
        assert db.scalar(select(func.count(MaterialTransfer.id))) == 0


@pytest.mark.parametrize('invalid', [
    {'serial_no': '  '}, {'material_name': '  '}, {'material_type': None},
    {'quantity': 0, 'weight': 0}, {'quantity': -1}, {'quantity': 1.5},
    {'weight': '1.1234'}, {'notes': '  '}, {'idempotency_key': '  '},
    {'next_team_id': 1}, {'source_team_id': 1}, {'entry_kind': 'transfer'}, {'status': 'pending'},
])
def test_invalid_or_forged_intake_does_not_add_stock(client, warehouse, invalid):
    assert intake(client, warehouse, **invalid).status_code == 422
    assert client.get(warehouse['url']).json()['total'] == 0


def test_intake_retry_is_idempotent_and_different_payload_conflicts(client, warehouse):
    first = intake(client, warehouse).json()
    retry = intake(client, warehouse)
    assert retry.status_code == 201 and retry.json() == first
    assert intake(client, warehouse, quantity=101).status_code == 409
    assert client.get(warehouse['url']).json()['total'] == 1
    with SessionLocal() as db:
        assert db.scalar(select(func.count(MaterialTransferEvent.id))) == 1
        assert db.scalar(select(TransferBatchNumberSequence.last_value)) == 1
    # An idempotency key belonging to another kind of operation is not reused.
    created = client.post('/api/material-transfers', headers=warehouse['headers'], json={
        'serial_no': 'NORMAL', 'next_team_id': warehouse['other']['id'],
        'quantity': 1, 'weight': 1, 'idempotency_key': 'ordinary-transfer'})
    assert created.status_code == 201, created.text
    assert intake(client, warehouse, idempotency_key='ordinary-transfer').status_code == 409


def test_intake_audit_failure_rolls_back_number_and_stock(client, warehouse):
    with patch('app.warehouse_receipts.workflow._record_event', side_effect=RuntimeError('audit failed')):
        assert intake(client, warehouse).status_code == 500
    with SessionLocal() as db:
        assert db.scalar(select(func.count(MaterialTransfer.id))) == 0
        assert db.scalar(select(func.count(TransferBatchNumberSequence.sequence_date))) == 0
    assert intake(client, warehouse).status_code == 201


def test_first_response_and_audit_use_persisted_database_time_precision(client, warehouse):
    # Model a database that stores seconds rather than Python microseconds.
    with app_engine.begin() as conn:
        conn.exec_driver_sql("""CREATE TRIGGER intake_second_precision AFTER INSERT ON material_transfers
            WHEN NEW.entry_kind = 'warehouse_receipt' BEGIN
            UPDATE material_transfers SET created_at=DATETIME(NEW.created_at),
                updated_at=DATETIME(NEW.updated_at), received_at=DATETIME(NEW.received_at)
                WHERE id=NEW.id; END""")
    first = intake(client, warehouse)
    assert first.status_code == 201, first.text
    receipt = first.json()
    retry = intake(client, warehouse).json()
    assert receipt == retry
    assert receipt == client.get(f"/api/material-transfers/{receipt['batch_no']}").json()
    assert receipt['history'][0]['occurred_at'] == receipt['received_at']
    assert receipt['history'][0]['changes']['created_at']['after'] == receipt['created_at'].replace('Z', '+00:00')


def test_intake_dispatch_loss_receipt_and_return_keep_source_and_balances(client, warehouse):
    receipt = intake(client, warehouse).json()
    base = f"/api/team-materials/{warehouse['team']['id']}"
    outgoing = client.post(base+'/dispatches', headers=warehouse['headers'], json={
        'next_team_id': warehouse['other']['id'], 'idempotency_key': 'dispatch-from-intake',
        'lines': [{'source_transfer_id': receipt['id'], 'quantity': 30, 'weight': '3.000'}]})
    assert outgoing.status_code == 201, outgoing.text
    line = outgoing.json()['items'][0]
    assert line['entry_kind'] == 'transfer' and line['source_team']['id'] == warehouse['team']['id']
    assert line['source_transfer_id'] == receipt['id'] and line['serial_no'] == receipt['serial_no']
    assert client.post(base+'/losses', headers=warehouse['headers'], json={
        'source_transfer_id': receipt['id'], 'quantity': 2, 'weight': '.125',
        'reason': '清点丢失', 'idempotency_key': 'intake-loss'}).status_code == 201
    overview = client.get(base+'/overview').json()['totals']
    assert overview['available_quantity'] == 68 and overview['available_weight'] == 7
    confirmed = client.post(f"/api/material-transfers/{line['batch_no']}/confirm", headers=warehouse['other_headers'],
                            json={'idempotency_key': 'receive-dispatch'})
    assert confirmed.status_code == 200, confirmed.text
    assert client.get(base+'/overview').json()['totals']['dispatched_quantity'] == 30
    back = client.post(f"/api/team-materials/{warehouse['other']['id']}/dispatches", headers=warehouse['other_headers'], json={
        'next_team_id': warehouse['team']['id'], 'idempotency_key': 'return-to-warehouse',
        'lines': [{'source_transfer_id': line['id'], 'quantity': 10, 'weight': 1}]})
    assert back.status_code == 201, back.text
    back_line = back.json()['items'][0]
    assert client.get(base+'/overview').json()['pending_incoming']['count'] == 1
    assert client.post(f"/api/material-transfers/{back_line['batch_no']}/confirm", headers=warehouse['headers'],
                       json={'idempotency_key': 'warehouse-receive-return'}).status_code == 200
    assert client.get(base+'/overview').json()['totals']['available_quantity'] == 78
    assert client.get(base+'/overview').json()['totals']['available_weight'] == 8
    assert client.get(warehouse['url']).json()['total'] == 2  # Unified ledger includes received workshop transfers.
    assert client.get(warehouse['url'], params={'receipt_source': 'external'}).json()['total'] == 1
    assert client.get(warehouse['url'], params={'receipt_source': 'internal'}).json()['total'] == 1
    trace = client.get('/api/material-transfers', params={'serial_no': receipt['serial_no']}).json()['items']
    assert [row['entry_kind'] for row in trace] == ['warehouse_receipt', 'transfer', 'transfer']
    assert [row['source_transfer_id'] for row in trace] == [None, receipt['id'], line['id']]


def test_intake_list_filters_pagination_and_weight_only_stock(client, warehouse):
    first = intake(client, warehouse, quantity=0, weight='2.125', material_type='sludge', material_name='铜_泥%').json()
    assert first['quantity'] == 0 and first['weight'] == 2.125
    second = intake(client, warehouse, idempotency_key='intake-2', serial_no='WH-2').json()
    response = client.get(warehouse['url'], params={'query': '_泥%', 'material_type': 'sludge'}).json()
    assert response['total'] == 1 and response['items'][0]['id'] == first['id']
    response = client.get(warehouse['url'], params={'page': 1, 'page_size': 1}).json()
    assert response['total'] == 2 and response['items'][0]['id'] == second['id']
    assert client.get(warehouse['url'], params={'page': 0}).status_code == 422


def migration(filename):
    path = Path(__file__).parents[1] / 'alembic/versions' / filename
    spec = importlib.util.spec_from_file_location(filename, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize('partial', [False, True])
def test_migration_retains_old_batches_children_audit_losses_and_indexes(tmp_path, partial):
    engine = create_engine(f"sqlite:///{tmp_path / 'warehouse.sqlite'}")
    with engine.begin() as conn:
        conn.exec_driver_sql('CREATE TABLE teams (id INTEGER PRIMARY KEY)')
        conn.exec_driver_sql('CREATE TABLE users (id INTEGER PRIMARY KEY)')
        conn.exec_driver_sql('INSERT INTO teams VALUES (1),(2)')
        with Operations.context(MigrationContext.configure(conn)):
            for filename in ('20260906_0004_material_transfers.py', '20260906_0005_transfer_document.py',
                             '20260906_0006_transfer_query_indexes.py', '20260906_0007_team_material_stock.py'):
                migration(filename).upgrade()
        conn.exec_driver_sql("""INSERT INTO material_transfers
            (id,batch_no,serial_no,source_team_id,source_team_code,source_team_name,
             next_team_id,next_team_code,next_team_name,quantity,weight,status,created_by,created_at,updated_at,stock_tracked)
            VALUES (1,'TL-OLD','OLD-SERIAL',1,'A','历史上序',2,'B','历史下序',10,1.250,'received','原操作人',
                    '2026-09-01 00:00:00','2026-09-01 00:00:00',1),
                   (2,'TL-CHILD','OLD-SERIAL',2,'B','历史下序',1,'A','历史上序',2,.250,'pending','原操作人',
                    '2026-09-01 00:00:00','2026-09-01 00:00:00',0)""")
        conn.exec_driver_sql('UPDATE material_transfers SET source_transfer_id=1 WHERE id=2')
        conn.exec_driver_sql("INSERT INTO material_transfer_events (transfer_id,action,actor,occurred_at,changes) VALUES (1,'received','原操作人','2026-09-01 00:00:00','{}')")
        conn.exec_driver_sql("""INSERT INTO material_losses (loss_no,source_transfer_id,team_id,quantity,weight,reason,idempotency_key,request_hash,created_by,created_at)
            VALUES ('LOSS-OLD',1,2,1,.100,'历史丢失','old-loss','hash','原操作人','2026-09-01 00:00:00')""")
        before = conn.exec_driver_sql('SELECT * FROM material_transfers ORDER BY id').mappings().all()
        before_indexes = {row['name'] for row in inspect(conn).get_indexes('material_transfers')}
        if partial:
            conn.exec_driver_sql("ALTER TABLE material_transfers ADD COLUMN entry_kind VARCHAR(24) NOT NULL DEFAULT 'transfer'")
        upgrade = migration('20260906_0008_warehouse_receipts.py')
        with Operations.context(MigrationContext.configure(conn)):
            upgrade.upgrade()
            upgrade.upgrade()
        after = conn.exec_driver_sql('SELECT * FROM material_transfers ORDER BY id').mappings().all()
        assert [{key: new[key] for key in old} for old, new in zip(before, after)] == [dict(row) for row in before]
        assert all(row['entry_kind'] == 'transfer' for row in after)
        assert conn.exec_driver_sql('SELECT COUNT(*) FROM material_transfer_events').scalar_one() == 1
        assert conn.exec_driver_sql('SELECT COUNT(*) FROM material_losses').scalar_one() == 1
        indexes = {row['name'] for row in inspect(conn).get_indexes('material_transfers')}
        assert before_indexes | {'ix_mt_intake_created'} <= indexes
        assert conn.exec_driver_sql('PRAGMA foreign_key_check').fetchall() == []
        with pytest.raises(IntegrityError):
            with conn.begin_nested():
                conn.exec_driver_sql("UPDATE material_transfers SET source_team_id=NULL WHERE id=1")
        with pytest.raises(RuntimeError, match='backup'):
            upgrade.downgrade()
    engine.dispose()
