"""All workshops share source/type stock grouping without changing receipt rules."""
from datetime import datetime, timedelta

import pytest

from app.database import SessionLocal
from app.models import MaterialTransfer, utcnow
from test_material_transfers import _leader, _team
from test_warehouse_receipts import warehouse, intake
from test_warehouse_classification import dispatch, confirm


def get_inventory(client, team_id, **params):
    response = client.get(f'/api/team-materials/{team_id}/inventory', params=params)
    assert response.status_code == 200, response.text
    return response.json()


def incoming(client, source_headers, target_headers, target_id, key, **overrides):
    response = client.post('/api/material-transfers', headers=source_headers, json={
        'serial_no': '000007', 'material_name': '铜钼', 'transfer_specification': '20 × 30',
        'material_type': 'semi_finished', 'next_team_id': target_id,
        'quantity': 10, 'weight': 1, 'idempotency_key': key, **overrides})
    assert response.status_code == 201, response.text
    row = response.json()
    response = client.post('/api/material-transfers/' + row['batch_no'] + '/confirm',
                           headers=target_headers, json={'idempotency_key': key + '-receive'})
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize('name', ['轧制', '退火', '研磨', '线切割', '雕刻', '电镀', '检验'])
def test_seven_workshops_share_classified_inventory(client, warehouse, name):
    s = warehouse
    team = _team(client, 'CLASSIFIED', f'{name}（分类验证）')
    _, headers = _leader(client, 'classified-leader', team['id'])
    first = incoming(client, s['headers'], headers, team['id'], 'first')
    second = incoming(client, s['headers'], headers, team['id'], 'second')
    incoming(client, s['headers'], headers, team['id'], 'finished', material_type='finished')
    incoming(client, s['headers'], headers, team['id'], 'spec', transfer_specification='40 × 60')
    incoming(client, s['other_headers'], headers, team['id'], 'peer')
    incoming(client, s['headers'], headers, team['id'], 'weight-only', quantity=0, weight='0.321', material_type='semi_finished_surplus')
    result = get_inventory(client, team['id'])
    assert result['total'] == 5
    row = next(row for row in result['items'] if row['group_id'] == first['id'])
    assert row['serial_no'] == '000007' and row['batch_count'] == 2
    assert row['on_hand_quantity'] == 20 and row['on_hand_weight'] == 2
    assert row['source_name'] == '库房' and row['receipt_source'] == 'internal'
    prefix = f"/api/team-materials/{team['id']}/inventory"
    sources = client.get(prefix + f"/{first['id']}/sources").json()
    assert {item['transfer']['id'] for item in sources['items']} == {first['id'], second['id']}
    assert get_inventory(client, team['id'], source_team_id=s['other']['id'])['total'] == 1
    assert get_inventory(client, team['id'], material_type='finished')['total'] == 1
    assert get_inventory(client, team['id'], source_team_id=s['other']['id'], material_type='finished')['total'] == 0
    assert get_inventory(client, team['id'], search_field='source', query='库房')['total'] == 4
    assert get_inventory(client, team['id'], search_field='on_hand_quantity', search_operator='gte', query='20')['total'] == 1
    assert get_inventory(client, team['id'], page_size=2, page=3)['items'][0]['on_hand_weight'] == .321
    overview = client.get(f"/api/team-materials/{team['id']}/overview").json()
    assert sum(row['on_hand_quantity'] for row in result['items']) == overview['totals']['on_hand_quantity']
    assert client.get(f"/api/team-materials/{s['other']['id']}/inventory/{first['id']}/sources").status_code == 404
    # Classified viewing must not grant warehouse entry or allow receipt of scrap.
    assert client.post(f"/api/team-materials/{team['id']}/receipts", headers=headers,
        json={'serial_no':'FORGED','material_name':'铜','material_type':'finished','quantity':1,'weight':1,'notes':'no','idempotency_key':'forged'}).status_code == 403
    assert client.post('/api/material-transfers', headers=s['headers'], json={
        'serial_no':'FORGED', 'next_team_id':team['id'], 'material_type':'scrap_chips',
        'quantity':0, 'weight':1, 'notes':'废屑', 'idempotency_key':'scrap-forged'}).status_code == 422


def test_group_outbound_loss_dates_confirmation_and_void_keep_balances(client, warehouse):
    s = warehouse
    raw = intake(client, s).json()
    sent = dispatch(client, s, [{'source_transfer_id':raw['id'], 'quantity':50, 'weight':5}]).json()
    assert get_inventory(client, s['other']['id'])['total'] == 0
    assert confirm(client, s, sent, workshop=True).status_code == 200
    lot = sent['items'][0]
    with SessionLocal() as db:
        row = db.get(MaterialTransfer, lot['id'])
        row.received_at = row.created_at = row.updated_at = datetime(2026, 9, 1, 3)
        db.commit()
    outgoing = dispatch(client, s, [{'source_transfer_id':lot['id'], 'quantity':20, 'weight':2}], workshop=True).json()
    assert client.post(f"/api/team-materials/{s['other']['id']}/losses", headers=s['other_headers'],
        json={'source_transfer_id':lot['id'], 'quantity':5, 'weight':.5, 'reason':'实物丢失', 'idempotency_key':'loss'}).status_code == 201
    row = get_inventory(client, s['other']['id'], date_from='2026-09-01', date_to='2026-09-01')['items'][0]
    assert row['on_hand_quantity'] == 25 and row['on_hand_weight'] == 2.5
    assert row['reserved_quantity'] == 20 and row['lost_quantity'] == 5
    assert confirm(client, s, outgoing).status_code == 200
    assert get_inventory(client, s['other']['id'])['items'][0]['on_hand_quantity'] == 25
    last = dispatch(client, s, [{'source_transfer_id':lot['id'], 'quantity':25, 'weight':2.5}], workshop=True, idempotency_key='last').json()
    assert get_inventory(client, s['other']['id'])['total'] == 0
    assert get_inventory(client, s['other']['id'], availability='all')['items'][0]['on_hand_quantity'] == 0
    prefix = f"/api/team-materials/{s['other']['id']}/inventory/{lot['id']}/sources"
    assert client.get(prefix).json()['total'] == 1
    assert client.get(prefix, params={'current_only':True}).json()['total'] == 0
    assert client.delete('/api/material-transfers/' + last['items'][0]['batch_no'], headers=s['other_headers']).status_code == 204
    assert get_inventory(client, s['other']['id'])['items'][0]['on_hand_quantity'] == 25
    # Reading another team's grouped inventory still gives no write authority.
    assert client.post(f"/api/team-materials/{s['other']['id']}/losses", headers=s['headers'],
        json={'source_transfer_id':lot['id'], 'quantity':1, 'weight':.1, 'reason':'forged','idempotency_key':'denied'}).status_code == 403


def test_warehouse_alias_and_authentication_remain_compatible(client, warehouse):
    s = warehouse
    intake(client, s)
    assert get_inventory(client, s['team']['id']) == client.get(f"/api/team-materials/{s['team']['id']}/warehouse-inventory").json()
    client.headers.pop('Authorization')
    assert client.get(f"/api/team-materials/{s['other']['id']}/inventory").status_code == 401
    assert client.get(f"/api/team-materials/{s['other']['id']}/inventory/1/sources").status_code == 401


def test_purposes_partition_balances_search_and_source_selection(client, warehouse):
    s = warehouse
    target = s['other']['id']
    endpoint = f'/api/team-materials/{target}/purposes'
    purposes = []
    for name in ('检验', '去毛刺'):
        response = client.post(endpoint, headers=s['other_headers'], json={'name': name})
        assert response.status_code == 201, response.text
        purposes.append(response.json())
    first = incoming(client, s['headers'], s['other_headers'], target, 'inspect-a', purpose_id=purposes[0]['id'])
    second = incoming(client, s['headers'], s['other_headers'], target, 'inspect-b', purpose_id=purposes[0]['id'])
    incoming(client, s['headers'], s['other_headers'], target, 'deburr', purpose_id=purposes[1]['id'])
    result = get_inventory(client, target)
    assert result['total'] == 2
    inspection = next(row for row in result['items'] if row['purpose_name'] == '检验')
    assert inspection['on_hand_quantity'] == 20 and inspection['current_batch_count'] == 2
    assert get_inventory(client, target, search_field='purpose_name', query='毛刺')['total'] == 1
    assert get_inventory(client, target, query='检验')['items'][0]['on_hand_quantity'] == 20
    sources = client.get(f"/api/team-materials/{target}/inventory/{first['id']}/sources").json()
    assert {row['transfer']['id'] for row in sources['items']} == {first['id'], second['id']}
    # Keep historical purpose snapshots separate when a label is later renamed.
    assert client.patch(endpoint + f"/{purposes[0]['id']}", headers=s['other_headers'],
                        json={'name': '复检', 'expected_version': 1}).status_code == 200
    incoming(client, s['headers'], s['other_headers'], target, 'recheck', purpose_id=purposes[0]['id'])
    assert get_inventory(client, target)['total'] == 3
    assert client.get(f"/api/team-materials/{target}/inventory/{first['id']}/sources").json()['total'] == 2


def test_oldest_receipt_uses_only_remaining_lots_and_classification_scope(client, warehouse):
    s = warehouse
    old = intake(client, s, idempotency_key='old', weight=10).json()
    recent = intake(client, s, idempotency_key='recent', weight=10).json()
    intake(client, s, idempotency_key='different', material_type='finished')
    now = utcnow()
    with SessionLocal() as db:
        db.get(MaterialTransfer, old['id']).received_at = now - timedelta(days=10)
        db.get(MaterialTransfer, recent['id']).received_at = now - timedelta(hours=2)
        db.commit()
    aged = get_inventory(client, s['team']['id'], stock_age='ge7')
    assert aged['total'] == 1  # Not the newer finished stock of the same serial.
    row = aged['items'][0]
    assert row['current_batch_count'] == 2
    assert datetime.fromisoformat(row['oldest_received_at']).replace(tzinfo=None) == now - timedelta(days=10)
    dispatch(client, s, [{'source_transfer_id': old['id'], 'quantity': 100, 'weight': 10}])
    assert get_inventory(client, s['team']['id'], stock_age='ge7')['total'] == 0
    row = next(row for row in get_inventory(client, s['team']['id'])['items'] if row['group_id'] == old['id'])
    assert row['current_batch_count'] == 1
    assert datetime.fromisoformat(row['oldest_received_at']).replace(tzinfo=None) == now - timedelta(hours=2)
    dispatch(client, s, [{'source_transfer_id': recent['id'], 'quantity': 100, 'weight': 10}], idempotency_key='last-age')
    row = next(row for row in get_inventory(client, s['team']['id'], availability='all')['items'] if row['group_id'] == old['id'])
    assert row['oldest_received_at'] is None and row['current_batch_count'] == 0


def test_weight_only_receipt_has_age_and_date_search(client, warehouse):
    s = warehouse
    intake(client, s, material_type='scrap_chips', quantity=0, weight=.625)
    row = get_inventory(client, s['team']['id'])['items'][0]
    assert row['current_batch_count'] == 1 and row['oldest_received_at']
    # The search uses factory-local dates, just like other date fields.
    from zoneinfo import ZoneInfo
    from app.config import settings
    day = datetime.fromisoformat(row['oldest_received_at']).astimezone(ZoneInfo(settings.factory_timezone)).date().isoformat()
    assert get_inventory(client, s['team']['id'], query=day, search_field='oldest_received_at')['total'] == 1
    assert client.get(f"/api/team-materials/{s['team']['id']}/inventory", params={
        'query': 'wrong', 'search_field': 'oldest_received_at'}).status_code == 422
