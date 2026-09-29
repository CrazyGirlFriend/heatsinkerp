"""Read-only ownership fields must never change transactional stock semantics."""
from datetime import datetime

import pytest

from test_warehouse_receipts import warehouse, intake  # noqa: F401
from test_warehouse_classification import base, dispatch, confirm


@pytest.fixture(autouse=True)
def grinding_team(warehouse):
    # Factory reports intentionally select the configured eight teams.
    from app.database import SessionLocal
    from app.models import Team
    with SessionLocal.begin() as db:
        team = db.get(Team, warehouse['other']['id'])
        team.code, team.name = 'FACTORY-GRIND', '研磨'


def totals(client, setup, workshop=False):
    response = client.get(base(setup, workshop) + '/overview')
    assert response.status_code == 200, response.text
    datetime.fromisoformat(response.json()['as_of'])
    return response.json()['totals']


def assert_amounts(value, owned, in_stock, pending, external=0):
    for unit in ('quantity', 'weight'):
        assert value['owned_' + unit] == owned
        assert value['on_hand_' + unit] == in_stock
        assert value['in_transit_' + unit] == pending
        assert value['external_pending_' + unit] == external


def test_ownership_stays_with_sender_until_receipt_in_every_balance_view(client, warehouse):
    s = warehouse
    origin = intake(client, s, weight=100).json()
    assert_amounts(totals(client, s), 100, 100, 0)
    lines = [{'source_transfer_id': origin['id'], 'quantity': 30, 'weight': 30}]
    sent = dispatch(client, s, lines).json()
    assert dispatch(client, s, lines).json() == sent
    assert_amounts(totals(client, s), 100, 70, 30)
    assert_amounts(totals(client, s, True), 0, 0, 0)
    item = sent['items'][0]
    url = '/api/material-transfers/' + item['batch_no']
    edited = client.patch(url, headers=s['headers'], json={'quantity': 20, 'weight': 20, 'expected_version': item['version']})
    assert edited.status_code == 200, edited.text
    assert_amounts(totals(client, s), 100, 80, 20)
    for suffix in ('/stock?availability=all', '/inventory?availability=owned', '/serials?availability=all'):
        assert_amounts(client.get(base(s) + suffix).json()['items'][0], 100, 80, 20)
    for path in ('/api/factory-overview',):
        report = client.get(path).json()
        assert_amounts(report['totals'], 100, 80, 20)
        assert_amounts(next(t['balance'] for t in report['teams'] if t['id'] == s['team']['id']), 100, 80, 20)
    pending = client.get(base(s) + f"/inventory/{origin['id']}/pending-outbound").json()
    assert pending['total'] == 1 and pending['items'][0]['quantity'] == 20
    assert pending['items'][0]['next_team']['id'] == s['other']['id']
    payload = {'idempotency_key': 'sign-once', 'expected_version': edited.json()['version']}
    for _ in range(2):
        signed = client.post(url + '/confirm', headers=s['other_headers'], json=payload)
        assert signed.status_code == 200, signed.text
        assert_amounts(totals(client, s), 80, 80, 0)
        assert_amounts(totals(client, s, True), 20, 20, 0)
        assert_amounts(client.get('/api/factory-overview').json()['totals'], 100, 100, 0)
    assert client.patch(url, headers=s['headers'], json={'quantity': 10, 'expected_version': edited.json()['version']}).status_code in (403, 409)
    assert client.get(base(s) + f"/inventory/{origin['id']}/pending-outbound").json()['total'] == 0


def test_fully_pending_rows_remain_owned_but_cannot_be_issued_again_and_void_restores_stock(client, warehouse):
    s = warehouse
    origin = intake(client, s, weight=100).json()
    lines = [{'source_transfer_id': origin['id'], 'quantity': 100, 'weight': 100}]
    item = dispatch(client, s, lines).json()['items'][0]
    inventory = base(s) + '/inventory'
    for availability in ('current', 'available'):
        assert client.get(inventory, params={'availability': availability}).json()['total'] == 0
    assert client.get(base(s) + '/stock?availability=dispatchable').json()['total'] == 0
    result = client.get(inventory, params={'availability': 'owned', 'page_size': 1}).json()
    assert result['total'] == 1
    assert_amounts(result['items'][0], 100, 0, 100)
    datetime.fromisoformat(result['as_of'])
    assert dispatch(client, s, lines, idempotency_key='second-issue').status_code == 409
    assert client.delete('/api/material-transfers/' + item['batch_no'], headers=s['headers']).status_code == 204
    assert_amounts(totals(client, s), 100, 100, 0)
    for field in ('owned_quantity', 'owned_weight', 'external_pending_weight', 'in_transit_quantity'):
        value = 100 if field.startswith('owned') else 0
        response = client.get(inventory, params={'availability': 'owned', 'search_field': field, 'query': str(value)})
        assert response.status_code == 200, response.text
        assert response.json()['total'] == 1
    assert client.get(inventory, params={'search_field': 'owned_quantity', 'query': '1.1'}).status_code == 422


def test_external_submission_releases_ownership_without_a_pending_step(client, warehouse):
    s = warehouse
    origin = intake(client, s, weight=100).json()
    sent = dispatch(client, s, [{'source_transfer_id': origin['id'], 'quantity': 30, 'weight': 30}],
                    entry_kind='warehouse_outbound', next_team_id=None, external_destination='客户').json()
    assert_amounts(totals(client, s), 70, 70, 0)
    rows = client.get(base(s) + f"/inventory/{origin['id']}/pending-outbound").json()['items']
    assert rows == []
    assert sent['items'][0]['status'] == 'dispatched'
    assert_amounts(totals(client, s), 70, 70, 0)


def test_pending_drilldown_is_scoped_to_origin_and_requires_authentication(client, warehouse):
    s = warehouse
    first = intake(client, s, external_source='供应商甲').json()
    second = intake(client, s, external_source='供应商乙', idempotency_key='second-intake').json()
    group = dispatch(client, s, [
        {'source_transfer_id': first['id'], 'quantity': 1, 'weight': 1},
        {'source_transfer_id': second['id'], 'quantity': 2, 'weight': 2},
    ]).json()
    path = base(s) + f"/inventory/{first['id']}/pending-outbound"
    result = client.get(path, params={'page_size': 1}).json()
    assert result['total'] == 1 and result['items'][0]['batch_no'] == group['items'][0]['batch_no']
    assert client.get(base(s, True) + f"/inventory/{first['id']}/pending-outbound").status_code == 404
    assert client.get(path, headers={'Authorization': 'Bearer invalid'}).status_code == 401


@pytest.mark.parametrize('kind', ['scrap_chips', 'sludge'])
def test_weight_only_waste_return_and_partial_receipt_do_not_create_factory_input(client, warehouse, kind):
    s = warehouse
    origin = intake(client, s, quantity=0, weight=100).json()
    supplied = dispatch(client, s, [{'source_transfer_id': origin['id'], 'quantity': 0, 'weight': 100}]).json()
    assert confirm(client, s, supplied, workshop=True).status_code == 200
    returned = dispatch(client, s, [
        {'source_transfer_id': supplied['items'][0]['id'], 'quantity': 0, 'weight': 30, 'material_type': kind,
         **({'sludge_gross_weight': 100, 'sludge_content_percent': 30} if kind == 'sludge' else {})},
        {'source_transfer_id': supplied['items'][0]['id'], 'quantity': 0, 'weight': 20, 'material_type': 'semi_finished'},
    ], workshop=True, notes='按流水号称重回库').json()
    assert len({row['batch_no'] for row in returned['items']}) == 2
    first = returned['items'][0]
    assert client.post('/api/material-transfers/' + first['batch_no'] + '/confirm', headers=s['headers'], json={'idempotency_key': 'partial-sign'}).status_code == 200
    upstream, downstream = totals(client, s, True), totals(client, s)
    assert upstream['owned_weight'] == 70 and upstream['on_hand_weight'] == 50 and upstream['in_transit_weight'] == 20
    assert downstream['owned_weight'] == 30 and downstream['scrap_available_weight'] == 30
    assert client.get('/api/factory-overview').json()['totals']['owned_weight'] == 100
    assert client.get(base(s) + '/inventory?availability=owned').json()['items'][0]['owned_quantity'] == 0
