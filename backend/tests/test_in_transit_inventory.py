"""Internal submission leaves source stock; acceptance only moves transit into stock."""
from datetime import datetime

from app import factory_overview, material_analytics
from app.database import SessionLocal
from app.models import MaterialTransfer
from test_material_stock import stock_setup, receive_lot, dispatch, totals, endpoint
from test_external_outbound import outbound, dispatch as bulk_dispatch


def test_pending_transfer_deducts_inventory_and_edit_void_restore_it(client, stock_setup):
    s = stock_setup
    lot = receive_lot(client, s)
    group = dispatch(client, s, [{"source_transfer_id": lot['id'], "quantity": 30, "weight": 3}]).json()
    balance = totals(client, s)
    assert balance['on_hand_quantity'] == balance['available_quantity'] == 70
    assert balance['on_hand_weight'] == balance['available_weight'] == 7
    assert balance['in_transit_quantity'] == 30 and balance['in_transit_weight'] == 3
    downstream = client.get(f"/api/team-materials/{s['third']['id']}/overview").json()
    assert downstream['totals']['on_hand_quantity'] == 0
    assert downstream['pending_incoming']['quantity'] == 30
    for suffix in ('serials', 'stock?availability=all'):
        row = client.get(endpoint(s, suffix)).json()['items'][0]
        assert row['on_hand_quantity'] == 70 and row['in_transit_quantity'] == 30
    report = client.get(endpoint(s, 'analytics')).json()
    assert sum(row['quantity'] for row in report['materials']) == 70
    assert sum(row['quantity'] for row in report['stock_age']) == 70
    assert report['stock_ranking'][0]['quantity'] == 70
    url = f"/api/material-transfers/{group['items'][0]['batch_no']}"
    result = client.patch(url, headers=s['stock_headers'], json={'quantity': 40, 'weight': 4, 'expected_version': 1})
    assert result.status_code == 200, result.text
    assert totals(client, s)['on_hand_quantity'] == 60
    assert totals(client, s)['in_transit_quantity'] == 40
    assert client.delete(url, headers=s['stock_headers']).status_code == 204
    assert totals(client, s)['on_hand_quantity'] == 100
    assert totals(client, s)['in_transit_quantity'] == 0


def test_factory_stock_plus_transit_conserves_and_acceptance_never_deducts_twice(client, outbound):
    group = bulk_dispatch(client, outbound, entry_kind='transfer', external_destination=None,
                          next_team_id=outbound['other']['id']).json()
    for path in ('/api/factory-overview', '/api/factory-overview/live'):
        report = client.get(path).json()
        assert report['totals']['on_hand_quantity'] == 140
        assert report['totals']['in_transit_quantity'] == 60
        assert report['totals']['on_hand_weight'] == 14
        assert report['totals']['in_transit_weight'] == 6
        assert report['pending']['batches'] == 2
    for _ in range(2):
        for item in group['items']:
            result = client.post('/api/material-transfers/' + item['batch_no'] + '/confirm', headers=outbound['other_headers'],
                json={'idempotency_key': 'receive-transit-' + item['batch_no'], 'expected_version': item['version']})
            assert result.status_code == 200, result.text
        source = client.get(outbound['url'] + '/overview').json()['totals']
        target = client.get(f"/api/team-materials/{outbound['other']['id']}/overview").json()['totals']
        assert source['on_hand_quantity'] == 140 and source['on_hand_weight'] == 14
        assert target['on_hand_quantity'] == 60 and target['on_hand_weight'] == 6
        report = client.get('/api/factory-overview/live').json()
        assert report['totals']['on_hand_quantity'] == 200
        assert report['totals']['in_transit_quantity'] == 0 and report['pending']['batches'] == 0


def test_internal_outgoing_trend_uses_submission_day_not_receipt_day(client, outbound, monkeypatch):
    now = datetime(2026, 9, 12, 2)
    for module in (factory_overview, material_analytics):
        monkeypatch.setattr(module, 'utcnow', lambda: now)
    group = bulk_dispatch(client, outbound, entry_kind='transfer', external_destination=None,
                          next_team_id=outbound['other']['id']).json()
    with SessionLocal() as db:
        for item in db.query(MaterialTransfer):
            item.created_at = item.received_at = datetime(2026, 9, 10, 1)
        for line in group['items']:
            item = db.get(MaterialTransfer, line['id'])
            item.created_at, item.received_at = datetime(2026, 9, 11, 16), None
        db.commit()
    def check():
        analytics = client.get(outbound['url'] + '/analytics').json()
        assert analytics['trend'][-1]['outgoing']['quantity'] == 60
        assert client.get('/api/factory-overview').json()['trend'][-1]['internal']['quantity'] == 60
        assert client.get('/api/factory-overview/live').json()['today']['outgoing_quantity'] == 60
    check()
    with SessionLocal() as db:
        for line in group['items']:
            item = db.get(MaterialTransfer, line['id'])
            item.status, item.stock_tracked, item.received_at = 'received', True, now
        db.commit()
    check()
    assert client.get('/api/factory-overview/live').json()['today']['received_batches'] == 2
