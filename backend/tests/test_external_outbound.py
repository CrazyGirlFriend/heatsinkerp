"""Own-team outbound confirmation, stock conservation, and upgrade safety."""
from unittest.mock import patch
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine, inspect
from sqlalchemy.exc import IntegrityError

from test_material_transfers import _leader, _team
from test_warehouse_receipts import migration


@pytest.mark.parametrize('code,kind,entry_kind,allowed', [
    ('FACTORY-WAREHOUSE', 'warehouse', 'warehouse_outbound', True),
    ('FACTORY-QC', 'production', 'inspection_shipment', True),
    ('FACTORY-WAREHOUSE', 'production', 'warehouse_outbound', False),
    ('FACTORY-QC', 'warehouse', 'inspection_shipment', False),
    ('FACTORY-QC', 'scrap', 'inspection_shipment', False),
    ('OTHER-WAREHOUSE', 'warehouse', 'warehouse_outbound', False),
    ('FACTORY-QC', 'production', 'warehouse_outbound', False),
    ('FACTORY-WAREHOUSE', 'warehouse', 'inspection_shipment', False),
])
def test_outbound_requires_formal_team_code_and_classification(code, kind, entry_kind, allowed):
    from app.material_stock import require_outbound_actor
    team = SimpleNamespace(id=1, code=code, kind=kind, active=True)
    user = SimpleNamespace(role='TEAM', team_id=1, team=team)
    if allowed:
        assert require_outbound_actor(user, 1, entry_kind) is team
    else:
        with pytest.raises(HTTPException) as exc:
            require_outbound_actor(user, 1, entry_kind)
        assert exc.value.status_code == 403


@pytest.fixture(params=['warehouse_outbound', 'inspection_shipment'])
def outbound(client, request):
    warehouse = client.post('/api/teams', json={'code': 'FACTORY-WAREHOUSE', 'name': '库房', 'kind': 'warehouse'}).json()
    qc = _team(client, 'FACTORY-QC', '检验')
    other = _team(client, 'FACTORY-ROLL', '轧制')
    headers = {t['id']: _leader(client, 'leader-'+str(t['id']), t['id'])[1] for t in (warehouse, qc, other)}
    team = warehouse if request.param == 'warehouse_outbound' else qc
    lots = []
    for i in range(2):
        response = client.post(f"/api/team-materials/{warehouse['id']}/receipts", headers=headers[warehouse['id']], json={
            'serial_no': f'EXTERNAL-{i}', 'material_name': '铜钼', 'material_type': 'finished',
            'quantity': 100, 'weight': '10.000', 'notes': '手工入库', 'idempotency_key': f'intake-{i}'})
        assert response.status_code == 201, response.text
        lot = response.json()
        if team == qc:
            response = client.post(f"/api/team-materials/{warehouse['id']}/dispatches", headers=headers[warehouse['id']], json={
                'next_team_id': qc['id'], 'idempotency_key': f'to-qc-{i}',
                'lines': [{'source_transfer_id': lot['id'], 'quantity': 100, 'weight': 10}]})
            assert response.status_code == 201, response.text
            lot = response.json()['items'][0]
            response = client.post(f"/api/material-transfers/{lot['batch_no']}/confirm", headers=headers[qc['id']],
                                   json={'idempotency_key': f'qc-receive-{i}'})
            assert response.status_code == 200, response.text
            lot = response.json()
        lots.append(lot)
    return {'kind': request.param, 'team': team, 'headers': headers[team['id']], 'lots': lots,
            'other': other, 'other_headers': headers[other['id']], 'all_headers': headers,
            'url': f"/api/team-materials/{team['id']}"}


def dispatch(client, setup, **overrides):
    return client.post(setup['url']+'/dispatches', headers=setup['headers'], json={
        'entry_kind': setup['kind'], 'external_destination': ' 客户 A / 外部仓库 ', 'notes': '清点发运',
        'idempotency_key': 'outbound-1', 'lines': [{'source_transfer_id': lot['id'], 'quantity': 30, 'weight': 3} for lot in setup['lots']],
        **overrides})


def confirm(client, setup, line, **overrides):
    return client.post(f"/api/material-transfers/{line['batch_no']}/confirm-outbound", headers=setup['headers'],
                       json={'idempotency_key': 'confirm-'+line['batch_no'], 'expected_version': line['version'], **overrides})


def test_external_outbound_submission_self_confirmation_and_no_phantom_receipt(client, outbound):
    response = dispatch(client, outbound)
    assert response.status_code == 201, response.text
    group = response.json()
    assert dispatch(client, outbound).json() == group
    assert all(item['entry_kind'] == outbound['kind'] and item['next_team'] is None for item in group['items'])
    assert all(item['external_destination'] == '客户 A / 外部仓库' for item in group['items'])
    first, second = group['items']
    assert first['allowed_actions'] == ['edit', 'void', 'confirm_outbound']
    assert first['next_team_id'] is None and first['next_team'] is None
    assert not first['stock_tracked'] and first['status'] == 'pending'
    before = client.get(outbound['url']+'/overview').json()
    assert before['totals']['available_quantity'] == 140 and before['totals']['reserved_quantity'] == 60
    assert before['totals']['on_hand_quantity'] == 140 and before['pending_incoming']['count'] == 0
    assert before['totals']['on_hand_weight'] == before['totals']['available_weight'] == 14
    result = confirm(client, outbound, first)
    assert result.status_code == 200, result.text
    done = result.json()
    assert done['status'] == 'dispatched' and done['locked'] and not done['stock_tracked']
    assert done['received_at'] is None and done['received_by'] is None
    assert done['dispatched_at'] == done['locked_at'] and done['dispatched_by']
    assert done['allowed_actions'] == [] and done['version'] == first['version'] + 1
    assert [event['action'] for event in done['history']] == ['created', 'dispatched']
    assert confirm(client, outbound, first).json() == done
    assert client.get(outbound['url']+'/overview').json()['totals']['on_hand_quantity'] == 140
    assert client.get(f"/api/material-transfers/{first['batch_no']}", headers=outbound['headers']).json() == done
    assert confirm(client, outbound, first, idempotency_key='different-key').status_code == 409
    assert client.get(outbound['url']+'/outbound-batches', params={'status': 'pending'}).json()['total'] == 1
    assert confirm(client, outbound, second).status_code == 200
    rows = client.get(outbound['url']+'/outbound-batches', params={'status': 'dispatched', 'entry_kind': outbound['kind'], 'query': '客户 A'}).json()
    assert rows['total'] == 2 and all(row['status'] == 'dispatched' for row in rows['items'])
    assert client.get(outbound['url']+'/dispatches', params={'entry_kind': 'transfer'}).json()['total'] == 0
    after = client.get(outbound['url']+'/overview').json()
    assert after['totals']['available_quantity'] == after['totals']['on_hand_quantity'] == 140
    assert after['totals']['available_weight'] == after['totals']['on_hand_weight'] == 14
    assert after['totals']['dispatched_quantity'] == 60 and after['totals']['reserved_quantity'] == 0
    assert client.get(outbound['url']+'/stock', params={'availability': 'all'}).json()['total'] == 2
    incoming = client.get('/api/material-transfers', params={'team_id': outbound['team']['id'], 'direction': 'incoming', 'status': 'dispatched'}).json()
    assert incoming['total'] == 0
    outgoing = client.get('/api/material-transfers', params={'team_id': outbound['team']['id'], 'direction': 'outgoing', 'status': 'dispatched'}).json()
    assert outgoing['total'] == 2
    detail = f"/api/material-transfers/{first['batch_no']}"
    assert client.patch(detail, headers=outbound['headers'], json={'quantity': 1}).status_code == 409
    assert client.delete(detail, headers=outbound['headers']).status_code == 409
    assert dispatch(client, outbound, idempotency_key='too-much', lines=[{'source_transfer_id': outbound['lots'][0]['id'], 'quantity': 71, 'weight': 0}]).status_code == 409


def test_external_authorization_no_internal_self_receipt_loophole(client, outbound):
    line = dispatch(client, outbound).json()['items'][0]
    url = f"/api/material-transfers/{line['batch_no']}"
    for headers in ({}, outbound['other_headers']):
        assert client.post(url+'/confirm-outbound', headers=headers, json={'idempotency_key': 'denied'}).status_code == 403
    assert client.post(url+'/confirm', headers=outbound['headers'], json={'idempotency_key': 'not-a-receipt'}).status_code == 403
    other_kind = 'inspection_shipment' if outbound['kind'] == 'warehouse_outbound' else 'warehouse_outbound'
    assert dispatch(client, outbound, entry_kind=other_kind, idempotency_key='wrong-kind').status_code == 403
    assert client.post(f"/api/team-materials/{outbound['other']['id']}/dispatches", headers=outbound['other_headers'], json={
        'entry_kind': outbound['kind'], 'external_destination': '外部', 'idempotency_key': 'wrong-team',
        'lines': [{'source_transfer_id': outbound['lots'][0]['id'], 'quantity': 1, 'weight': 1}]}).status_code == 403
    assert dispatch(client, outbound, entry_kind='transfer', next_team_id=outbound['team']['id'], external_destination=None).status_code == 409  # existing key mismatch
    assert dispatch(client, outbound, entry_kind='transfer', next_team_id=outbound['team']['id'], external_destination=None, idempotency_key='self-internal').status_code == 422
    # Ordinary internal dispatch still must be accepted by the next team.
    response = dispatch(client, outbound, entry_kind='transfer', next_team_id=outbound['other']['id'], external_destination=None, idempotency_key='internal')
    assert response.status_code == 201, response.text
    internal = response.json()['items'][0]
    assert confirm(client, outbound, internal).status_code == 403
    assert client.post(f"/api/material-transfers/{internal['batch_no']}/confirm", headers=outbound['other_headers'], json={'idempotency_key': 'internal-receive'}).status_code == 200


def test_pending_edit_version_void_and_key_collision_are_safe(client, outbound):
    first, second = dispatch(client, outbound).json()['items']
    url = f"/api/material-transfers/{first['batch_no']}"
    edit = client.patch(url, headers=outbound['headers'], json={'quantity': 31, 'weight': '3.100', 'material_type': 'finished', 'expected_version': first['version']})
    assert edit.status_code == 200, edit.text
    assert confirm(client, outbound, first).status_code == 409
    assert client.patch(url, headers=outbound['headers'], json={'next_team_id': outbound['other']['id']}).status_code == 422
    assert client.patch(url, headers=outbound['headers'], json={'external_destination': '篡改去向'}).status_code == 422
    assert confirm(client, outbound, edit.json(), idempotency_key='shared-key').status_code == 200
    assert confirm(client, outbound, second, idempotency_key='shared-key').status_code == 409
    assert client.get(f"/api/material-transfers/{second['batch_no']}").json()['status'] == 'pending'
    assert client.delete(f"/api/material-transfers/{second['batch_no']}", headers=outbound['headers']).status_code == 204
    assert confirm(client, outbound, second).status_code == 409
    totals = client.get(outbound['url']+'/overview').json()['totals']
    assert totals['available_quantity'] == 169 and totals['available_weight'] == 16.9
    assert totals['reserved_quantity'] == 0
    assert client.get(outbound['url']+'/dispatches', params={'status': 'dispatched'}).json()['total'] == 1


def test_external_validation_and_atomicity(client, outbound):
    for bad in ({'next_team_id': outbound['other']['id']}, {'external_destination': '  '}, {'external_destination': None},
                {'external_destination': 'x'*241}, {'entry_kind': 'unknown'}, {'idempotency_key': '  '}):
        assert dispatch(client, outbound, **bad).status_code == 422
    too_much = [{'source_transfer_id': lot['id'], 'quantity': 30 if i == 0 else 101, 'weight': 1} for i, lot in enumerate(outbound['lots'])]
    assert dispatch(client, outbound, lines=too_much).status_code == 409
    assert client.get(outbound['url']+'/dispatches').json()['total'] == 0
    with patch('app.material_stock.workflow._record_event', side_effect=RuntimeError('audit failed')):
        with pytest.raises(RuntimeError, match='audit failed'):
            dispatch(client, outbound)
    assert client.get(outbound['url']+'/dispatches').json()['total'] == 0
    line = dispatch(client, outbound).json()['items'][0]
    with patch('app.material_transfer_workflow._record_event', side_effect=RuntimeError('audit failed')):
        with pytest.raises(RuntimeError, match='audit failed'):
            confirm(client, outbound, line)
    assert client.get(f"/api/material-transfers/{line['batch_no']}").json()['status'] == 'pending'
    assert confirm(client, outbound, line).status_code == 200


@pytest.mark.parametrize('partial', [False, True])
def test_external_upgrade_preserves_internal_intake_and_history(tmp_path, partial):
    engine = create_engine(f"sqlite:///{tmp_path / 'external.sqlite'}")
    with engine.begin() as conn:
        conn.exec_driver_sql('CREATE TABLE teams (id INTEGER PRIMARY KEY)')
        conn.exec_driver_sql('CREATE TABLE users (id INTEGER PRIMARY KEY)')
        conn.exec_driver_sql('INSERT INTO teams VALUES (1),(2)')
        with Operations.context(MigrationContext.configure(conn)):
            for filename in ('20260906_0004_material_transfers.py', '20260906_0005_transfer_document.py',
                             '20260906_0006_transfer_query_indexes.py', '20260906_0007_team_material_stock.py', '20260906_0008_warehouse_receipts.py'):
                migration(filename).upgrade()
        conn.exec_driver_sql("""INSERT INTO material_transfers
            (id,batch_no,serial_no,source_team_id,source_team_code,source_team_name,next_team_id,next_team_code,next_team_name,
             quantity,weight,status,created_by,created_at,updated_at,stock_tracked,entry_kind)
            VALUES (1,'OLD-INTERNAL','SERIAL',1,'A','上序',2,'B','下序',10,1,'received','班组长','2026-09-01','2026-09-01',1,'transfer'),
                   (2,'OLD-INTAKE','INTAKE',NULL,NULL,NULL,1,'A','库房',20,2,'received','库房长','2026-09-01','2026-09-01',1,'warehouse_receipt')""")
        conn.exec_driver_sql("INSERT INTO material_transfer_events (transfer_id,action,actor,occurred_at,changes) VALUES (2,'stocked','库房长','2026-09-01','{}')")
        before = conn.exec_driver_sql('SELECT * FROM material_transfers ORDER BY id').mappings().all()
        if partial:
            conn.exec_driver_sql('ALTER TABLE material_transfers ADD COLUMN external_destination VARCHAR(240)')
            conn.exec_driver_sql("ALTER TABLE material_dispatches ADD COLUMN entry_kind VARCHAR(24) NOT NULL DEFAULT 'transfer'")
        upgrade = migration('20260907_0009_external_outbound.py')
        with Operations.context(MigrationContext.configure(conn)):
            upgrade.upgrade()
            upgrade.upgrade()
        after = conn.exec_driver_sql('SELECT * FROM material_transfers ORDER BY id').mappings().all()
        assert [{key: row[key] for key in old} for old, row in zip(before, after)] == [dict(row) for row in before]
        assert conn.exec_driver_sql('SELECT COUNT(*) FROM material_transfer_events').scalar_one() == 1
        assert conn.exec_driver_sql('PRAGMA foreign_key_check').fetchall() == []
        for invalid in ("UPDATE material_transfers SET next_team_id=NULL WHERE id=1",
                        "UPDATE material_transfers SET status='dispatched' WHERE id=1",
                        "UPDATE material_transfers SET entry_kind='warehouse_outbound',next_team_id=NULL,next_team_code=NULL,next_team_name=NULL WHERE id=1"):
            with pytest.raises(IntegrityError):
                with conn.begin_nested():
                    conn.exec_driver_sql(invalid)
        assert {'ix_mt_source_kind_created', 'ix_mt_intake_created', 'ix_mt_stock_source_status'} <= {i['name'] for i in inspect(conn).get_indexes('material_transfers')}
    engine.dispose()
