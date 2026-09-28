from datetime import datetime, timedelta

from app import factory_overview
from app.database import SessionLocal
from app.models import MaterialTransfer, Team
from test_external_outbound import outbound, dispatch
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
    assert feed['status'] == 'dispatched' and feed['external_destination'] == group['items'][0]['external_destination']
    assert feed['received_at'] is None
    assert pending['pending'] == {'batches': 0, 'quantity': 0, 'weight': 0}
    assert pending['totals']['on_hand_quantity'] == 140
    kind = 'outbound' if outbound['kind'] == 'warehouse_outbound' else 'shipment'
    assert pending['period_totals'][kind]['quantity'] == 60
    assert pending['totals']['available_quantity'] == 140
    assert sum(row['external']['quantity'] for row in pending['waiting_age']) == 0
    assert sum(row['internal']['quantity'] for row in pending['waiting_age']) == 0
    after = report(client)
    kind = 'outbound' if outbound['kind'] == 'warehouse_outbound' else 'shipment'
    assert after['period_totals'][kind]['quantity'] == 60
    assert after['totals']['on_hand_quantity'] == 140
    assert after['totals']['on_hand_weight'] == 14
    assert after['pending']['batches'] == 0
    # A submitted external shipment is not a recipient's signed receipt.
    assert all(row['received_at'] is None for row in after['recent_batches'] if row['batch_no'] in {line['batch_no'] for line in group['items']})
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
    feed = next(row for row in d['recent_batches'] if row['batch_no'] == lot['batch_no'])
    assert feed['received_at'] == '2026-09-11T17:00:00+00:00'
    assert feed['received_at'] != feed['updated_at']
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
    received_at = next(row for row in feed if row['status'] == 'received')['received_at']
    assert datetime.fromisoformat(received_at) == datetime.fromisoformat(result.json()['received_at'].replace('Z', '+00:00'))
    assert next(row for row in feed if row['status'] == 'pending')['received_at'] is None
    assert sum(row['quantity'] for row in feed) == 60


def test_rankings_group_serials_and_materials_before_limit_and_sort_each_unit(client, warehouse):
    assert intake(client, warehouse, serial_no='SHARED', material_name='铜', quantity=2, weight=20).status_code == 201
    assert intake(client, warehouse, serial_no='SHARED', material_name='铜', quantity=3, weight=30, idempotency_key='second').status_code == 201
    for i in range(14):
        assert intake(client, warehouse, serial_no=f'S-{i:02}', material_name=f'材质-{i:02}', quantity=10+i, weight=1+i/10, idempotency_key=f'rank-{i}').status_code == 201
    d = report(client)
    assert len(d['serial_ranking']['weight']) == len(d['material_ranking']['quantity']) == 8
    assert d['serial_ranking']['weight'][0] == {'key': 'SHARED', 'quantity': 5, 'weight': 50}
    assert d['material_ranking']['weight'][0]['key'] == '铜'
    assert d['serial_ranking']['quantity'][0]['key'] == 'S-13'
    assert len(d['recent_batches']) == 16  # Today's feed is not truncated to 12 batches.
    assert all(row['entry_kind'] == 'warehouse_receipt' and row['source_name'] is None for row in d['recent_batches'])
    assert [row['received_at'] for row in d['recent_batches']] == sorted([row['received_at'] for row in d['recent_batches']], reverse=True)


def test_today_feed_uses_factory_midnight_and_ignores_document_edit_times(client, warehouse, monkeypatch):
    now = datetime(2026, 9, 12, 12)
    midnight = datetime(2026, 9, 11, 16)  # Factory timezone is UTC+8.
    monkeypatch.setattr(factory_overview, 'utcnow', lambda: now)
    times = [midnight - timedelta(seconds=1), midnight, now, now + timedelta(seconds=1), midnight + timedelta(days=1)]
    lots = [intake(client, warehouse, idempotency_key=f'daily-{i}').json() for i in range(len(times))]
    with SessionLocal() as db:
        for lot, at in zip(lots, times):
            row = db.get(MaterialTransfer, lot['id'])
            row.created_at = row.received_at = at
            row.updated_at = now
        db.commit()
    expected = [lots[2]['batch_no'], lots[1]['batch_no']]
    for days in (3, 30, 365):
        rows = client.get(f'/api/factory-overview?days={days}').json()['recent_batches']
        assert [row['batch_no'] for row in rows] == expected
    monkeypatch.setattr(factory_overview, 'utcnow', lambda: now + timedelta(days=1))
    assert [row['batch_no'] for row in report(client)['recent_batches']] == [lots[4]['batch_no']]
    monkeypatch.setattr(factory_overview, 'utcnow', lambda: now + timedelta(days=2))
    assert report(client)['recent_batches'] == []


def test_today_feed_includes_yesterdays_batches_received_or_shipped_today(client, outbound, monkeypatch):
    internal = dispatch(client, outbound, entry_kind='transfer', external_destination=None,
        next_team_id=outbound['other']['id'], idempotency_key='daily-internal').json()['items']
    assert client.post(f"/api/material-transfers/{internal[0]['batch_no']}/confirm", headers=outbound['other_headers'],
        json={'idempotency_key': 'daily-receive'}).status_code == 200
    external = dispatch(client, outbound, idempotency_key='daily-external').json()['items']
    assert external[0]['status'] == 'dispatched'
    now = datetime(2026, 9, 12, 12)
    monkeypatch.setattr(factory_overview, 'utcnow', lambda: now)
    with SessionLocal() as db:
        for row in db.query(MaterialTransfer).all():
            row.created_at = now - timedelta(days=1)
            if row.received_at:
                row.received_at = row.created_at
            if row.dispatched_at:
                row.dispatched_at = row.created_at
            row.updated_at = now  # An unrelated edit does not qualify old batches.
        db.get(MaterialTransfer, internal[1]['id']).created_at = now - timedelta(minutes=15)
        db.get(MaterialTransfer, internal[0]['id']).received_at = now - timedelta(minutes=10)
        db.get(MaterialTransfer, external[0]['id']).dispatched_at = now - timedelta(minutes=5)
        db.commit()
    rows = report(client)['recent_batches']
    assert [row['batch_no'] for row in rows] == [external[0]['batch_no'], internal[0]['batch_no'], internal[1]['batch_no']]
    assert [row['status'] for row in rows] == ['dispatched', 'received', 'pending']


def test_missing_scope_empty_validation_and_login(client):
    d = report(client)
    assert len(d['teams']) == 8 and all(team['balance'] is None for team in d['teams'])
    assert all(team['serial_count'] is None and team['pending_incoming'] is None and team['urgent_serial_count'] is None for team in d['teams'])
    assert d['totals']['on_hand_quantity'] == 0 and d['pending']['batches'] == 0
    assert len(d['trend']) == 30
    for days in (1, 3, 14, 365):
        response = client.get(f'/api/factory-overview?days={days}')
        assert response.status_code == 200, response.text
        assert response.json()['days'] == days and len(response.json()['trend']) == days
    for days in ('0', '-1', '366', '3.5', 'invalid'):
        assert client.get(f'/api/factory-overview?days={days}').status_code == 422
    original = client.headers.pop('Authorization')
    try:
        assert client.get('/api/factory-overview').status_code == 401
    finally:
        client.headers['Authorization'] = original


def test_custom_period_uses_factory_day_boundary_without_filtering_current_stock(client, warehouse, monkeypatch):
    now = datetime(2026, 9, 12, 12)
    monkeypatch.setattr(factory_overview, 'utcnow', lambda: now)
    before = intake(client, warehouse, idempotency_key='before-custom-range').json()
    included = intake(client, warehouse, idempotency_key='inside-custom-range').json()
    with SessionLocal() as db:
        # Near 3 days starts at local midnight on September 10 (UTC+8).
        db.get(MaterialTransfer, before['id']).received_at = datetime(2026, 9, 9, 15, 59, 59)
        db.get(MaterialTransfer, included['id']).received_at = datetime(2026, 9, 9, 16)
        db.commit()
    short = client.get('/api/factory-overview?days=3').json()
    longer = client.get('/api/factory-overview?days=7').json()
    assert [row['key'] for row in short['trend']] == ['2026-09-10', '2026-09-11', '2026-09-12']
    assert short['period_totals']['inbound']['quantity'] == 100
    assert short['trend'][0]['inbound']['quantity'] == 100
    assert longer['period_totals']['inbound']['quantity'] == 200
    assert short['totals']['on_hand_quantity'] == longer['totals']['on_hand_quantity'] == 200
    assert short['material_types'] == longer['material_types']


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
