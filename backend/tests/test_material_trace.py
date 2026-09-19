"""Genealogy is made of batch links; stock is the shared ledger, not the last row."""
from decimal import Decimal

from app.database import SessionLocal
from app.models import MaterialTransfer
from test_material_stock import stock_setup, dispatch, loss, receive_lot
from test_team_business import initialize
from test_external_outbound import outbound, dispatch as external_dispatch, confirm as external_confirm


def trace(client, serial='000012'):
    response = client.get('/api/material-trace', params={'serial_no': serial})
    assert response.status_code == 200, response.text
    return response.json()


def test_split_pending_receipt_return_void_and_losses_share_the_stock_ledger(client, stock_setup):
    s = stock_setup
    root = initialize(client, s, weight='10.000')
    response = dispatch(client, s, [
        {'source_transfer_id': root['id'], 'quantity': 30, 'weight': 3},
        {'source_transfer_id': root['id'], 'quantity': 20, 'weight': 2},
    ])
    assert response.status_code == 201, response.text
    first, second = response.json()['items']
    assert client.post(f"/api/material-transfers/{first['batch_no']}/confirm", headers=s['third_headers'],
                       json={'idempotency_key': 'receive-first'}).status_code == 200
    back = client.post(f"/api/team-materials/{s['third']['id']}/dispatches", headers=s['third_headers'], json={
        'next_team_id': s['target']['id'], 'idempotency_key': 'return',
        'lines': [{'source_transfer_id': first['id'], 'quantity': 10, 'weight': 1}],
    })
    assert back.status_code == 201, back.text
    returned = back.json()['items'][0]
    assert loss(client, s, root).status_code == 201
    data = trace(client)
    assert data['totals']['on_hand'] == {'quantity': 68, 'weight': 6.8}
    assert data['totals']['in_transit'] == {'quantity': 30, 'weight': 3}
    assert data['totals']['lost'] == {'quantity': 2, 'weight': .2}
    rows = {row['id']: row for row in data['items']}
    assert rows[first['id']]['source_transfer_id'] == root['id']
    assert rows[second['id']]['source_transfer_id'] == root['id']
    assert rows[returned['id']]['source_transfer_id'] == first['id']
    assert rows[returned['id']]['on_hand_quantity'] is None
    assert rows[root['id']]['on_hand_quantity'] == 48
    assert rows[root['id']]['loss_records'][0]['reason'] == '清点发现丢失'
    assert {p['team_id']: p['quantity'] for p in data['positions']} == {s['target']['id']: 48, s['third']['id']: 20}
    assert client.post(f"/api/material-transfers/{returned['batch_no']}/confirm", headers=s['target_headers'],
                       json={'idempotency_key': 'receive-return'}).status_code == 200
    assert client.delete(f"/api/material-transfers/{second['batch_no']}", headers=s['target_headers']).status_code == 204
    data = trace(client)
    assert data['totals']['on_hand'] == {'quantity': 98, 'weight': 9.8}
    assert data['totals']['in_transit'] == {'quantity': 0, 'weight': 0}
    assert len(data['items']) == 4  # Voided branches remain auditable.
    assert {p['team_id']: p['quantity'] for p in data['positions']} == {s['target']['id']: 78, s['third']['id']: 20}


def test_exact_identity_untracked_history_and_weight_only_stock(client, stock_setup):
    initialize(client, stock_setup, quantity=0, weight='1.234', material_type='scrap_chips')
    data = trace(client, ' 000012 ')
    assert data['serial_no'] == '000012'
    assert data['totals']['on_hand'] == {'quantity': 0, 'weight': 1.234}
    assert data['positions'][0]['quantity'] == 0
    assert trace(client, '12')['items'] == []
    legacy = receive_lot(client, stock_setup)
    with SessionLocal() as db:
        db.get(MaterialTransfer, legacy['id']).stock_tracked = False
        db.commit()
    old = trace(client, legacy['serial_no'])
    assert old['untracked_count'] == 1
    assert old['items'][0]['on_hand_quantity'] is None
    assert old['totals']['on_hand'] == {'quantity': 0, 'weight': 0}


def test_external_pending_and_confirmed_are_not_recipient_stock(client, outbound):
    response = external_dispatch(client, outbound)
    assert response.status_code == 201, response.text
    row = response.json()['items'][0]
    before = trace(client, row['serial_no'])
    assert before['totals']['on_hand'] == {'quantity': 70, 'weight': 7}
    assert before['totals']['in_transit']['quantity'] == 0
    assert before['totals']['external_pending'] == {'quantity': 30, 'weight': 3}
    assert external_confirm(client, outbound, row).status_code == 200
    after = trace(client, row['serial_no'])
    assert after['totals']['on_hand'] == before['totals']['on_hand']
    assert after['totals']['external_pending']['quantity'] == 0
    assert after['totals']['dispatched'] == {'quantity': 30, 'weight': 3}
    assert len(after['positions']) == 1


def test_full_trace_has_no_list_pagination_cutoff_and_requires_auth(client, stock_setup):
    team = stock_setup['target']
    with SessionLocal() as db:
        for i in range(125):
            db.add(MaterialTransfer(batch_no=f'TRACE-{i:04}', serial_no='000012', entry_kind='opening_stock',
                next_team_id=team['id'], next_team_code=team['code'], next_team_name=team['name'],
                quantity=1, weight=Decimal('.001'), status='received', stock_tracked=True, created_by='test'))
        db.commit()
    data = trace(client)
    assert len(data['items']) == 125
    assert data['totals']['on_hand'] == {'quantity': 125, 'weight': .125}
    assert client.get('/api/material-trace', params={'serial_no': ' '}).status_code == 422
    assert client.get('/api/material-trace', params={'serial_no': '000012'}, headers={'Authorization': ''}).status_code == 401
    for role in ('source', 'target', 'third'):
        response = client.get('/api/material-trace', params={'serial_no': '000012'}, headers=stock_setup[f'{role}_headers'])
        assert response.status_code == 403
