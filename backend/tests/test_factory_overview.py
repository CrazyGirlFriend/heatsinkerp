from datetime import datetime, timedelta

from app import factory_overview
from app.database import SessionLocal
from app.models import MaterialTransfer, Team
from test_external_outbound import outbound, dispatch, confirm
from test_warehouse_receipts import warehouse, intake
from test_material_stock import stock_setup, receive_lot


def report(client):
    response = client.get('/api/factory-overview?days=30')
    assert response.status_code == 200, response.text
    return response.json()


def test_factory_conservation_internal_not_inbound_and_batch_count_once(client, outbound):
    before = report(client)
    assert before['totals']['on_hand_quantity'] == 200
    assert before['period_totals']['inbound']['quantity'] == 200
    assert before['period_totals']['internal']['quantity'] == (200 if outbound['kind'] == 'inspection_shipment' else 0)
    group = dispatch(client, outbound).json()
    pending = report(client)
    feed = next(row for row in pending['recent_batches'] if row['batch_no'] == group['items'][0]['batch_no'])
    assert feed['line_count'] == 1 and feed['quantity'] == 30 and feed['weight'] == 3
    assert feed['status'] == 'pending' and feed['external_destination'] == group['items'][0]['external_destination']
    assert pending['pending'] == {'batches': 2, 'quantity': 60, 'weight': 6}
    assert pending['totals']['on_hand_quantity'] == 140
    kind = 'outbound' if outbound['kind'] == 'warehouse_outbound' else 'shipment'
    assert pending['period_totals'][kind]['quantity'] == 60
    assert pending['totals']['available_quantity'] == 140
    assert sum(row['external']['quantity'] for row in pending['waiting_age']) == 60
    assert sum(row['internal']['quantity'] for row in pending['waiting_age']) == 0
    for line in group['items']:
        assert confirm(client, outbound, line).status_code == 200
    after = report(client)
    kind = 'outbound' if outbound['kind'] == 'warehouse_outbound' else 'shipment'
    assert after['period_totals'][kind]['quantity'] == 60
    assert after['totals']['on_hand_quantity'] == 140
    assert after['totals']['on_hand_weight'] == 14
    assert after['pending']['batches'] == 0
    assert after['period_totals']['inbound']['quantity'] == 200
    assert sum(team['balance']['on_hand_quantity'] for team in after['teams'] if team['balance']) == 140
    assert client.get('/api/factory-overview', headers=outbound['headers']).status_code == 200


def test_factory_age_confirmation_day_and_inactive_stock_are_explicit(client, warehouse, monkeypatch):
    now = datetime(2026, 9, 12, 12)
    monkeypatch.setattr(factory_overview, 'utcnow', lambda: now)
    lot = intake(client, warehouse).json()
    with SessionLocal() as db:
        row = db.get(MaterialTransfer, lot['id'])
        row.created_at = now - timedelta(days=40)
        row.received_at = datetime(2026, 9, 11, 17)  # Next factory day.
        db.commit()
    d = report(client)
    assert d['trend'][-1]['inbound']['quantity'] == 100
    assert next(row for row in d['stock_age'] if row['key'] == 'lt1')['quantity'] == 100
    with SessionLocal() as db:
        db.get(Team, warehouse['team']['id']).active = False
        db.commit()
    d = report(client)
    assert d['totals']['on_hand_quantity'] == 100
    assert d['teams'][0]['active'] is False and d['teams'][0]['balance']['on_hand_quantity'] == 100


def test_untracked_legacy_is_not_guessed_into_stock(client, stock_setup):
    lot = receive_lot(client, stock_setup)
    with SessionLocal() as db:
        db.get(Team, stock_setup['stock_team_id']).code = 'FACTORY-ROLL'
        db.get(MaterialTransfer, lot['id']).stock_tracked = False
        db.commit()
    d = report(client)
    assert d['totals']['on_hand_quantity'] == 0 and d['legacy_received_count'] == 1


def test_internal_bulk_pending_is_counted_once_and_confirmation_keeps_factory_stock(client, outbound):
    group = dispatch(client, outbound, entry_kind='transfer', external_destination=None, next_team_id=outbound['other']['id']).json()
    before = report(client)
    assert before['pending']['batches'] == 2 and before['pending']['quantity'] == 60
    assert sum(row['internal']['quantity'] for row in before['waiting_age']) == 60
    item = group['items'][0]
    result = client.post(f"/api/material-transfers/{item['batch_no']}/confirm", headers=outbound['other_headers'], json={'idempotency_key': 'factory-receive'})
    assert result.status_code == 200, result.text
    after = report(client)
    assert before['totals']['on_hand_quantity'] == 140
    assert before['totals']['in_transit_quantity'] == 60
    assert after['totals']['on_hand_quantity'] == 170
    assert after['totals']['in_transit_quantity'] == 30
    assert after['totals']['on_hand_quantity'] + after['totals']['in_transit_quantity'] == 200
    assert after['period_totals']['inbound']['quantity'] == 200
    assert after['pending']['batches'] == 1 and after['pending']['quantity'] == 30
    feed = [row for row in after['recent_batches'] if row['batch_no'] in {item['batch_no'] for item in group['items']}]
    assert len(feed) == 2 and {row['status'] for row in feed} == {'pending', 'received'}
    assert sum(row['quantity'] for row in feed) == 60


def test_rankings_group_serials_and_materials_before_limit_and_sort_each_unit(client, warehouse):
    assert intake(client, warehouse, serial_no='SHARED', material_name='铜', quantity=2, weight=20).status_code == 201
    assert intake(client, warehouse, serial_no='SHARED', material_name='铜', quantity=3, weight=30, idempotency_key='second').status_code == 201
    for i in range(10):
        assert intake(client, warehouse, serial_no=f'S-{i:02}', material_name=f'材质-{i:02}', quantity=10+i, weight=1+i/10, idempotency_key=f'rank-{i}').status_code == 201
    d = report(client)
    assert len(d['serial_ranking']['weight']) == len(d['material_ranking']['quantity']) == 8
    assert d['serial_ranking']['weight'][0] == {'key': 'SHARED', 'quantity': 5, 'weight': 50}
    assert d['material_ranking']['weight'][0]['key'] == '铜'
    assert d['serial_ranking']['quantity'][0]['key'] == 'S-09'
    assert len(d['recent_batches']) == 12
    assert all(row['entry_kind'] == 'warehouse_receipt' and row['source_name'] is None for row in d['recent_batches'])
    assert [row['updated_at'] for row in d['recent_batches']] == sorted([row['updated_at'] for row in d['recent_batches']], reverse=True)


def test_missing_scope_empty_validation_and_login(client):
    d = report(client)
    assert len(d['teams']) == 8 and all(team['balance'] is None for team in d['teams'])
    assert all(team['serial_count'] is None and team['pending_incoming'] is None and team['urgent_serial_count'] is None for team in d['teams'])
    assert d['totals']['on_hand_quantity'] == 0 and d['pending']['batches'] == 0
    assert len(d['trend']) == 30
    assert client.get('/api/factory-overview?days=1').status_code == 422
    original = client.headers.pop('Authorization')
    try:
        assert client.get('/api/factory-overview').status_code == 401
    finally:
        client.headers['Authorization'] = original


def test_inventory_cards_count_remaining_serials_and_urgency_once(client, warehouse):
    first = intake(client, warehouse, serial_no='SHARED', quantity=2, weight=0.125).json()
    assert intake(client, warehouse, serial_no='SHARED', quantity=3, weight=0.375, idempotency_key='second').status_code == 201
    weight_only = intake(client, warehouse, serial_no='WEIGHT', quantity=0, weight=0.005, idempotency_key='weight').json()
    for serial in ('SHARED', 'WEIGHT'):
        assert client.put('/api/serial-urgency', json={'serial_no': serial, 'urgent': True, 'expected_version': 0}).status_code == 200
    d = report(client)['teams'][0]
    assert d['serial_count'] == d['urgent_serial_count'] == 2
    assert d['balance']['on_hand_quantity'] == 5 and d['balance']['on_hand_weight'] == 0.505
    assert d['pending_incoming'] == {'batches': 0, 'quantity': 0, 'weight': 0}
    result = client.post(f"/api/team-materials/{warehouse['team']['id']}/dispatches", headers=warehouse['headers'], json={
        'next_team_id': warehouse['other']['id'], 'idempotency_key': 'remove-weight',
        'lines': [{'source_transfer_id': lot['id'], 'quantity': lot['quantity'], 'weight': lot['weight']} for lot in (first, weight_only)]})
    assert result.status_code == 201, result.text
    d = report(client)['teams'][0]
    assert d['serial_count'] == d['urgent_serial_count'] == 1  # SHARED still has a second lot.
    assert d['balance']['on_hand_weight'] == 0.375
    assert client.put('/api/serial-urgency', json={'serial_no': 'SHARED', 'urgent': False, 'expected_version': 1}).status_code == 200
    assert report(client)['teams'][0]['urgent_serial_count'] == 0


def test_inventory_card_incoming_is_one_ck_not_child_lines_and_never_external(client, outbound):
    assert dispatch(client, outbound).status_code == 201
    assert all(team['pending_incoming']['batches'] == 0 for team in report(client)['teams'] if team['id'])
    response = dispatch(client, outbound, entry_kind='transfer', external_destination=None,
        next_team_id=outbound['other']['id'], idempotency_key='internal-cards')
    assert response.status_code == 201, response.text
    def target():
        return next(team for team in report(client)['teams'] if team['id'] == outbound['other']['id'])
    assert target()['pending_incoming'] == {'batches': 2, 'quantity': 60, 'weight': 6}
    assert target()['serial_count'] == 0
    for index, line in enumerate(response.json()['items']):
        received = client.post(f"/api/material-transfers/{line['batch_no']}/confirm", headers=outbound['other_headers'],
            json={'idempotency_key': f'card-receive-{index}'})
        assert received.status_code == 200, received.text
        assert target()['pending_incoming'] == {'batches': 1 - index, 'quantity': 30 * (1 - index), 'weight': 3 * (1 - index)}
        assert target()['serial_count'] == index + 1
