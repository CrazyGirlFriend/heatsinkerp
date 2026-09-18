"""All outbound kinds leave stock at submission, not again at confirmation."""
from datetime import datetime

import pytest

from app import factory_overview, material_analytics
from app.database import SessionLocal
from app.models import MaterialTransfer
from test_external_outbound import outbound, dispatch


def check_stock(client, setup, quantity, weight, pending_quantity, pending_weight):
    overview = client.get(setup['url'] + '/overview').json()
    assert overview['pending_incoming']['count'] == 0
    balances = [overview['totals'], *overview['materials'], *overview['material_types']]
    for path in ('/api/factory-overview', '/api/factory-overview/live'):
        data = client.get(path).json()
        balances.extend([data['totals'], next(t['balance'] for t in data['teams'] if t['id'] == setup['team']['id'])])
        if path.endswith('/live'):
            assert data['material_stock'] == [{'key': '铜钼', 'quantity': quantity, 'weight': weight}]
            assert all(not t['pending_transfers'] for t in data['teams'])
    for balance in balances:
        assert balance['on_hand_quantity'] == balance['available_quantity'] == quantity
        assert balance['on_hand_weight'] == balance['available_weight'] == weight
        assert balance['reserved_quantity'] == pending_quantity
        assert balance['reserved_weight'] == pending_weight
        assert balance['in_transit_quantity'] == balance['in_transit_weight'] == 0
    for suffix in ('/serials?availability=all', '/stock?availability=all'):
        rows = client.get(setup['url'] + suffix).json()['items']
        assert sum(row['on_hand_quantity'] for row in rows) == quantity
        assert sum(row['on_hand_weight'] for row in rows) == pytest.approx(weight)
    analytics = client.get(setup['url'] + '/analytics').json()
    for key in ('materials', 'material_types', 'stock_age', 'stock_ranking'):
        assert sum(row['quantity'] for row in analytics[key]) == quantity
        assert sum(row['weight'] for row in analytics[key]) == pytest.approx(weight)


def test_external_submission_edit_void_and_confirmation_agree_across_views(client, outbound):
    response = dispatch(client, outbound)
    assert response.status_code == 201, response.text
    group = response.json()
    assert dispatch(client, outbound).json() == group  # Creation retry cannot deduct twice.
    check_stock(client, outbound, 140, 14, 60, 6)

    first, second = group['items']
    response = client.patch('/api/material-transfers/' + first['batch_no'], headers=outbound['headers'],
                            json={'quantity': 31, 'weight': '3.125', 'expected_version': first['version']})
    assert response.status_code == 200, response.text
    check_stock(client, outbound, 139, 13.875, 61, 6.125)

    assert client.delete('/api/material-transfers/' + second['batch_no'], headers=outbound['headers']).status_code == 204
    check_stock(client, outbound, 169, 16.875, 31, 3.125)
    too_much = dispatch(client, outbound, idempotency_key='overdraw',
                        lines=[{'source_transfer_id': outbound['lots'][0]['id'], 'quantity': 70, 'weight': 0}])
    assert too_much.status_code == 409
    check_stock(client, outbound, 169, 16.875, 31, 3.125)

    url = '/api/material-transfers/' + first['batch_no']
    document = client.get(url).json()
    payload = {'idempotency_key': 'confirm-once', 'expected_version': document['version']}
    for _ in range(2):
        response = client.post(url + '/confirm-outbound', headers=outbound['headers'], json=payload)
        assert response.status_code == 200, response.text
        check_stock(client, outbound, 169, 16.875, 0, 0)


@pytest.mark.parametrize('quantity,weight', [(0, .001), (1, 0), (100, 10)])
def test_external_submission_keeps_units_independent_and_void_restores_both(client, outbound, quantity, weight):
    response = dispatch(client, outbound, lines=[{
        'source_transfer_id': outbound['lots'][0]['id'], 'quantity': quantity, 'weight': weight,
    }])
    assert response.status_code == 201, response.text
    check_stock(client, outbound, 200 - quantity, round(20 - weight, 3), quantity, weight)
    batch = response.json()['items'][0]['batch_no']
    assert client.delete('/api/material-transfers/' + batch, headers=outbound['headers']).status_code == 204
    check_stock(client, outbound, 200, 20, 0, 0)


def test_internal_and_external_pending_both_deduct_but_only_internal_is_in_transit(client, outbound):
    internal = dispatch(client, outbound, entry_kind='transfer', external_destination=None,
                        next_team_id=outbound['other']['id']).json()
    external = dispatch(client, outbound, idempotency_key='external-alongside-internal').json()
    for path in (outbound['url'] + '/overview', '/api/factory-overview', '/api/factory-overview/live'):
        totals = client.get(path).json()['totals']
        assert totals['on_hand_quantity'] == totals['available_quantity'] == 80
        assert totals['on_hand_weight'] == totals['available_weight'] == 8
        assert totals['reserved_quantity'] == 120 and totals['in_transit_quantity'] == 60
        assert totals['reserved_weight'] == 12 and totals['in_transit_weight'] == 6
    live = client.get('/api/factory-overview/live').json()
    incoming = next(team['pending_transfers'] for team in live['teams'] if team['id'] == outbound['other']['id'])
    assert sum(row['quantity'] for row in incoming) == 60
    assert {row['batch_no'] for row in incoming} == {item['batch_no'] for item in internal['items']}
    for line in external['items']:
        assert client.delete('/api/material-transfers/' + line['batch_no'], headers=outbound['headers']).status_code == 204
    totals = client.get('/api/factory-overview/live').json()['totals']
    assert totals['on_hand_quantity'] == 140 and totals['in_transit_quantity'] == 60
    assert totals['on_hand_weight'] == 14 and totals['in_transit_weight'] == 6


def test_external_outgoing_trends_use_submission_day_without_counting_confirmation_again(client, outbound, monkeypatch):
    now = datetime(2026, 9, 12, 2)
    for module in (factory_overview, material_analytics):
        monkeypatch.setattr(module, 'utcnow', lambda: now)
    group = dispatch(client, outbound).json()
    with SessionLocal() as db:
        for item in db.query(MaterialTransfer):
            item.created_at = item.received_at = datetime(2026, 9, 10, 1)
        for line in group['items']:
            item = db.get(MaterialTransfer, line['id'])
            item.created_at, item.received_at = datetime(2026, 9, 11, 16), None
        db.commit()
    kind = 'outbound' if outbound['kind'] == 'warehouse_outbound' else 'shipment'
    for path, key in ((outbound['url'] + '/analytics', 'outgoing'), ('/api/factory-overview', kind)):
        movement = client.get(path).json()['trend'][-1][key]
        assert (movement['quantity'], movement['weight']) == (60, 6)
    assert client.get('/api/factory-overview/live').json()['today']['outgoing_quantity'] == 60

    for item in group['items']:
        url = '/api/material-transfers/' + item['batch_no']
        response = client.post(url + '/confirm-outbound', headers=outbound['headers'], json={
            'idempotency_key': 'confirm-next-day-' + item['batch_no'], 'expected_version': item['version'],
        })
        assert response.status_code == 200, response.text
    now = datetime(2026, 9, 13, 2)
    with SessionLocal() as db:
        for line in group['items']:
            db.get(MaterialTransfer, line['id']).dispatched_at = now
        db.commit()
    for path, key in ((outbound['url'] + '/analytics', 'outgoing'), ('/api/factory-overview', kind)):
        trend = client.get(path).json()['trend']
        assert (trend[-2][key]['quantity'], trend[-2][key]['weight']) == (60, 6)
        assert trend[-1][key] == {'quantity': 0, 'weight': 0}
    assert client.get('/api/factory-overview/live').json()['today']['outgoing_quantity'] == 0
