"""Own-team purpose settings, authorized opening stock and auditable stock curves."""
from datetime import datetime
from unittest.mock import patch

import pytest
from sqlalchemy import select, func, create_engine, inspect
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

from app.database import SessionLocal
from app.models import MaterialTransfer, MaterialTransferEvent, OpeningStockSubmission, Team, TeamSettingEvent
from test_material_transfers import _setup_three_teams, _create
from test_material_stock import stock_setup, receive_lot, dispatch, loss, totals
from test_warehouse_receipts import migration


def url(s, role='target', suffix='purposes'):
    return f"/api/team-materials/{s[role]['id']}/{suffix}"


def purpose(client, s, name='检验', role='target'):
    result = client.post(url(s, role), headers=s[f'{role}_headers'], json={'name': name})
    assert result.status_code == 201, result.text
    return result.json()


def open_payload(**overrides):
    return {'idempotency_key': 'initial', 'lines': [{'serial_no': '000012', 'material_name': '铜钼',
        'material_type': 'semi_finished', 'quantity': 100, 'weight': '10.125', **overrides}]}


def history(client, s, serial='000012', **params):
    response = client.get(url(s, suffix='serial-history'), params={'serial_no': serial, **params})
    assert response.status_code == 200, response.text
    return response.json()


def initialize(client, s, **overrides):
    assert client.put(url(s, suffix='opening-stock/authorization'), json={'enabled': True}).status_code == 200
    response = client.post(url(s, suffix='opening-stock'), headers=s['target_headers'], json=open_payload(**overrides))
    assert response.status_code == 201, response.text
    return response.json()['items'][0]


def test_purposes_are_team_owned_versioned_unique_and_audited(client):
    s = _setup_three_teams(client)
    for headers in ({}, s['source_headers']):
        assert client.post(url(s), headers=headers, json={'name': '检验'}).status_code == 403
    assert client.post(url(s), headers=s['target_headers'], json={'name': '  '}).status_code == 422
    p = purpose(client, s)
    assert client.post(url(s), headers=s['target_headers'], json={'name': ' 检验 '}).status_code == 409
    assert client.get(url(s), headers=s['source_headers']).json() == [p]
    target = url(s) + f"/{p['id']}"
    assert client.patch(target, headers=s['target_headers'], json={'name': '去毛刺', 'expected_version': 9}).status_code == 409
    updated = client.patch(target, headers=s['target_headers'], json={'name': '去毛刺', 'active': False, 'expected_version': 1})
    assert updated.status_code == 200 and updated.json()['version'] == 2
    with SessionLocal() as db:
        assert db.scalar(select(func.count(TeamSettingEvent.id))) == 2


def test_upstream_chooses_destination_purpose_and_snapshot_survives_rename_disable(client):
    s = _setup_three_teams(client)
    p = purpose(client, s)
    foreign = purpose(client, s, role='third')
    assert _create(client, s).status_code == 422
    assert _create(client, s, purpose_id=foreign['id']).status_code == 422
    created = _create(client, s, purpose_id=p['id'])
    assert created.status_code == 201, created.text
    row = created.json()
    assert row['purpose_name'] == '检验'
    target = url(s) + f"/{p['id']}"
    assert client.patch(target, headers=s['target_headers'], json={'name': '去毛刺', 'active': False, 'expected_version': 1}).status_code == 200
    # Retry is still the original document, despite renamed/disabled vocabulary.
    assert _create(client, s, purpose_id=p['id']).json()['purpose_name'] == '检验'
    assert _create(client, s, idempotency_key='new', purpose_id=p['id']).status_code == 422
    assert _create(client, s, idempotency_key='new').status_code == 422
    batch = '/api/material-transfers/' + row['batch_no']
    assert client.patch(batch, headers=s['source_headers'], json={'purpose_id': p['id'], 'quantity': 8}).status_code == 200
    assert client.get(batch).json()['purpose_name'] == '检验'
    assert client.post(batch+'/confirm', headers=s['target_headers'], json={'idempotency_key': 'confirm'}).status_code == 200
    assert client.patch(batch, headers=s['source_headers'], json={'purpose_id': None}).status_code == 409


def test_each_outbound_batch_has_its_own_purpose_and_bad_line_rolls_back(client, stock_setup):
    s = stock_setup
    lot = receive_lot(client, s)
    a = purpose(client, s, role='third')
    b = purpose(client, s, '去毛刺', role='third')
    lines = [{'source_transfer_id': lot['id'], 'quantity': 10, 'weight': 1, 'purpose_id': a['id']},
             {'source_transfer_id': lot['id'], 'quantity': 20, 'weight': 2, 'purpose_id': 9999}]
    assert dispatch(client, s, lines).status_code == 422
    assert totals(client, s)['on_hand_quantity'] == 100
    lines[1]['purpose_id'] = b['id']
    response = dispatch(client, s, lines)
    assert response.status_code == 201, response.text
    assert [r['purpose_name'] for r in response.json()['items']] == ['检验', '去毛刺']
    assert totals(client, s)['on_hand_quantity'] == 70


@pytest.mark.parametrize('warehouse_destination', [False, True])
def test_business_search_uses_historical_names_and_literal_wildcards(client, stock_setup, warehouse_destination):
    s = stock_setup
    if warehouse_destination:
        with SessionLocal() as db:
            team = db.get(Team, s['third']['id'])
            team.kind = 'warehouse'
            team.code = 'FACTORY-WAREHOUSE'
            db.commit()
    lot = receive_lot(client, s)
    chosen = purpose(client, s, '去毛刺_100%', role='third')
    other = purpose(client, s, '去毛刺X100Y', role='third')
    response = dispatch(client, s, [
        {'source_transfer_id': lot['id'], 'quantity': 10, 'weight': 1, 'purpose_id': item['id']}
        for item in (chosen, other)
    ])
    assert response.status_code == 201, response.text
    row = response.json()['items'][0]
    updated = client.patch(url(s, 'third') + f"/{chosen['id']}", headers=s['third_headers'],
                           json={'name': '精修', 'active': False, 'expected_version': 1})
    assert updated.status_code == 200, updated.text
    # Existing documents remain searchable by their original activity, not the current catalog name.
    filters = {'team_id': s['third']['id'], 'direction': 'incoming', 'status': 'pending'}
    endpoints = [('/api/material-transfers', filters), (url(s, suffix='outbound-batches'), {})]
    for endpoint, params in endpoints:
        found = client.get(endpoint, params={**params, 'query': '去毛刺_100%'}).json()
        assert found['total'] == 1 and found['items'][0]['id'] == row['id']
        assert found['items'][0]['purpose_name'] == '去毛刺_100%'
        assert client.get(endpoint, params={**params, 'query': '精修'}).json()['total'] == 0
    confirmed = client.post('/api/material-transfers/' + row['batch_no'] + '/confirm',
                            headers=s['third_headers'], json={'idempotency_key': 'receive-business'})
    assert confirmed.status_code == 200, confirmed.text
    inventory = client.get(url(s, 'third', 'inventory'), params={'search_field': 'purpose_name', 'query': '去毛刺_100%'}).json()
    assert inventory['total'] == 1 and inventory['items'][0]['purpose_name'] == '去毛刺_100%'
    if warehouse_destination:
        response = client.get(url(s, 'third', 'receipts'), params={'query': '去毛刺_100%'})
        assert response.status_code == 200, response.text
        receipt = response.json()
        assert receipt['total'] == 1 and receipt['items'][0]['id'] == row['id']


def test_opening_requires_admin_authorization_but_only_own_team_can_post(client):
    s = _setup_three_teams(client)
    endpoint = url(s, suffix='opening-stock')
    assert client.post(endpoint, headers=s['target_headers'], json=open_payload()).status_code == 403
    auth = endpoint+'/authorization'
    assert client.put(auth, headers=s['target_headers'], json={'enabled': True}).status_code == 403
    assert client.put(auth, json={'enabled': True}).status_code == 200
    for headers in ({}, s['source_headers']):
        assert client.post(endpoint, headers=headers, json=open_payload()).status_code == 403
    assert client.get(endpoint, headers=s['target_headers']).json()['can_submit']
    assert client.put(auth, json={'enabled': False}).status_code == 200
    assert client.post(endpoint, headers=s['target_headers'], json=open_payload()).status_code == 403


def test_opening_is_an_immutable_independent_origin_and_idempotent(client, stock_setup):
    s = stock_setup
    lot = initialize(client, s)
    assert lot['entry_kind'] == 'opening_stock'
    assert lot['serial_no'] == '000012' and lot['source_team'] is None
    assert lot['source_transfer_id'] is None and lot['dispatch_no'] is None
    assert lot['stock_tracked'] and lot['locked'] and lot['allowed_actions'] == []
    assert [event['action'] for event in lot['history']] == ['stocked']
    endpoint = url(s, suffix='opening-stock')
    state = client.get(endpoint).json()
    assert state['completed'] and not state['enabled'] and not state['can_submit']
    assert client.post(endpoint, headers=s['target_headers'], json=open_payload()).json()['items'] == [lot]
    assert client.post(endpoint, headers=s['target_headers'], json=open_payload(quantity=99)).status_code == 409
    assert client.put(endpoint+'/authorization', json={'enabled': True}).status_code == 409
    batch = '/api/material-transfers/' + lot['batch_no']
    assert client.patch(batch, headers=s['target_headers'], json={'quantity': 200}).status_code == 403
    assert client.delete(batch, headers=s['target_headers']).status_code == 403
    assert totals(client, s)['on_hand_quantity'] == 100
    assert client.get(url(s, suffix='overview')).json()['pending_incoming']['count'] == 0
    assert client.get(url(s, suffix='inventory'), params={'receipt_source': 'opening'}).json()['total'] == 1
    group = history(client, s)['groups'][0]
    assert group['events'][0]['kind'] == 'opening' and group['events'][0]['counterpart'] == '期初库存'
    assert group['on_hand_weight'] == 10.125


def test_opening_atomic_failure_does_not_consume_permission_or_numbers(client, stock_setup):
    s = stock_setup
    endpoint = url(s, suffix='opening-stock')
    assert client.put(endpoint+'/authorization', json={'enabled': True}).status_code == 200
    body = open_payload()
    body['lines'].append({**body['lines'][0], 'purpose_id': 9999})
    assert client.post(endpoint, headers=s['target_headers'], json=body).status_code == 422
    with SessionLocal() as db:
        assert db.scalar(select(func.count(OpeningStockSubmission.id))) == 0
        assert db.scalar(select(func.count(MaterialTransfer.id))) == 0
    assert client.get(endpoint).json()['enabled']
    with patch('app.opening_stock.workflow._record_event', side_effect=RuntimeError('audit failed')):
        assert client.post(endpoint, headers=s['target_headers'], json=open_payload()).status_code == 500
    assert client.get(endpoint).json()['enabled']
    assert client.post(endpoint, headers=s['target_headers'], json=open_payload()).status_code == 201


@pytest.mark.parametrize('invalid', [{'serial_no': ' '}, {'material_name': ' '}, {'material_type': None},
    {'quantity': -1}, {'quantity': 1.5}, {'quantity': 0, 'weight': 0}, {'weight': '1.0001'}, {'status': 'pending'}])
def test_invalid_opening_line_never_posts(client, stock_setup, invalid):
    s = stock_setup
    assert client.post(url(s, suffix='opening-stock'), headers=s['target_headers'], json=open_payload(**invalid)).status_code == 422


def test_existing_stock_cannot_be_initialized_twice_even_if_grant_precedes_receipt(client, stock_setup):
    s = stock_setup
    endpoint = url(s, suffix='opening-stock')
    assert client.put(endpoint+'/authorization', json={'enabled': True}).status_code == 200
    receive_lot(client, s)
    assert client.post(endpoint, headers=s['target_headers'], json=open_payload()).status_code == 409
    assert client.put(endpoint+'/authorization', json={'enabled': True}).status_code == 409
    assert totals(client, s)['on_hand_quantity'] == 100


def test_history_uses_received_purpose_and_reconciles_pending_edits_void_loss(client, stock_setup):
    s = stock_setup
    own = purpose(client, s, '去毛刺')
    next_purpose = purpose(client, s, '发货', role='third')
    lot = initialize(client, s, purpose_id=own['id'])
    outgoing = dispatch(client, s, [{'source_transfer_id': lot['id'], 'quantity': 40, 'weight': 4, 'purpose_id': next_purpose['id']}]).json()['items'][0]
    h = history(client, s)
    assert [g['name'] for g in h['groups']] == ['去毛刺']
    assert h['groups'][0]['on_hand_quantity'] == 60
    assert h['groups'][0]['events'][-1]['balance_quantity'] == 60
    assert h['team_name'] == s['target']['name']
    assert len(h['flows']) == 2
    assert h['flows'][0]['from_name'] == '期初库存'
    assert h['flows'][1]['group_key'] == h['groups'][0]['key']
    assert h['flows'][1]['status'] == 'pending'
    assert h['flows'][1]['to_name'] == s['third']['name']
    assert len(h['lots']) == 1
    assert h['lots'][0]['batch_no'] == lot['batch_no']
    assert h['lots'][0]['closing_quantity'] == h['lots'][0]['on_hand_quantity'] == 60
    batch = '/api/material-transfers/' + outgoing['batch_no']
    assert client.patch(batch, headers=s['target_headers'], json={'quantity': 30, 'weight': 3}).status_code == 200
    assert len(history(client, s)['flows']) == 2  # Edits do not create another route.
    assert history(client, s)['flows'][1]['quantity'] == 30
    assert loss(client, s, lot).status_code == 201
    assert history(client, s)['groups'][0]['events'][-1]['balance_quantity'] == 68
    assert client.delete(batch, headers=s['target_headers']).status_code == 204
    assert [flow['direction'] for flow in history(client, s)['flows']] == ['incoming']
    group = history(client, s)['groups'][0]
    assert [e['kind'] for e in group['events']] == ['opening', 'outgoing', 'adjusted', 'loss', 'voided']
    assert group['outgoing_quantity'] == 0 and group['lost_quantity'] == 2
    assert group['on_hand_quantity'] == group['events'][-1]['balance_quantity'] == totals(client, s)['on_hand_quantity'] == 98
    assert group['on_hand_weight'] == group['events'][-1]['balance_weight'] == totals(client, s)['on_hand_weight'] == 9.925
    assert history(client, s)['lots'][0]['closing_quantity'] == 98
    assert history(client, s)['lots'][0]['closing_weight'] == 9.925


def test_history_confirmation_is_not_a_second_deduction_and_exhausted_serial_is_found(client, stock_setup):
    s = stock_setup
    lot = initialize(client, s, quantity=0, weight='2.125', material_type='scrap_chips')
    # Weight-only opening stock is represented even without a dispatch.
    group = history(client, s)['groups'][0]
    assert group['on_hand_quantity'] == 0 and group['on_hand_weight'] == 2.125
    assert loss(client, s, lot, quantity=0, weight='2.125').status_code == 201
    assert history(client, s)['found'] and history(client, s)['groups'][0]['on_hand_weight'] == 0
    assert not history(client, s, serial='12')['found']


def test_history_confirmed_handoff_date_baseline_and_pending_not_counted(client, stock_setup):
    s = stock_setup
    lot = initialize(client, s)
    out = dispatch(client, s, [{'source_transfer_id': lot['id'], 'quantity': 100, 'weight': '10.125'}]).json()['items'][0]
    assert client.post('/api/material-transfers/'+out['batch_no']+'/confirm', headers=s['third_headers'], json={'idempotency_key': 'confirm'}).status_code == 200
    with SessionLocal() as db:
        db.get(MaterialTransfer, lot['id']).received_at = datetime(2026, 9, 16, 0)
        for event in db.scalars(select(MaterialTransferEvent).where(MaterialTransferEvent.transfer_id == out['id'])):
            event.occurred_at = datetime(2026, 9, 18, 0)
        db.commit()
    group = history(client, s, date_from='2026-09-18', date_to='2026-09-18')['groups'][0]
    assert group['baseline_quantity'] == 100
    assert [e['kind'] for e in group['events']] == ['outgoing']
    assert group['events'][0]['balance_quantity'] == group['on_hand_quantity'] == 0
    assert history(client, s, date_to='2026-09-17')['groups'][0]['on_hand_quantity'] == 0
    snapshot = history(client, s, date_to='2026-09-17')
    assert snapshot['lots'][0]['on_hand_quantity'] == 0  # Today is not the historical endpoint.
    assert snapshot['lots'][0]['closing_quantity'] == 100
    assert snapshot['closing_at'] == '2026-09-17T16:00:00+00:00'
    assert history(client, s, date_from='2026-09-18', date_to='2026-09-18')['lots'][0]['baseline_quantity'] == 100
    with SessionLocal() as db:
        db.get(MaterialTransfer, out['id']).created_at = datetime(2026, 9, 18, 0)
        db.commit()
    routes = history(client, s, date_from='2026-09-18', date_to='2026-09-18')['flows']
    assert len(routes) == 1 and routes[0]['direction'] == 'outgoing'
    assert routes[0]['quantity'] == 100 and routes[0]['weight'] == 10.125
    assert routes[0]['status'] == 'received'
    assert [flow['direction'] for flow in history(client, s, date_to='2026-09-17')['flows']] == ['incoming']
    assert _create(client, s, serial_no='000012').status_code == 201
    result = history(client, s)
    assert result['pending_incoming_count'] == 1 and result['groups'][0]['on_hand_quantity'] == 0
    assert len(result['flows']) == 2  # The new unreceived batch has no stock route.
    assert client.get(url(s, suffix='serial-history'), params={'serial_no':'000012', 'date_from':'2026-09-19','date_to':'2026-09-18'}).status_code == 422


def test_same_second_history_preserves_numeric_audit_order(client, stock_setup):
    s = stock_setup
    lot = initialize(client, s)
    out = dispatch(client, s, [{'source_transfer_id': lot['id'], 'quantity': 40, 'weight': 4}]).json()['items'][0]
    batch = '/api/material-transfers/'+out['batch_no']
    for quantity in range(39, 29, -1):
        assert client.patch(batch, headers=s['target_headers'], json={'quantity': quantity}).status_code == 200
    assert client.delete(batch, headers=s['target_headers']).status_code == 204
    stamp = datetime(2026, 9, 18, 0)
    with SessionLocal() as db:
        db.get(MaterialTransfer, lot['id']).received_at = stamp
        for event in db.scalars(select(MaterialTransferEvent)):
            event.occurred_at = stamp
        db.commit()
    events = history(client, s)['groups'][0]['events']
    assert events[0]['kind'] == 'opening'
    assert [e['balance_quantity'] for e in events] == [100, 60, *range(61, 71), 100]


def test_stock_changes_push_only_after_commit_and_unlinked_legacy_is_flagged(client, stock_setup, monkeypatch):
    from unittest.mock import Mock
    from app.inventory_events import inventory_events
    s = stock_setup
    publish = Mock()
    monkeypatch.setattr(inventory_events, 'publish', publish)
    purpose(client, s)
    publish.assert_called_once()
    publish.reset_mock()
    assert client.put(url(s, suffix='opening-stock/authorization'), json={'enabled': True}).status_code == 200
    publish.assert_called_once()
    publish.reset_mock()
    bad = open_payload(purpose_id=9999)
    assert client.post(url(s, suffix='opening-stock'), headers=s['target_headers'], json=bad).status_code == 422
    publish.assert_not_called()
    assert client.post(url(s, suffix='opening-stock'), headers=s['target_headers'], json=open_payload()).status_code == 201
    # A multi-flush transaction can produce several at-least-once MQ messages;
    # all become visible only after its final commit, then the SSE signal coalesces them.
    assert publish.called
    assert all(call.args[0].inventory for call in publish.call_args_list)
    publish.reset_mock()
    history(client, s)
    publish.assert_not_called()
    assert _create(client, s, serial_no='OLD', next_team_id=s['third']['id']).status_code == 201
    result = client.get(url(s, role='source', suffix='serial-history'), params={'serial_no':'OLD'}).json()
    assert result['found'] and result['untracked_count'] == 1 and result['groups'] == []


def test_opening_migration_preserves_existing_batches_and_is_repeatable(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'opening.sqlite'}")
    old = migration('20260907_0009_external_outbound.py')
    new = migration('20260918_0015_team_purposes_opening_stock.py')
    with engine.begin() as conn:
        conn.exec_driver_sql('CREATE TABLE teams (id INTEGER PRIMARY KEY)')
        conn.exec_driver_sql('INSERT INTO teams VALUES (1), (2)')
        conn.exec_driver_sql(f'''CREATE TABLE material_transfers (id INTEGER PRIMARY KEY, batch_no TEXT, serial_no TEXT,
            entry_kind TEXT, source_team_id INTEGER REFERENCES teams(id), source_team_code TEXT, source_team_name TEXT,
            source_transfer_id INTEGER REFERENCES material_transfers(id), dispatch_id INTEGER, status TEXT, stock_tracked INTEGER,
            next_team_id INTEGER REFERENCES teams(id), next_team_code TEXT, next_team_name TEXT, external_destination TEXT,
            created_at DATETIME, received_at DATETIME,
            CONSTRAINT ck_mt_entry_kind_source CHECK ({old.SOURCE_CHECK}),
            CONSTRAINT ck_mt_entry_destination CHECK ({old.TRANSFER_DESTINATION_CHECK}))''')
        conn.exec_driver_sql("INSERT INTO material_transfers (id,batch_no,serial_no,entry_kind,source_team_id,source_team_code,source_team_name,next_team_id,next_team_code,next_team_name,status,stock_tracked) VALUES (1,'TL-OLD','000001','transfer',1,'A','上序',2,'B','下序','received',1)")
        before = conn.exec_driver_sql('SELECT * FROM material_transfers').one()
        with Operations.context(MigrationContext.configure(conn)):
            new.upgrade(); new.upgrade()
        assert conn.exec_driver_sql('SELECT * FROM material_transfers').one()[:len(before)] == before
        assert conn.exec_driver_sql('SELECT opening_stock_enabled FROM teams').all() == [(0,), (0,)]
        conn.exec_driver_sql("INSERT INTO material_transfers (id,batch_no,serial_no,entry_kind,next_team_id,next_team_code,next_team_name,status,stock_tracked) VALUES (2,'TL-NEW','000002','opening_stock',2,'B','下序','received',1)")
        assert conn.exec_driver_sql('PRAGMA foreign_key_check').all() == []
        assert 'ix_mt_team_serial_purpose' in {i['name'] for i in inspect(conn).get_indexes('material_transfers')}
    engine.dispose()
