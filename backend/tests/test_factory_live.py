from datetime import datetime, timedelta

from app import factory_overview
from app.database import SessionLocal
from app.models import MaterialTransfer
from test_external_outbound import outbound, dispatch, confirm
from test_warehouse_receipts import warehouse, intake
import pytest


def live(client):
    response = client.get('/api/factory-overview/live')
    assert response.status_code == 200, response.text
    return response.json()


def test_live_preserves_eight_positions_and_requires_login(client):
    data = live(client)
    assert [team['name'] for team in data['teams']] == ['库房', '轧制', '退火', '研磨', '线切割', '雕刻', '电镀', '检验']
    assert all(team['id'] is None and team['incoming'] is None for team in data['teams'])
    assert all(team['pending_transfers'] == [] for team in data['teams'])
    assert data['links'] == [] and data['recent_batches'] == []
    assert data['material_stock'] == []
    original = client.headers.pop('Authorization')
    try:
        assert client.get('/api/factory-overview/live').status_code == 401
    finally:
        client.headers['Authorization'] = original


def test_internal_ck_lines_count_once_and_partial_is_real(client, outbound):
    group = dispatch(client, outbound, entry_kind='transfer', external_destination=None, next_team_id=outbound['other']['id']).json()
    data = live(client)
    source = next(t for t in data['teams'] if t['id'] == outbound['team']['id'])
    target = next(t for t in data['teams'] if t['id'] == outbound['other']['id'])
    assert source['outgoing'] == target['incoming'] == 1
    link = next(l for l in data['links'] if l['target_id'] == target['id'])
    assert link == dict(source_id=source['id'], target_id=target['id'], pending_batches=1, confirmed_batches=0)
    row = next(b for b in data['recent_batches'] if b['batch_no'] == group['dispatch_no'])
    assert row['source_id'] == source['id'] and row['target_id'] == target['id']
    assert row['line_count'] == 2 and row['quantity'] == 60
    assert source['pending_transfers'] == []
    assert data['material_stock'] == [{'key': '铜钼', 'quantity': 140, 'weight': 14}]
    receipts = target['pending_transfers']
    assert sorted(r['serial_no'] for r in receipts) == ['EXTERNAL-0', 'EXTERNAL-1']
    assert all(r['batch_no'] == group['dispatch_no'] and r['source_id'] == source['id'] for r in receipts)
    assert all(r['quantity'] == 30 and r['weight'] == 3 for r in receipts)
    response = client.post(f"/api/material-transfers/{group['items'][0]['batch_no']}/confirm", headers=outbound['other_headers'], json={'idempotency_key': 'live-partial'})
    assert response.status_code == 200
    data = live(client)
    assert next(b for b in data['recent_batches'] if b['batch_no'] == group['dispatch_no'])['status'] == 'partial'
    link = next(l for l in data['links'] if l['target_id'] == target['id'])
    assert link['pending_batches'] == link['confirmed_batches'] == 1
    assert data['totals']['on_hand_quantity'] == 170
    assert data['totals']['in_transit_quantity'] == 30
    assert data['material_stock'] == [{'key': '铜钼', 'quantity': 170, 'weight': 17}]
    receipts = next(t for t in data['teams'] if t['id'] == target['id'])['pending_transfers']
    assert len(receipts) == 1 and receipts[0]['serial_no'] == 'EXTERNAL-1'
    assert receipts[0]['quantity'] == 30
    response = client.post(f"/api/material-transfers/{group['items'][1]['batch_no']}/confirm",
        headers=outbound['other_headers'], json={'idempotency_key': 'live-final'})
    assert response.status_code == 200
    assert next(t for t in live(client)['teams'] if t['id'] == target['id'])['pending_transfers'] == []
    assert live(client)['material_stock'] == [{'key': '铜钼', 'quantity': 200, 'weight': 20}]


def test_external_outbound_has_no_fictitious_receiving_node(client, outbound):
    group = dispatch(client, outbound).json()
    data = live(client)
    row = next(b for b in data['recent_batches'] if b['batch_no'] == group['dispatch_no'])
    assert row['target_id'] is None and row['external_destination'] == '客户 A / 外部仓库'
    assert not any(l['source_id'] == outbound['team']['id'] for l in data['links'])
    assert all(t['pending_transfers'] == [] for t in data['teams'])
    assert next(t for t in data['teams'] if t['id'] == outbound['team']['id'])['outgoing'] == 1
    for line in group['items']:
        assert confirm(client, outbound, line).status_code == 200
    assert next(t for t in live(client)['teams'] if t['id'] == outbound['team']['id'])['outgoing'] == 0


def test_background_edges_use_confirmation_time_and_keep_old_pending(client, outbound, monkeypatch):
    group = dispatch(client, outbound, entry_kind='transfer', external_destination=None, next_team_id=outbound['other']['id']).json()
    now = datetime(2026, 9, 12, 12)
    monkeypatch.setattr(factory_overview, 'utcnow', lambda: now)
    with SessionLocal() as db:
        a, b = [db.get(MaterialTransfer, line['id']) for line in group['items']]
        a.created_at = b.created_at = now - timedelta(days=90)
        a.status = 'received'
        a.received_at = now - timedelta(hours=25)
        db.commit()
    link = next(l for l in live(client)['links'] if l['target_id'] == outbound['other']['id'])
    assert link['pending_batches'] == 1 and link['confirmed_batches'] == 0
    with SessionLocal() as db:
        a, b = [db.get(MaterialTransfer, line['id']) for line in group['items']]
        a.received_at = now - timedelta(hours=2)
        b.status = 'voided'
        db.commit()
    link = next(l for l in live(client)['links'] if l['target_id'] == outbound['other']['id'])
    assert link['pending_batches'] == 0 and link['confirmed_batches'] == 1


def test_live_material_and_serial_summary_uses_entire_batch(client, outbound):
    group = dispatch(client, outbound, entry_kind='transfer', external_destination=None, next_team_id=outbound['other']['id']).json()
    with SessionLocal() as db:
        a, b = [db.get(MaterialTransfer, line['id']) for line in group['items']]
        a.serial_no = b.serial_no = 'SAME-SERIAL'
        a.material_name, b.material_name = '6061铝', '紫铜'
        a.created_at, b.created_at = datetime(2026, 9, 10, 1), datetime(2026, 9, 11, 1)
        db.commit()
    row = next(b for b in live(client)['recent_batches'] if b['batch_no'] == group['dispatch_no'])
    assert row['serial_count'] == 1 and row['line_count'] == 2
    assert row['material_count'] == 2 and row['material_name'] is None
    assert row['waiting_since'].startswith('2026-09-10T01:00:00')
    with SessionLocal() as db:
        db.get(MaterialTransfer, group['items'][0]['id']).status = 'voided'
        db.commit()
    row = next(b for b in live(client)['recent_batches'] if b['batch_no'] == group['dispatch_no'])
    assert row['material_name'] == '紫铜' and row['material_count'] == 1
    assert row['quantity'] == 30 and row['waiting_since'].startswith('2026-09-11T01:00:00')


def test_today_counts_internal_submission_and_complete_receipt_once(client, outbound, monkeypatch):
    group = dispatch(client, outbound, entry_kind='transfer', external_destination=None, next_team_id=outbound['other']['id']).json()
    now = datetime(2026, 9, 12, 2)
    monkeypatch.setattr(factory_overview, 'utcnow', lambda: now)
    with SessionLocal() as db:
        # Before today's Asia/Shanghai midnight, regardless of the created date.
        for row in db.query(MaterialTransfer).filter(MaterialTransfer.status == 'received'):
            row.created_at = datetime(2026, 9, 11, 15, 59)
            row.received_at = datetime(2026, 9, 11, 15, 59)
        a = db.get(MaterialTransfer, group['items'][0]['id'])
        a.created_at = datetime(2026, 9, 11, 16)
        db.get(MaterialTransfer, group['items'][1]['id']).created_at = datetime(2026, 9, 11, 15, 59)
        a.status, a.received_at = 'received', datetime(2026, 9, 11, 16)
        db.commit()
    assert live(client)['today'] == {'outgoing_quantity': 30, 'received_batches': 0}
    with SessionLocal() as db:
        b = db.get(MaterialTransfer, group['items'][1]['id'])
        b.status, b.received_at = 'received', now
        db.commit()
    assert live(client)['today'] == {'outgoing_quantity': 30, 'received_batches': 1}


def test_live_feed_is_not_limited_to_three_or_twelve_rows(client, outbound):
    for i in range(24):
        response = dispatch(client, outbound, idempotency_key=f'live-feed-{i}',
            lines=[{'source_transfer_id': outbound['lots'][0]['id'], 'quantity': 1, 'weight': 0.1}])
        assert response.status_code == 201, response.text
    data = live(client)
    rows = data['recent_batches']
    assert len(rows) >= 24
    assert len({row['batch_no'] for row in rows}) == len(rows)
    source = next(team for team in data['teams'] if team['id'] == outbound['team']['id'])
    assert source['pending_transfers'] == []
    assert len(client.get('/api/factory-overview').json()['recent_batches']) == 12

def test_pending_rows_aggregate_same_serial_without_repeating_ck_totals(client, outbound):
    group = dispatch(client, outbound, entry_kind='transfer', external_destination=None,
        next_team_id=outbound['other']['id']).json()
    with SessionLocal() as db:
        a, b = [db.get(MaterialTransfer, line['id']) for line in group['items']]
        a.serial_no = b.serial_no = 'SAME-SERIAL'
        db.commit()
    rows = next(t for t in live(client)['teams'] if t['id'] == outbound['other']['id'])['pending_transfers']
    assert len(rows) == 1 and rows[0]['quantity'] == 60 and rows[0]['weight'] == 6
    assert rows[0]['source_name'] == outbound['team']['name']
    with SessionLocal() as db:
        db.get(MaterialTransfer, group['items'][0]['id']).status = 'voided'
        db.commit()
    rows = next(t for t in live(client)['teams'] if t['id'] == outbound['other']['id'])['pending_transfers']
    assert len(rows) == 1 and rows[0]['quantity'] == 30 and rows[0]['weight'] == 3


def test_pending_team_feed_keeps_more_than_three_records(client, outbound):
    for i in range(24):
        response = dispatch(client, outbound, entry_kind='transfer', external_destination=None,
            next_team_id=outbound['other']['id'], idempotency_key=f'pending-feed-{i}',
            lines=[{'source_transfer_id': outbound['lots'][0]['id'], 'quantity': 1, 'weight': 0.1}])
        assert response.status_code == 201, response.text
    rows = next(t for t in live(client)['teams'] if t['id'] == outbound['other']['id'])['pending_transfers']
    assert len(rows) == 24
    assert len({row['batch_no'] for row in rows}) == 24
    assert all(row['quantity'] == 1 and row['weight'] == 0.1 for row in rows)


def test_material_stock_groups_exact_grades_across_natures_and_does_not_limit_to_eight(client, warehouse):
    for i, (name, kind, weight) in enumerate([
        ('铜钼 CuMo70', 'semi_finished', '10.125'),
        ('铜钼 CuMo70', 'waste', '1.250'),
        ('铜钼 CuMo50', 'finished', '3.005'),
        ('钨铜 WCu80', 'raw_material', '2.010'),
        *[(f'材质-{n:02}', 'semi_finished', '0.001') for n in range(10)],
    ]):
        response = intake(client, warehouse, serial_no=f'MATERIAL-{i}', material_name=name,
            material_type=kind, quantity=1, weight=weight, idempotency_key=f'material-{i}')
        assert response.status_code == 201, response.text
    data = live(client)
    rows = {row['key']: row for row in data['material_stock']}
    assert len(rows) == 13
    assert rows['铜钼 CuMo70'] == {'key': '铜钼 CuMo70', 'quantity': 2, 'weight': 11.375}
    assert rows['铜钼 CuMo50']['weight'] == 3.005
    assert rows['钨铜 WCu80']['weight'] == 2.01
    assert sum(row['weight'] for row in rows.values()) == pytest.approx(data['totals']['on_hand_weight'])
    assert [row['key'] for row in data['material_stock']] == sorted(rows)


def test_material_stock_retains_unknown_grades_and_excludes_untracked_origins(client, warehouse):
    lots = [intake(client, warehouse, idempotency_key=f'legacy-material-{i}').json() for i in range(3)]
    with SessionLocal() as db:
        db.get(MaterialTransfer, lots[0]['id']).material_name = None
        db.get(MaterialTransfer, lots[1]['id']).material_name = '  '
        legacy = db.get(MaterialTransfer, lots[2]['id'])
        legacy.entry_kind = 'transfer'
        legacy.source_team_id = warehouse['other']['id']
        legacy.source_team_code = warehouse['other']['code']
        legacy.source_team_name = warehouse['other']['name']
        legacy.stock_tracked = False
        db.commit()
    assert live(client)['material_stock'] == [{'key': '未填写材质', 'quantity': 200, 'weight': 20.25}]


def test_material_stock_external_exit_and_loss_follow_physical_balances(client, outbound):
    group = dispatch(client, outbound).json()
    assert live(client)['material_stock'][0]['weight'] == 20
    for line in group['items']:
        assert confirm(client, outbound, line).status_code == 200
    assert live(client)['material_stock'][0]['weight'] == 14
    response = client.post(outbound['url'] + '/losses', headers=outbound['headers'], json={
        'source_transfer_id': outbound['lots'][0]['id'], 'quantity': 1, 'weight': '0.125',
        'reason': '清点丢失', 'idempotency_key': 'material-loss'})
    assert response.status_code == 201, response.text
    assert live(client)['material_stock'] == [{'key': '铜钼', 'quantity': 139, 'weight': 13.875}]
