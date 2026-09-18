"""Warehouse grouping must never blend source/nature/specification balances."""
from datetime import datetime

import pytest

from app.database import SessionLocal
from app.models import MaterialTransfer
from test_warehouse_receipts import warehouse, intake
from test_warehouse_classification import base, dispatch, confirm


def inventory(client, setup, **params):
    response = client.get(base(setup) + '/warehouse-inventory', params=params)
    assert response.status_code == 200, response.text
    return response.json()


def sources(client, setup, group_id, **params):
    response = client.get(base(setup) + f'/warehouse-inventory/{group_id}/sources', params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_grouping_pagination_and_exact_source_drilldown(client, warehouse):
    s = warehouse
    common = dict(serial_no='000128', material_name='铜钼 CuMo70', material_type='raw_material',
                  external_source='供应商 A', transfer_specification='100 × 80 × 5', quantity=10, weight=1)
    first = intake(client, s, **common, idempotency_key='a').json()
    second = intake(client, s, **common, idempotency_key='b').json()
    other_source = intake(client, s, **{**common, 'external_source': '供应商 B'}, idempotency_key='c').json()
    intake(client, s, **{**common, 'material_type': 'finished'}, idempotency_key='d')
    intake(client, s, **{**common, 'transfer_specification': '40 × 30 × 2'}, idempotency_key='e')
    intake(client, s, **{**common, 'material_type': 'scrap_chips', 'quantity': 0, 'weight': .6}, idempotency_key='f')
    rows = inventory(client, s)
    assert rows['total'] == 5
    row = next(item for item in rows['items'] if item['group_id'] == first['id'])
    assert row['serial_no'] == '000128' and row['batch_count'] == 2
    assert row['on_hand_quantity'] == 20 and row['on_hand_weight'] == 2
    assert row['receipt_source'] == 'external' and row['source_name'] == '供应商 A'
    assert {item['transfer']['id'] for item in sources(client, s, first['id'])['items']} == {first['id'], second['id']}
    assert sources(client, s, other_source['id'])['total'] == 1
    pages = [inventory(client, s, page=i, page_size=2) for i in (1, 2, 3)]
    assert [len(page['items']) for page in pages] == [2, 2, 1]
    assert len({row['group_id'] for page in pages for row in page['items']}) == 5
    assert inventory(client, s, material_type='scrap_chips')['items'][0]['on_hand_weight'] == .6
    assert inventory(client, s, availability='available')['total'] == 4
    assert inventory(client, s, search_field='on_hand_quantity', search_operator='gte', query='20')['total'] == 1
    assert inventory(client, s, search_field='source', query='供应商 B')['total'] == 1
    assert inventory(client, s, query='000128')['total'] == 5


def test_internal_pending_not_stock_and_outbound_immediately_deducts(client, warehouse):
    s = warehouse
    origin = intake(client, s, serial_no='000129', external_source='供应商', quantity=100, weight=10).json()
    sent = dispatch(client, s, [{'source_transfer_id': origin['id'], 'quantity': 50, 'weight': 5}]).json()
    assert confirm(client, s, sent, workshop=True).status_code == 200
    returned = dispatch(client, s, [
        {'source_transfer_id': sent['items'][0]['id'], 'quantity': 30, 'weight': 3, 'material_type': 'finished'},
        {'source_transfer_id': sent['items'][0]['id'], 'quantity': 20, 'weight': 2, 'material_type': 'scrap_chips'},
    ], workshop=True, notes='废屑回库').json()
    assert inventory(client, s, receipt_source='internal')['total'] == 0
    pending = client.get(base(s) + '/overview').json()['pending_incoming']
    assert pending['count'] == 2 and pending['batch_count'] == 2
    assert confirm(client, s, returned).status_code == 200
    rows = inventory(client, s, receipt_source='internal')['items']
    assert len(rows) == 2 and sum(row['on_hand_quantity'] for row in rows) == 50
    assert all(row['source_name'] == '轧制' for row in rows)
    good = next(row for row in rows if row['material_type'] == 'finished')
    assert sources(client, s, good['group_id'])['total'] == 1
    outgoing = dispatch(client, s, [{'source_transfer_id': good['group_id'], 'quantity': 10, 'weight': 1}],
                        idempotency_key='external', next_team_id=None, entry_kind='warehouse_outbound', external_destination='客户').json()
    good = inventory(client, s, receipt_source='internal', material_type='finished')['items'][0]
    assert good['on_hand_quantity'] == 20 and good['reserved_quantity'] == 10
    assert confirm(client, s, outgoing, external=True).status_code == 200
    assert inventory(client, s, receipt_source='internal', material_type='finished')['items'][0]['on_hand_quantity'] == 20
    totals = client.get(base(s) + '/overview').json()['totals']
    assert sum(row['on_hand_quantity'] for row in inventory(client, s)['items']) == totals['on_hand_quantity']
    assert inventory(client, s, receipt_source='external')['items'][0]['on_hand_quantity'] == 50
    assert inventory(client, s, receipt_source='internal', source_team_id=s['other']['id'])['total'] == 2
    assert inventory(client, s, receipt_source='internal', source_team_id=99999)['total'] == 0


def test_dates_match_activity_without_truncating_deductions_and_history(client, warehouse):
    s = warehouse
    origin = intake(client, s, quantity=10, weight=1).json()
    with SessionLocal() as db:
        lot = db.get(MaterialTransfer, origin['id'])
        lot.received_at = lot.created_at = lot.updated_at = datetime(2026, 9, 1, 3)
        db.commit()
    sent = dispatch(client, s, [{'source_transfer_id': origin['id'], 'quantity': 10, 'weight': 1}]).json()
    with SessionLocal() as db:
        move = db.get(MaterialTransfer, sent['items'][0]['id'])
        move.created_at = move.updated_at = datetime(2026, 9, 3, 3)
        db.commit()
    assert inventory(client, s)['total'] == 0
    row = inventory(client, s, availability='all', date_from='2026-09-01', date_to='2026-09-01')['items'][0]
    assert row['on_hand_quantity'] == 0 and row['on_hand_weight'] == 0
    assert sources(client, s, row['group_id'], current_only=True)['total'] == 0
    assert sources(client, s, row['group_id'])['total'] == 1
    assert inventory(client, s, availability='all', date_from='2026-09-03', date_to='2026-09-03')['total'] == 1
    assert inventory(client, s, availability='all', date_from='2026-09-02', date_to='2026-09-02')['total'] == 0
    assert client.delete('/api/material-transfers/' + sent['items'][0]['batch_no'], headers=s['headers']).status_code == 204
    assert inventory(client, s)['items'][0]['on_hand_quantity'] == 10


def test_return_provenance_stays_separate_and_literal_search(client, warehouse):
    s = warehouse
    original = intake(client, s, external_source='A%_供料', receipt_kind='external').json()
    intake(client, s, external_source='A%_供料', receipt_kind='return', idempotency_key='return')
    assert inventory(client, s)['total'] == 2
    assert inventory(client, s, receipt_source='return')['items'][0]['receipt_source'] == 'return'
    assert inventory(client, s, query='%_')['total'] == 2
    assert inventory(client, s, query='不存在')['total'] == 0
    assert sources(client, s, original['id'])['total'] == 1


def test_conflicting_customer_metadata_is_searchable_but_not_silently_chosen(client, warehouse):
    s = warehouse
    intake(client, s, customer_code='CUSTOMER-A', finished_quantity=10)
    intake(client, s, customer_code='CUSTOMER-B', finished_quantity=20, idempotency_key='other')
    for params in ({'query': 'CUSTOMER-B'}, {'query': 'CUSTOMER-A', 'search_field': 'customer_code'},
                   {'query': '20', 'search_field': 'finished_quantity'}):
        result = inventory(client, s, **params)
        assert result['total'] == 1
        row = result['items'][0]
        assert row['customer_code'] is None and row['customer_code_count'] == 2
        assert row['on_hand_quantity'] == 200  # Full group, not just the matching intake.
    assert inventory(client, s, query='21', search_field='finished_quantity')['total'] == 0


@pytest.mark.parametrize('params', [
    {'search_field': 'on_hand_quantity', 'query': '1.2'},
    {'search_field': 'on_hand_weight', 'query': 'NaN'},
    {'search_field': 'on_hand_weight', 'query': '1.2345'},
    {'search_field': 'source', 'query': 'A', 'search_operator': 'gte'},
    {'date_from': '2026-09-02', 'date_to': '2026-09-01'},
    {'receipt_source': 'forged'}, {'page_size': 101},
])
def test_invalid_filters_rejected(client, warehouse, params):
    assert client.get(base(warehouse) + '/warehouse-inventory', params=params).status_code == 422


def test_warehouse_only_and_unauthenticated_access(client, warehouse):
    s = warehouse
    origin = intake(client, s).json()
    assert client.get(base(s, True) + '/warehouse-inventory').status_code == 403
    assert client.get(base(s, True) + f"/warehouse-inventory/{origin['id']}/sources").status_code == 403
    assert client.get(base(s) + '/warehouse-inventory/99999/sources').status_code == 404
    client.headers.pop('Authorization')
    assert client.get(base(s) + '/warehouse-inventory').status_code == 401
