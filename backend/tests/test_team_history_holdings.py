"""Current ownership and dated dispatch history must not be conflated."""
from test_material_stock import stock_setup, dispatch
from test_team_business import initialize, history
from test_external_outbound import outbound, dispatch as external_dispatch, confirm as external_confirm


def test_pending_handoff_is_still_owned_and_confirmation_moves_it_once(client, stock_setup):
    s = stock_setup
    lot = initialize(client, s, weight='10.000')
    response = dispatch(client, s, [{'source_transfer_id': lot['id'], 'quantity': 100, 'weight': 10}])
    assert response.status_code == 201, response.text
    item = response.json()['items'][0]
    result = history(client, s)
    assert result['lots'][0]['closing_quantity'] == 0
    assert result['lots'][0]['owned_quantity'] == result['groups'][0]['owned_quantity'] == 100
    assert result['lots'][0]['owned_weight'] == result['groups'][0]['owned_weight'] == 10
    assert result['groups'][0]['events'][-1]['entry_kind'] == 'transfer'
    assert result['groups'][0]['events'][-1]['status'] == 'pending'
    assert client.post(f"/api/material-transfers/{item['batch_no']}/confirm", headers=s['third_headers'],
                       json={'idempotency_key': 'receive-owned'}).status_code == 200
    confirmed = history(client, s)
    assert confirmed['lots'][0]['owned_quantity'] == confirmed['groups'][0]['owned_quantity'] == 0
    assert confirmed['lots'][0]['closing_quantity'] == 0
    receiver = client.get(f"/api/team-materials/{s['third']['id']}/serial-history", params={'serial_no': '000012'}).json()
    assert receiver['lots'][0]['owned_quantity'] == 100


def test_external_pending_keeps_ownership_and_event_exposes_shipping_kind(client, outbound):
    response = external_dispatch(client, outbound)
    assert response.status_code == 201, response.text
    item = response.json()['items'][0]
    url = f"/api/team-materials/{item['source_team']['id']}/serial-history"
    result = client.get(url, params={'serial_no': item['serial_no']}).json()
    assert result['groups'][0]['owned_quantity'] == 100
    assert result['groups'][0]['on_hand_quantity'] == 70
    assert result['groups'][0]['events'][-1]['entry_kind'] == item['entry_kind']
    assert external_confirm(client, outbound, item).status_code == 200
    result = client.get(url, params={'serial_no': item['serial_no']}).json()
    assert result['groups'][0]['owned_quantity'] == 70
