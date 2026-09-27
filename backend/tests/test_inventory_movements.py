"""Inventory detail keeps each receipt/outbound batch and its source identity."""
from test_warehouse_receipts import warehouse, intake
from test_warehouse_classification import base, dispatch, confirm


def movements(client, setup, group_id, workshop=False, **params):
    response = client.get(base(setup, workshop) + f'/inventory/{group_id}/movements', params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_each_batch_has_its_own_identity_status_and_paginated_source_scope(client, warehouse):
    s = warehouse
    origin = intake(client, s, external_source='供应商 A', quantity=100, weight=10).json()
    second = intake(client, s, external_source='供应商 A', quantity=20, weight=2, idempotency_key='second').json()
    excluded = intake(client, s, external_source='供应商 B', idempotency_key='other-source').json()
    confirmed = dispatch(client, s, [{'source_transfer_id': origin['id'], 'quantity': 60, 'weight': 6}], idempotency_key='confirmed').json()
    assert confirm(client, s, confirmed, workshop=True).status_code == 200
    pending = dispatch(client, s, [{'source_transfer_id': origin['id'], 'quantity': 20, 'weight': 2}], idempotency_key='pending').json()
    other = dispatch(client, s, [{'source_transfer_id': excluded['id'], 'quantity': 5, 'weight': .5}], idempotency_key='excluded').json()
    result = movements(client, s, origin['id'])
    assert result['total'] == 4
    by_id = {row['id']: row for row in result['items']}
    assert set(by_id) == {origin['id'], second['id'], confirmed['items'][0]['id'], pending['items'][0]['id']}
    assert other['items'][0]['id'] not in by_id
    assert len({row['batch_no'] for row in result['items']}) == 4
    for sent in (confirmed, pending):
        row = by_id[sent['items'][0]['id']]
        assert row['batch_no'] != origin['batch_no']
        assert row['source_transfer_batch_no'] == origin['batch_no']
    assert by_id[confirmed['items'][0]['id']]['status'] == 'received'
    assert by_id[pending['items'][0]['id']]['status'] == 'pending'
    pages = [movements(client, s, origin['id'], page=i, page_size=2) for i in (1, 2)]
    assert [len(page['items']) for page in pages] == [2, 2]
    assert {row['id'] for page in pages for row in page['items']} == set(by_id)
    assert client.get(base(s) + '/inventory').json()['items'][0]['on_hand_quantity'] == 40
    assert client.delete('/api/material-transfers/' + pending['items'][0]['batch_no'], headers=s['headers']).status_code == 204
    updated = movements(client, s, origin['id'])
    assert updated['total'] == 4
    assert next(row for row in updated['items'] if row['id'] == pending['items'][0]['id'])['status'] == 'voided'


def test_workshop_children_keep_changed_nature_and_exclude_other_source_groups(client, warehouse):
    s = warehouse
    origin = intake(client, s).json()
    received = dispatch(client, s, [{'source_transfer_id': origin['id'], 'quantity': 50, 'weight': 5}]).json()
    assert confirm(client, s, received, workshop=True).status_code == 200
    lot = received['items'][0]
    split = dispatch(client, s, [
        {'source_transfer_id': lot['id'], 'quantity': 30, 'weight': 3, 'material_type': 'finished'},
        {'source_transfer_id': lot['id'], 'quantity': 20, 'weight': 2, 'material_type': 'scrap_chips'},
    ], workshop=True, notes='废屑回收').json()
    rows = movements(client, s, lot['id'], workshop=True)['items']
    assert {row['id'] for row in rows} == {lot['id'], *(row['id'] for row in split['items'])}
    assert {row['material_type'] for row in rows} == {'semi_finished', 'finished', 'scrap_chips'}
    assert client.get(base(s) + f"/inventory/{lot['id']}/movements").status_code == 404
    assert client.get(base(s, True) + f"/inventory/{origin['id']}/movements").status_code == 404
    assert client.get(base(s) + f"/inventory/{origin['id']}/movements", params={'page_size': 101}).status_code == 422
    client.headers.pop('Authorization')
    assert client.get(base(s) + f"/inventory/{origin['id']}/movements").status_code == 401


def test_external_outbound_is_a_separate_batch_and_does_not_double_count_confirmation(client, warehouse):
    s = warehouse
    origin = intake(client, s).json()
    external = dispatch(client, s, [{'source_transfer_id': origin['id'], 'quantity': 10, 'weight': 1}],
                        next_team_id=None, entry_kind='warehouse_outbound', external_destination='客户').json()
    assert confirm(client, s, external, external=True).status_code == 200
    rows = movements(client, s, origin['id'])['items']
    assert len(rows) == 2
    shipped = next(row for row in rows if row['id'] != origin['id'])
    assert shipped['batch_no'] == external['items'][0]['batch_no']
    assert shipped['status'] == 'dispatched' and shipped['external_destination'] == '客户'
    assert shipped['quantity'] == 10 and float(shipped['weight']) == 1
