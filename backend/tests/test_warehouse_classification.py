"""Mixed warehouse sources, split material natures, and receipt review."""
import importlib.util
from pathlib import Path

from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine, inspect

from test_warehouse_receipts import warehouse, intake


def base(setup, workshop=False):
    return f"/api/team-materials/{setup['other' if workshop else 'team']['id']}"


def dispatch(client, setup, lines, workshop=False, **extra):
    return client.post(base(setup, workshop) + '/dispatches', headers=setup['other_headers' if workshop else 'headers'], json={
        'next_team_id': setup['team' if workshop else 'other']['id'],
        'idempotency_key': 'workshop-dispatch' if workshop else 'warehouse-dispatch', 'lines': lines, **extra})


def confirm(client, setup, group, workshop=False, external=False):
    return client.post('/api/material-dispatches/' + group['dispatch_no'] + ('/confirm-outbound' if external else '/confirm'),
        headers=setup['other_headers' if workshop else 'headers'],
        json={'idempotency_key': 'receipt-' + group['dispatch_no'], 'expected_revision': group['revision']})


def test_external_sources_and_return_original_document_validation(client, warehouse):
    s = warehouse
    origin = intake(client, s, material_type='raw_material', external_source='供料单位').json()
    assert origin['receipt_kind'] == 'external' and origin['external_source'] == '供料单位'
    sent = dispatch(client, s, [{'source_transfer_id': origin['id'], 'quantity': 10, 'weight': 1}],
                    next_team_id=None, entry_kind='warehouse_outbound', external_destination='外委单位').json()
    params = dict(receipt_kind='return', external_source='外委单位', return_dispatch_no=sent['dispatch_no'], idempotency_key='return', quantity=5, weight=.5)
    assert intake(client, s, **params).status_code == 422  # Still unconfirmed outbound.
    assert confirm(client, s, sent, external=True).status_code == 200
    assert intake(client, s, **{**params, 'serial_no': 'OTHER'}).status_code == 422
    assert intake(client, s, **{**params, 'external_source': None}).status_code == 422
    returned = intake(client, s, **params)
    assert returned.status_code == 201, returned.text
    assert returned.json()['return_dispatch_no'] == sent['dispatch_no']
    assert intake(client, s, **params).json() == returned.json()
    rows = client.get(s['url'], params={'receipt_source': 'return', 'query': '外委单位'}).json()
    assert rows['total'] == 1 and rows['items'][0]['id'] == returned.json()['id']
    assert client.get(base(s) + '/overview').json()['totals']['available_quantity'] == 95


def test_split_one_source_into_good_and_scrap_without_double_deduction(client, warehouse):
    s = warehouse
    origin = intake(client, s).json()
    sent = dispatch(client, s, [{'source_transfer_id': origin['id'], 'quantity': 50, 'weight': 5}]).json()
    assert confirm(client, s, sent, workshop=True).status_code == 200
    source = sent['items'][0]
    lines = [{'source_transfer_id': source['id'], 'quantity': 30, 'weight': 3, 'material_type': 'semi_finished'},
             {'source_transfer_id': source['id'], 'quantity': 20, 'weight': 2, 'material_type': 'scrap_chips'}]
    assert dispatch(client, s, lines, workshop=True).status_code == 422  # Scrap reason required.
    excessive = [{**lines[0], 'quantity': 31}, lines[1]]
    assert dispatch(client, s, excessive, workshop=True, notes='废屑回收').status_code == 409
    assert client.get(base(s, True) + '/overview').json()['totals']['available_quantity'] == 50
    response = dispatch(client, s, lines, workshop=True, notes='废屑回收')
    assert response.status_code == 201, response.text
    group = response.json()
    assert group['line_count'] == 2 and group['total_quantity'] == 50
    assert dispatch(client, s, lines, workshop=True, notes='废屑回收').json() == group
    assert client.get(base(s, True) + '/overview').json()['totals']['on_hand_quantity'] == 0
    # Editing one split cannot consume its sibling's reserved stock.
    assert client.patch('/api/material-transfers/' + group['items'][0]['batch_no'], headers=s['other_headers'], json={'quantity': 31}).status_code == 409
    received = confirm(client, s, group)
    assert received.status_code == 200, received.text
    totals = client.get(base(s) + '/overview').json()['totals']
    assert totals['on_hand_quantity'] == 100 and totals['available_quantity'] == 80
    assert totals['scrap_quantity'] == totals['scrap_available_quantity'] == 20
    serials = client.get(base(s) + '/serials', params={'availability': 'scrap'}).json()
    assert serials['total'] == 1 and serials['items'][0]['scrap_quantity'] == 20
    assert client.get(base(s) + '/serials', params={'search_field': 'scrap_quantity', 'query': '20'}).json()['total'] == 1
    assert client.get(s['url'], params={'receipt_source': 'internal'}).json()['total'] == 2
    assert client.get(s['url'], params={'material_type': 'scrap_chips'}).json()['total'] == 1
    assert client.get(s['url'], params={'query': '轧制'}).json()['total'] == 2


def test_scrap_is_not_production_stock_and_can_only_be_disposed_externally(client, warehouse):
    s = warehouse
    waste = intake(client, s, material_type='waste', quantity=10, weight=1).json()
    lines = [{'source_transfer_id': waste['id'], 'quantity': 4, 'weight': .4}]
    assert dispatch(client, s, lines, notes='废料').status_code == 422
    assert dispatch(client, s, [{**lines[0], 'material_type': 'semi_finished'}], notes='改类型').status_code == 422
    assert client.get(base(s) + '/stock', params={'availability': 'available'}).json()['total'] == 0
    assert client.get(base(s) + '/stock', params={'availability': 'dispatchable'}).json()['total'] == 1
    response = dispatch(client, s, lines, next_team_id=None, entry_kind='warehouse_outbound', external_destination='回收单位', notes='废料处理')
    assert response.status_code == 201, response.text
    group = response.json()
    assert client.patch('/api/material-transfers/' + group['items'][0]['batch_no'], headers=s['headers'], json={'material_type': 'finished'}).status_code == 422
    totals = client.get(base(s) + '/overview').json()['totals']
    assert totals['scrap_quantity'] == 10 and totals['scrap_available_quantity'] == 6 and totals['available_quantity'] == 0
    assert confirm(client, s, group, external=True).status_code == 200
    assert client.get(base(s) + '/overview').json()['totals']['scrap_quantity'] == 6


def test_warehouse_review_requires_source_correction_before_receipt(client, warehouse):
    s = warehouse
    origin = intake(client, s).json()
    sent = dispatch(client, s, [{'source_transfer_id': origin['id'], 'quantity': 20, 'weight': 2}]).json()
    assert confirm(client, s, sent, workshop=True).status_code == 200
    group = dispatch(client, s, [{'source_transfer_id': sent['items'][0]['id'], 'quantity': 10, 'weight': 1}], workshop=True).json()
    line = group['items'][0]
    url = '/api/material-transfers/' + line['batch_no']
    review = {'reason': '请补充物料说明', 'expected_version': line['version']}
    assert client.post(url + '/reject', json=review).status_code == 403
    assert client.post(url + '/reject', headers=s['other_headers'], json=review).status_code == 403
    rejected = client.post(url + '/reject', headers=s['headers'], json=review)
    assert rejected.status_code == 200, rejected.text
    assert client.post(url + '/reject', headers=s['headers'], json=review).json() == rejected.json()
    assert rejected.json()['history'][-1]['action'] == 'rejected'
    assert client.get(base(s, True) + '/overview').json()['totals']['available_quantity'] == 10
    assert client.post(url + '/confirm', headers=s['headers'], json={'idempotency_key': 'blocked'}).status_code == 409
    current = client.get('/api/material-dispatches/' + group['dispatch_no'], headers=s['headers']).json()
    assert 'confirm' not in current['allowed_actions']
    assert confirm(client, s, current).status_code == 409
    assert client.patch(url, headers=s['headers'], json={'notes': '库房修改'}).status_code == 403
    # A no-op cannot clear the review flag.
    unchanged = client.patch(url, headers=s['other_headers'], json={'quantity': 10}).json()
    assert unchanged['rejection_reason'] == review['reason']
    corrected = client.patch(url, headers=s['other_headers'], json={'notes': '半成品回库，规格已核对', 'expected_version': rejected.json()['version']})
    assert corrected.status_code == 200 and corrected.json()['rejection_reason'] is None
    current = client.get('/api/material-dispatches/' + group['dispatch_no'], headers=s['headers']).json()
    assert confirm(client, s, current).status_code == 200
    assert client.post(url + '/reject', headers=s['headers'], json={**review, 'expected_version': 4}).status_code == 409


def test_provenance_migration_preserves_old_rows_and_can_repeat():
    path = Path(__file__).parents[1] / 'alembic/versions/20260916_0013_warehouse_provenance.py'
    spec = importlib.util.spec_from_file_location('warehouse_provenance', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    engine = create_engine('sqlite://')
    with engine.begin() as conn:
        conn.exec_driver_sql('CREATE TABLE material_transfers (id INTEGER PRIMARY KEY, serial_no VARCHAR(80))')
        conn.exec_driver_sql("INSERT INTO material_transfers VALUES (1, 'EXISTING')")
        with Operations.context(MigrationContext.configure(conn)):
            module.upgrade()
            module.upgrade()
        assert {'receipt_kind', 'external_source', 'return_dispatch_no', 'rejection_reason'} <= {c['name'] for c in inspect(conn).get_columns('material_transfers')}
        assert conn.exec_driver_sql('SELECT * FROM material_transfers').one() == (1, 'EXISTING', None, None, None, None)
    engine.dispose()
