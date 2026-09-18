from datetime import datetime
import pytest
from sqlalchemy import func, select
from app.database import SessionLocal
from app.models import MaterialTransfer, MaterialLoss, SerialUrgencyEvent
from app.factory_overview import recent_batches
from test_material_stock import stock_setup, receive_lot, dispatch, loss, endpoint, totals
from test_warehouse_receipts import warehouse, intake


def mark(client, serial, urgent=True, version=0, **values):
    return client.put('/api/serial-urgency', json={
        'serial_no': serial, 'urgent': urgent, 'expected_version': version, 'reason': '客户交期提前', **values})


def stamp(lot, **values):
    with SessionLocal() as db:
        row = db.get(MaterialTransfer, lot['id'])
        for key, value in values.items():
            setattr(row, key, value)
        db.commit()


def test_urgency_global_read_only_stock_and_optimistic_cancel(client, stock_setup):
    s = stock_setup
    lot = receive_lot(client, s)
    other = receive_lot(client, s, key='ordinary')
    group = dispatch(client, s, [{'source_transfer_id': lot['id'], 'quantity': 10, 'weight': 1},
                                {'source_transfer_id': other['id'], 'quantity': 10, 'weight': 1}]).json()
    assert loss(client, s, lot).status_code == 201
    before = totals(client, s)
    body = {'serial_no': lot['serial_no'], 'urgent': True, 'expected_version': 0}
    assert client.put('/api/serial-urgency', headers=s['stock_headers'], json=body).status_code == 403
    flag = mark(client, lot['serial_no'])
    assert flag.status_code == 200, flag.text
    assert flag.json()['version'] == 1 and flag.json()['updated_by']
    assert totals(client, s) == before
    detail = client.get(f"/api/material-transfers/{lot['batch_no']}").json()
    assert detail['version'] == lot['version'] and detail['history'] == lot['history']
    assert detail['urgency']['urgent'] and detail['locked']
    for suffix in ('serials', 'stock', 'losses', 'dispatches'):
        result = client.get(endpoint(s, suffix+'?urgent_only=true')).json()
        assert result['total'] == 1, (suffix, result)
    records = client.get('/api/material-transfers', params={'urgent_only': True}).json()
    assert all(row['serial_no'] == lot['serial_no'] for row in records['items'])
    incoming = client.get(f"/api/team-materials/{s['third']['id']}/serials?urgent_only=true").json()
    assert incoming['total'] == 1 and incoming['items'][0]['urgency']['urgent']
    batches = [client.get('/api/material-transfers/' + item['batch_no']).json() for item in group['items']]
    assert [line['urgency']['urgent'] for line in batches] == [True, False]
    with SessionLocal() as db:
        feed = recent_batches(db, True, 100)
        assert next(row for row in feed if row['batch_no'] == batches[0]['batch_no'])['urgent_serial_count'] == 1
    assert mark(client, lot['serial_no'], False, 0).status_code == 409
    assert mark(client, lot['serial_no'], False, 1).status_code == 200
    assert client.get(endpoint(s, 'stock?urgent_only=true')).json()['total'] == 0
    assert totals(client, s) == before
    with SessionLocal() as db:
        assert db.scalar(select(func.count(SerialUrgencyEvent.id))) == 2


def test_date_filter_utc8_edges_and_pagination_before_count(client, stock_setup):
    s = stock_setup
    dates = [datetime(2026, 9, 11, 15, 59, 59), datetime(2026, 9, 11, 16),
             datetime(2026, 9, 12, 15, 59, 59), datetime(2026, 9, 12, 16)]
    lots = [receive_lot(client, s, key=f'date-{i}') for i in range(4)]
    for lot, time in zip(lots, dates):
        stamp(lot, created_at=time, received_at=time, updated_at=time)
    params = {'date_from': '2026-09-12', 'date_to': '2026-09-12', 'page_size': 1}
    for url in ('/api/material-transfers', endpoint(s, 'stock'), endpoint(s, 'serials')):
        result = client.get(url, params=params)
        assert result.status_code == 200, result.text
        assert result.json()['total'] == 2 and len(result.json()['items']) == 1
        assert client.get(url, params={**params, 'page': 3}).json()['items'] == []
    # A later deduction still belongs in a selected origin's CURRENT balance.
    assert dispatch(client, s, [{'source_transfer_id': lots[1]['id'], 'quantity': 10, 'weight': 1}]).status_code == 201
    result = client.get(endpoint(s, 'serials'), params={**params, 'serial_no': lots[1]['serial_no']}).json()
    assert result['items'][0]['on_hand_quantity'] == 90
    # A day without an activity kind must not silently return every serial.
    assert client.get(endpoint(s, 'serials?activity_day=2020-01-01')).json()['total'] == 0


def test_dispatch_and_loss_dates_use_own_registration_time(client, stock_setup):
    s = stock_setup
    lot = receive_lot(client, s)
    outgoing = dispatch(client, s, [{'source_transfer_id': lot['id'], 'quantity': 10, 'weight': 1}]).json()
    lost = loss(client, s, lot).json()
    with SessionLocal() as db:
        db.get(MaterialTransfer, outgoing['items'][0]['id']).created_at = datetime(2026, 9, 11, 16)
        db.get(MaterialLoss, lost['id']).created_at = datetime(2026, 9, 11, 16)
        db.commit()
    for suffix in ('dispatches', 'losses'):
        assert client.get(endpoint(s, suffix+'?date_from=2026-09-12&date_to=2026-09-12')).json()['total'] == 1
        assert client.get(endpoint(s, suffix+'?date_from=2026-09-11&date_to=2026-09-11')).json()['total'] == 0


def test_warehouse_intake_date_and_urgency(client, warehouse):
    lot = intake(client, warehouse).json()
    stamp(lot, received_at=datetime(2026, 9, 11, 16), created_at=datetime(2026, 9, 11, 16))
    assert mark(client, lot['serial_no']).status_code == 200
    params = {'date_from': '2026-09-12', 'date_to': '2026-09-12', 'urgent_only': True}
    assert client.get(warehouse['url'], params=params).json()['total'] == 1
    assert client.get(warehouse['url'], params={**params, 'date_to': '2026-09-11'}).status_code == 422


@pytest.mark.parametrize('suffix', ['stock', 'losses', 'dispatches', 'serials'])
def test_invalid_dates_rejected(client, stock_setup, suffix):
    assert client.get(endpoint(stock_setup, suffix+'?date_from=2026-09-13&date_to=2026-09-12')).status_code == 422
    assert client.get(endpoint(stock_setup, suffix+'?date_from=not-a-date')).status_code == 422


def test_urgency_invalid_and_unknown_serial(client, stock_setup):
    lot = receive_lot(client, stock_setup)
    assert mark(client, 'missing').status_code == 404
    assert mark(client, lot['serial_no'], reason='x'*501).status_code == 422
    assert mark(client, lot['serial_no'], reason='  ').json()['reason'] is None
    assert client.get('/api/serial-urgency?serial_no=missing').status_code == 404
