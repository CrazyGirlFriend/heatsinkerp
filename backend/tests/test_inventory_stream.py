import asyncio
import json
from decimal import Decimal
from unittest.mock import Mock

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app import factory_stream
from app.database import SessionLocal
from app.inventory_events import InventoryEvents, inventory_events
from app.main import app
from app.models import Team
from test_warehouse_receipts import warehouse, intake
from test_access_gate import make_gate
from test_external_outbound import outbound, dispatch
from app.access_gate import ACCESS_COOKIE_NAME


def test_stream_encodes_mysql_aggregate_decimals_as_rest_json_numbers():
    # MySQL SUM(integer) returns Decimal; SQLite tests normally return int.
    frame = factory_stream.message('inventory', {
        'recent_batches': [{'quantity': Decimal('30'), 'weight': Decimal('3.125')}],
    })
    assert json.loads(frame.split('data: ', 1)[1]) == {
        'recent_batches': [{'quantity': 30, 'weight': 3.125}],
    }


def test_events_only_after_commit_never_reads_rollbacks_or_savepoint_rollback(client, monkeypatch):
    publish = Mock()
    monkeypatch.setattr(inventory_events, 'publish', publish)
    with SessionLocal() as db:
        row = Team(code='EVENT-TEST', name='推送测试', kind='normal')
        db.add(row); db.flush()
        publish.assert_not_called()
        db.commit(); publish.assert_called_once()
        publish.reset_mock()
        db.commit(); publish.assert_not_called()
        row.name = '未提交'; db.flush(); db.rollback()
        db.commit(); publish.assert_not_called()
        with db.begin_nested() as nested:
            row.name = '回滚保存点'; db.flush(); nested.rollback()
        db.commit(); publish.assert_not_called()
        with db.begin_nested():
            row.name = '已提交保存点'; db.flush()
        publish.assert_not_called()
        db.commit(); publish.assert_called_once()
    publish.reset_mock()
    assert client.get('/api/factory-overview').status_code == 200
    publish.assert_not_called()


def test_notifications_fan_out_coalesce_and_release_subscribers():
    async def run():
        events = InventoryEvents()
        with events.subscribe() as first, events.subscribe() as second:
            await asyncio.to_thread(lambda: [events.publish() for _ in range(20)])
            await asyncio.wait_for(first.wait(), 1)
            assert second.is_set()
            first.clear(); second.clear()
            await asyncio.sleep(0)
            assert not first.is_set() and not second.is_set()
        assert not events._subscribers
    asyncio.run(run())


class LiveRequest:
    def __init__(self):
        self.app = app
        self.cookies = {}


@pytest.mark.parametrize('view', ['inventory', 'factory-live'])
def test_stream_emits_initial_state_then_actual_committed_receipt_dispatch_and_loss(client, warehouse, view):
    assert client.patch(f"/api/teams/{warehouse['other']['id']}", json={'code': 'FACTORY-ROLL'}).status_code == 200
    async def run():
        token = client.headers['Authorization'].split(' ', 1)[1]
        stream = factory_stream.inventory_stream(LiveRequest(), HTTPAuthorizationCredentials(scheme='Bearer', credentials=token), view)
        async def snapshot():
            frame = await asyncio.wait_for(anext(stream), 2)
            assert frame.startswith(f'event: {view}\n')
            data = json.loads(frame.split('data: ', 1)[1])
            if view == 'inventory':
                from test_factory_stock_matrix import assert_totals
                assert_totals(data)
            return data
        try:
            first = await snapshot()
            assert first['totals']['on_hand_quantity'] == 0
            if view == 'factory-live':
                assert first['material_stock'] == []
                assert first['material_types'] == []
                assert first['internal_pending'] == {'batches': 0, 'quantity': 0, 'weight': 0}
            lot = (await asyncio.to_thread(intake, client, warehouse)).json()
            stocked = await snapshot()
            assert stocked['totals']['on_hand_quantity'] == 100
            if view == 'factory-live':
                assert stocked['material_stock'] == [{'key': '铜钼', 'quantity': 100, 'weight': 10.125}]
                assert stocked['material_types'] == [{'key': 'semi_finished', 'quantity': 100, 'weight': 10.125}]
                assert stocked['teams'][0]['material_types'] == stocked['material_types']
            response = await asyncio.to_thread(client.post, f"/api/team-materials/{warehouse['team']['id']}/dispatches",
                headers=warehouse['headers'], json={'next_team_id': warehouse['other']['id'], 'idempotency_key': 'stream-out',
                'lines': [{'source_transfer_id': lot['id'], 'quantity': 30, 'weight': 3}]})
            assert response.status_code == 201, response.text
            moved = await snapshot()
            assert moved['totals']['on_hand_quantity'] == 70
            assert moved['totals']['in_transit_quantity'] == 30
            if view == 'factory-live':
                assert moved['material_stock'] == [{'key': '铜钼', 'quantity': 70, 'weight': 7.125}]
                assert moved['material_types'] == [{'key': 'semi_finished', 'quantity': 70, 'weight': 7.125}]
                assert moved['internal_pending'] == {'batches': 1, 'quantity': 30, 'weight': 3}
                assert moved['links'][0]['pending_quantity'] == 30
                assert moved['links'][0]['pending_weight'] == 3
            assert moved['teams'][1]['pending_incoming']['quantity'] == 30
            line = response.json()['items'][0]
            response = await asyncio.to_thread(client.post, f"/api/material-transfers/{line['batch_no']}/confirm",
                headers=warehouse['other_headers'], json={'idempotency_key': 'stream-receive'})
            assert response.status_code == 200, response.text
            received = await snapshot()
            assert received['totals']['on_hand_quantity'] == 100
            assert received['totals']['in_transit_quantity'] == 0
            if view == 'factory-live':
                assert received['material_stock'] == [{'key': '铜钼', 'quantity': 100, 'weight': 10.125}]
                assert received['material_types'] == stocked['material_types']
                assert received['teams'][1]['material_types'] == [{'key': 'semi_finished', 'quantity': 30, 'weight': 3}]
                assert received['internal_pending'] == {'batches': 0, 'quantity': 0, 'weight': 0}
                assert received['links'][0]['pending_batches'] == 0
                assert received['links'][0]['pending_quantity'] == 0
                assert received['links'][0]['pending_weight'] == 0
                assert received['links'][0]['confirmed_batches'] == 1
            assert received['teams'][1]['balance']['on_hand_quantity'] == 30
            assert received['teams'][1]['pending_incoming']['quantity'] == 0
            response = await asyncio.to_thread(client.post, f"/api/team-materials/{warehouse['team']['id']}/losses",
                headers=warehouse['headers'], json={'source_transfer_id': lot['id'], 'quantity': 2, 'weight': '.125',
                'reason': '清点丢失', 'idempotency_key': 'stream-loss'})
            assert response.status_code == 201, response.text
            lost = await snapshot()
            assert lost['totals']['on_hand_quantity'] == 98
            assert lost['teams'][0]['balance']['on_hand_quantity'] == 68
            if view == 'factory-live':
                assert lost['material_stock'] == [{'key': '铜钼', 'quantity': 98, 'weight': 10}]
            response = await asyncio.to_thread(client.put, '/api/serial-urgency',
                json={'serial_no': lot['serial_no'], 'urgent': True, 'expected_version': 0})
            assert response.status_code == 200
            urgent = await snapshot()
            assert urgent['teams'][0]['urgent_serial_count'] == 1
            # A new outbound draft and its void both push their committed state.
            response = await asyncio.to_thread(client.post, f"/api/team-materials/{warehouse['team']['id']}/dispatches",
                headers=warehouse['headers'], json={'next_team_id': warehouse['other']['id'], 'idempotency_key': 'stream-void',
                'lines': [{'source_transfer_id': lot['id'], 'quantity': 5, 'weight': .5}]})
            assert response.status_code == 201
            assert (await snapshot())['totals']['in_transit_quantity'] == 5
            batch = response.json()['items'][0]['batch_no']
            response = await asyncio.to_thread(client.delete, f'/api/material-transfers/{batch}', headers=warehouse['headers'])
            assert response.status_code == 204
            voided = await snapshot()
            assert voided['totals']['on_hand_quantity'] == 98
            assert voided['totals']['in_transit_quantity'] == 0
            # Logout revokes the existing connection, not just future connections.
            assert (await asyncio.to_thread(client.post, '/api/auth/logout')).status_code == 204
            assert (await asyncio.wait_for(anext(stream), 2)).startswith('event: auth-expired')
        finally:
            await stream.aclose()
        assert not inventory_events._subscribers
    asyncio.run(run())


@pytest.mark.parametrize('view', ['inventory', 'factory-live'])
def test_external_submission_and_confirmation_push_the_same_remaining_stock(client, outbound, view):
    async def run():
        token = client.headers['Authorization'].split(' ', 1)[1]
        stream = factory_stream.inventory_stream(LiveRequest(), HTTPAuthorizationCredentials(scheme='Bearer', credentials=token), view)
        async def snapshot():
            frame = await asyncio.wait_for(anext(stream), 2)
            assert frame.startswith(f'event: {view}\n')
            return json.loads(frame.split('data: ', 1)[1])
        try:
            assert (await snapshot())['totals']['on_hand_quantity'] == 200
            response = await asyncio.to_thread(dispatch, client, outbound)
            assert response.status_code == 201, response.text
            submitted = await snapshot()
            assert submitted['totals']['on_hand_quantity'] == submitted['totals']['available_quantity'] == 140
            assert submitted['totals']['on_hand_weight'] == submitted['totals']['available_weight'] == 14
            assert submitted['totals']['reserved_quantity'] == 60
            assert submitted['totals']['in_transit_quantity'] == 0
            if view == 'factory-live':
                assert submitted['material_stock'] == [{'key': '铜钼', 'quantity': 140, 'weight': 14}]
                assert all(not team['pending_transfers'] for team in submitted['teams'])
            for index, item in enumerate(response.json()['items']):
                url = '/api/material-transfers/' + item['batch_no']
                response = await asyncio.to_thread(client.post, url + '/confirm-outbound', headers=outbound['headers'],
                    json={'idempotency_key': 'stream-external-confirm-' + item['batch_no'], 'expected_version': item['version']})
                assert response.status_code == 200, response.text
                confirmed = await snapshot()
                assert confirmed['totals']['on_hand_quantity'] == 140
                assert confirmed['totals']['on_hand_weight'] == 14
                assert confirmed['totals']['reserved_quantity'] == (30 if index == 0 else 0)
            if view == 'factory-live':
                assert confirmed['material_stock'] == submitted['material_stock']
        finally:
            await stream.aclose()
        assert not inventory_events._subscribers
    asyncio.run(run())


def test_failed_and_replayed_business_writes_do_not_publish(client, warehouse, monkeypatch):
    publish = Mock()
    monkeypatch.setattr(inventory_events, 'publish', publish)
    assert intake(client, warehouse).status_code == 201
    publish.assert_called_once(); publish.reset_mock()
    assert intake(client, warehouse).status_code == 201
    assert intake(client, warehouse, quantity=999).status_code == 409
    publish.assert_not_called()
    monkeypatch.setattr('app.warehouse_receipts.workflow._record_event', Mock(side_effect=RuntimeError('audit failed')))
    assert intake(client, warehouse, idempotency_key='rollback-event').status_code == 500
    publish.assert_not_called()


def test_heartbeat_does_not_requery_inventory_and_expired_stream_stops(client, monkeypatch):
    async def run():
        read = Mock(return_value=factory_stream.message('inventory', {'as_of': 'now', 'totals': {}, 'teams': []}))
        monkeypatch.setattr(factory_stream, 'read_inventory', read)
        monkeypatch.setattr(factory_stream, 'HEARTBEAT_SECONDS', .01)
        stream = factory_stream.inventory_stream(LiveRequest(), None)
        try:
            assert (await anext(stream)).startswith('event: inventory')
            assert (await anext(stream)) == ': heartbeat\n\n'
            assert read.call_args.kwargs == {'snapshot': False}
            read.side_effect = HTTPException(401)
            assert (await anext(stream)).startswith('event: auth-expired')
            with pytest.raises(StopAsyncIteration):
                await anext(stream)
        finally:
            await stream.aclose()
        assert not inventory_events._subscribers
    asyncio.run(run())


@pytest.mark.parametrize('path,event', [('/stream', 'inventory'), ('/live/stream', 'factory-live'), ('/changes', 'inventory-changed')])
def test_stream_http_auth_and_sse_headers_without_buffering(client, path, event):
    # Drive ASGI directly: TestClient.stream buffers an infinite response.
    async def run():
        output = asyncio.Queue()
        disconnected = asyncio.Event()
        async def send(message):
            await output.put(message)
        async def receive():
            await disconnected.wait()
            return {'type': 'http.disconnect'}
        scope = {'type': 'http', 'asgi': {'version': '3.0', 'spec_version': '2.3'}, 'http_version': '1.1',
            'method': 'GET', 'scheme': 'http', 'path': '/api/factory-overview' + path, 'raw_path': ('/api/factory-overview' + path).encode(),
            'query_string': b'', 'root_path': '', 'headers': [(b'authorization', client.headers['Authorization'].encode())],
            'client': ('127.0.0.1', 1000), 'server': ('127.0.0.1', 8000)}
        task = asyncio.create_task(app(scope, receive, send))
        try:
            start = await asyncio.wait_for(output.get(), 2)
            assert start['status'] == 200
            headers = dict(start['headers'])
            assert headers[b'content-type'].startswith(b'text/event-stream')
            assert headers[b'x-accel-buffering'] == b'no'
            assert b'no-store' in headers[b'cache-control']
            body = await asyncio.wait_for(output.get(), 2)
            assert body['body'].startswith(f'event: {event}\n'.encode())
            assert body['more_body']
        finally:
            disconnected.set()
            await asyncio.wait_for(task, 2)
        assert not inventory_events._subscribers
    asyncio.run(run())
    assert client.get('/api/factory-overview' + path, headers={'Authorization': 'Bearer invalid'}).status_code == 401


@pytest.mark.parametrize('view', ['inventory', 'factory-live', 'inventory-changed'])
def test_open_stream_stops_when_the_site_access_cookie_expires(client, monkeypatch, view):
    async def run():
        gate = make_gate()
        monkeypatch.setattr(app.state, 'site_access_gate', gate)
        monkeypatch.setattr(factory_stream, 'HEARTBEAT_SECONDS', .01)
        request = LiveRequest()
        request.cookies = {ACCESS_COOKIE_NAME: gate.issue_cookie()}
        token = client.headers['Authorization'].split(' ', 1)[1]
        stream = factory_stream.inventory_stream(request, HTTPAuthorizationCredentials(scheme='Bearer', credentials=token), view)
        try:
            assert (await anext(stream)).startswith(f'event: {view}')
            monkeypatch.setattr(gate, 'is_unlocked', lambda _: False)
            assert (await anext(stream)).startswith('event: access-required')
            with pytest.raises(StopAsyncIteration):
                await anext(stream)
        finally:
            await stream.aclose()
        assert not inventory_events._subscribers
    asyncio.run(run())


def test_ledger_notifications_do_not_compute_full_reports(client, warehouse, monkeypatch):
    monkeypatch.setattr(factory_stream, 'factory_overview', Mock(side_effect=AssertionError('no full summary')))
    monkeypatch.setattr(factory_stream, 'live_endpoint', Mock(side_effect=AssertionError('no robot summary')))
    async def run():
        token = client.headers['Authorization'].split(' ', 1)[1]
        stream = factory_stream.inventory_stream(LiveRequest(), HTTPAuthorizationCredentials(scheme='Bearer', credentials=token), 'inventory-changed')
        try:
            assert json.loads((await anext(stream)).split('data: ', 1)[1]) == {'changed': True}
            assert (await asyncio.to_thread(intake, client, warehouse)).status_code == 201
            assert (await asyncio.wait_for(anext(stream), 2)).startswith('event: inventory-changed')
            stock = client.get(f"/api/team-materials/{warehouse['team']['id']}/stock").json()
            assert stock['items'][0]['available_quantity'] == 100
        finally:
            await stream.aclose()
        assert not inventory_events._subscribers
    asyncio.run(run())


@pytest.mark.parametrize('view', ['factory-live', 'inventory-changed'])
def test_local_midnight_updates_date_sensitive_views_without_periodic_inventory_reads(client, monkeypatch, view):
    async def run():
        day = ['2026-09-14']
        read = Mock(return_value=factory_stream.message(view, {'changed': True}))
        monkeypatch.setattr(factory_stream, 'read_inventory', read)
        monkeypatch.setattr(factory_stream, 'factory_day', lambda: day[0])
        monkeypatch.setattr(factory_stream, 'HEARTBEAT_SECONDS', .01)
        stream = factory_stream.inventory_stream(LiveRequest(), None, view)
        try:
            assert (await anext(stream)).startswith(f'event: {view}')
            assert (await anext(stream)) == ': heartbeat\n\n'
            assert sum(call.kwargs.get('snapshot', True) for call in read.call_args_list) == 1
            day[0] = '2026-09-15'
            assert (await asyncio.wait_for(anext(stream), 1)).startswith(f'event: {view}')
            assert sum(call.kwargs.get('snapshot', True) for call in read.call_args_list) == 2
        finally:
            await stream.aclose()
    asyncio.run(run())


def test_live_and_ledger_streams_both_receive_external_confirmation(client, outbound):
    async def run():
        token = client.headers['Authorization'].split(' ', 1)[1]
        credentials = HTTPAuthorizationCredentials(scheme='Bearer', credentials=token)
        live = factory_stream.inventory_stream(LiveRequest(), credentials, 'factory-live')
        changes = factory_stream.inventory_stream(LiveRequest(), credentials, 'inventory-changed')
        async def snapshot():
            report, notification = await asyncio.gather(anext(live), anext(changes))
            assert notification.startswith('event: inventory-changed')
            return json.loads(report.split('data: ', 1)[1])
        try:
            assert (await snapshot())['totals']['on_hand_quantity'] == 200
            response = await asyncio.to_thread(dispatch, client, outbound)
            assert response.status_code == 201
            group = response.json()
            assert (await asyncio.wait_for(snapshot(), 2))['totals']['on_hand_quantity'] == 140
            detail = group['items'][0]
            response = await asyncio.to_thread(client.post, f"/api/material-transfers/{detail['batch_no']}/confirm-outbound",
                headers=outbound['headers'], json={'expected_version': detail['version'], 'idempotency_key': 'pushed-confirm'})
            assert response.status_code == 200, response.text
            report = await asyncio.wait_for(snapshot(), 2)
            assert report['totals']['on_hand_quantity'] == 140
            row = next(row for row in report['recent_batches'] if row['batch_no'] == detail['batch_no'])
            assert row['status'] == 'dispatched'
            assert row['target_id'] is None
        finally:
            await live.aclose(); await changes.aclose()
        assert not inventory_events._subscribers
    asyncio.run(run())
