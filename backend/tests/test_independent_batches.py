"""Each submitted material row owns its barcode, receipt and history."""
from datetime import datetime
from sqlalchemy import select, func, create_engine, inspect
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

from app.database import SessionLocal
from app.models import MaterialDispatch, MaterialTransfer
from historical_dispatch import historical_response
from test_warehouse_receipts import warehouse, intake, migration
from test_warehouse_classification import base, dispatch, confirm


def test_split_materials_and_serials_create_independent_batches_and_replay_once(client, warehouse):
    s = warehouse
    a = intake(client, s, serial_no='000012').json()
    b = intake(client, s, serial_no='000013', idempotency_key='second-origin').json()
    payload = {'next_team_id': s['other']['id'], 'idempotency_key': 'independent-submit', 'lines': [
        {'source_transfer_id': a['id'], 'quantity': 20, 'weight': 2, 'material_type': 'semi_finished'},
        {'source_transfer_id': a['id'], 'quantity': 10, 'weight': 1, 'material_type': 'finished'},
        {'source_transfer_id': b['id'], 'quantity': 5, 'weight': .5, 'material_type': 'semi_finished'}]}
    url = base(s) + '/outbound-batches'
    response = client.post(url, headers=s['headers'], json=payload)
    assert response.status_code == 201, response.text
    result = response.json()
    assert set(result) == {'items'}
    assert client.post(url, headers=s['headers'], json=payload).json() == result
    rows = result['items']
    assert len({row['batch_no'] for row in rows}) == 3
    assert all(row['barcode_payload'] == row['batch_no'] and row['dispatch_no'] is None for row in rows)
    assert [row['serial_no'] for row in rows] == ['000012', '000012', '000013']
    with SessionLocal() as db:
        assert db.scalar(select(func.count(MaterialDispatch.id))) == 1
        assert db.scalar(select(func.count(MaterialDispatch.id)).where(MaterialDispatch.dispatch_no.is_not(None))) == 0
    # Receiving one batch does not confirm or lock another batch from the same submission.
    assert confirm(client, s, {'items': [rows[0]]}, workshop=True).status_code == 200
    updated = client.patch('/api/material-transfers/' + rows[1]['batch_no'], headers=s['headers'],
        json={'quantity': 8, 'weight': .8, 'expected_version': rows[1]['version']})
    assert updated.status_code == 200, updated.text
    assert client.get('/api/material-transfers/' + rows[0]['batch_no']).json()['locked']
    assert client.get('/api/material-transfers/' + rows[2]['batch_no']).json()['status'] == 'pending'
    assert client.get(url).json()['total'] == 3
    assert client.get(url, params={'status': 'received'}).json()['total'] == 1
    assert client.get(url, params={'status': 'partial'}).status_code == 422
    assert client.post(url, headers=s['headers'], json={**payload, 'notes': 'changed'}).status_code == 409


def test_scrap_receipt_and_outbound_filters_keep_exhausted_zero_piece_batches(client, warehouse):
    s = warehouse
    scrap = intake(client, s, serial_no='000005', material_type='scrap_chips', quantity=0, weight='1.235').json()
    good = intake(client, s, idempotency_key='good', material_type='finished', quantity=2, weight='.500').json()
    response = dispatch(client, s, [{'source_transfer_id': scrap['id'], 'quantity': 0, 'weight': '1.235'},
        {'source_transfer_id': good['id'], 'quantity': 2, 'weight': '.500'}], next_team_id=None,
        entry_kind='warehouse_outbound', external_destination='回收及外部交接', notes='废屑回收')
    rows = response.json()['items']
    assert confirm(client, s, {'items': [rows[0]]}, external=True).status_code == 200
    with SessionLocal() as db:
        db.get(MaterialTransfer, rows[0]['id']).created_at = datetime(2026, 9, 17, 16)
        db.get(MaterialTransfer, rows[1]['id']).created_at = datetime(2026, 9, 18, 16)
        db.commit()
    filters = {'material_type': 'scrap_chips', 'date_from': '2026-09-18', 'date_to': '2026-09-18', 'page_size': 1}
    page = client.get(base(s) + '/outbound-batches', params=filters).json()
    assert page['total'] == 1 and page['items'][0]['batch_no'] == rows[0]['batch_no']
    assert page['items'][0]['quantity'] == 0 and page['items'][0]['weight'] == 1.235
    assert client.get(base(s) + '/outbound-batches', params={**filters, 'page': 2}).json()['items'] == []
    assert client.get(base(s) + '/outbound-batches', params={**filters, 'status': 'pending'}).json()['total'] == 0
    assert client.get(base(s) + '/outbound-batches', params={**filters, 'query': '000005'}).json()['total'] == 1
    assert client.get(base(s) + '/outbound-batches', params={**filters, 'query': '%'}).json()['total'] == 0
    assert client.get(base(s) + '/outbound-batches', params={'material_type': 'invalid'}).status_code == 422
    assert client.get(base(s) + '/receipts', params={'material_type': 'scrap_chips'}).json()['total'] == 1
    assert client.get(base(s) + '/stock', params={'availability': 'dispatchable', 'material_type': 'scrap_chips'}).json()['total'] == 0


def test_historical_ck_scan_keeps_identifiers_but_current_outbound_lists_each_batch(client, warehouse):
    s = warehouse
    source = intake(client, s).json()
    group = historical_response(client, dispatch(client, s, [
        {'source_transfer_id': source['id'], 'quantity': 10, 'weight': 1},
        {'source_transfer_id': source['id'], 'quantity': 20, 'weight': 2}])).json()
    assert client.get('/api/material-dispatches/' + group['dispatch_no']).status_code == 200
    page = client.get(base(s) + '/outbound-batches').json()
    assert page['total'] == 2
    assert {row['batch_no'] for row in page['items']} == {row['batch_no'] for row in group['items']}
    assert all(row['barcode_payload'] == row['batch_no'] for row in page['items'])


def test_nullable_submission_migration_keeps_historical_numbers_and_child_links(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'independent.sqlite'}")
    with engine.begin() as conn:
        conn.exec_driver_sql('CREATE TABLE material_dispatches (id INTEGER PRIMARY KEY, dispatch_no VARCHAR(32) NOT NULL UNIQUE)')
        conn.exec_driver_sql('CREATE TABLE material_transfers (id INTEGER PRIMARY KEY, dispatch_id INTEGER REFERENCES material_dispatches(id), batch_no TEXT)')
        conn.exec_driver_sql("INSERT INTO material_dispatches VALUES (1, 'CK-OLD')")
        conn.exec_driver_sql("INSERT INTO material_transfers VALUES (1, 1, 'TL-OLD')")
        with Operations.context(MigrationContext.configure(conn)):
            module = migration('20260918_0014_independent_batches.py')
            module.upgrade(); module.upgrade()
        assert next(c for c in inspect(conn).get_columns('material_dispatches') if c['name'] == 'dispatch_no')['nullable']
        conn.exec_driver_sql('INSERT INTO material_dispatches VALUES (2, NULL), (3, NULL)')
        assert conn.exec_driver_sql('SELECT * FROM material_transfers').one() == (1, 1, 'TL-OLD')
        assert conn.exec_driver_sql('SELECT dispatch_no FROM material_dispatches WHERE id=1').scalar_one() == 'CK-OLD'
        assert conn.exec_driver_sql('PRAGMA foreign_key_check').fetchall() == []
    engine.dispose()
