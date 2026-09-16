"""One barcode/full-batch confirmation without losing source-linked history."""
from unittest.mock import patch

import pytest
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine, inspect

from app import material_transfer_workflow as workflow
from app.schemas import MaterialTransferResponse
from test_external_outbound import outbound, dispatch as external_dispatch, confirm as legacy_confirm
from test_material_stock import stock_setup, receive_lot, dispatch as internal_dispatch
from test_warehouse_receipts import migration


def detail_url(group):
    return '/api/material-dispatches/' + group['dispatch_no']


def confirm(client, group, headers, *, external=True, **overrides):
    return client.post(detail_url(group) + ('/confirm-outbound' if external else '/confirm'), headers=headers,
                       json={'idempotency_key': 'batch-confirm-' + group['dispatch_no'],
                             'expected_revision': group['revision'], **overrides})


def test_whole_internal_batch_receipt_and_old_barcode_compatibility(client, stock_setup):
    setup = stock_setup
    lots = [receive_lot(client, setup, key=f'group-{i}') for i in range(2)]
    result = internal_dispatch(client, setup, [{'source_transfer_id': lot['id'], 'quantity': 30, 'weight': 3} for lot in lots])
    assert result.status_code == 201, result.text
    group = result.json()
    assert group['barcode_payload'] == group['dispatch_no'] and group['barcode_type'] == 'CODE128'
    assert group['source_team']['id'] == setup['stock_team_id']
    assert group['line_count'] == group['pending_line_count'] == 2
    assert group['allowed_actions'] == [] and not group['locked']
    for headers in ({}, setup['stock_headers'], setup['source_headers']):
        assert confirm(client, group, headers, external=False).status_code == 403
    assert confirm(client, group, setup['third_headers']).status_code == 403
    reviewed = client.get(detail_url(group), headers=setup['third_headers']).json()
    assert reviewed['allowed_actions'] == ['confirm'] and len(reviewed['revision']) == 64
    assert all(len(row['history']) == 1 for row in reviewed['items'])
    response = confirm(client, reviewed, setup['third_headers'], external=False)
    assert response.status_code == 200, response.text
    done = response.json()
    assert done['status'] == 'received' and done['locked'] and done['pending_line_count'] == 0
    assert done['allowed_actions'] == [] and done['confirmed_at'] and done['confirmed_by']
    assert done['revision'] != reviewed['revision']
    assert confirm(client, reviewed, setup['third_headers'], external=False).json() == done
    assert client.get(detail_url(group), headers=setup['third_headers']).json() == done
    for row, lot in zip(done['items'], lots):
        assert row['stock_tracked'] and row['source_transfer_id'] == lot['id']
        assert row['received_at'] == done['confirmed_at'] and row['locked']
        assert [event['action'] for event in row['history']] == ['created', 'received']
        assert client.get('/api/material-transfers/' + row['batch_no'], headers=setup['third_headers']).json() == MaterialTransferResponse.model_validate(row).model_dump(mode='json')
        assert client.patch('/api/material-transfers/' + row['batch_no'], headers=setup['stock_headers'], json={'quantity': 1}).status_code == 409
    receiver = client.get(f"/api/team-materials/{setup['third']['id']}/overview").json()
    assert receiver['totals']['available_quantity'] == 60 and receiver['totals']['available_weight'] == 6
    assert receiver['pending_incoming']['count'] == 0


def test_external_whole_batch_self_confirmation_and_idempotency(client, outbound):
    group = external_dispatch(client, outbound).json()
    assert group['allowed_actions'] == ['confirm_outbound']
    for headers in ({}, outbound['other_headers']):
        assert confirm(client, group, headers).status_code == 403
    assert confirm(client, group, outbound['headers'], external=False).status_code == 403
    response = confirm(client, group, outbound['headers'])
    assert response.status_code == 200, response.text
    done = response.json()
    assert done['status'] == 'dispatched' and done['total_quantity'] == 60 and done['total_weight'] == 6
    assert done['locked'] and done['next_team'] is None
    assert confirm(client, group, outbound['headers']).json() == done
    assert client.get(detail_url(group), headers=outbound['headers']).json() == done
    assert confirm(client, group, outbound['headers'], idempotency_key='new-key').status_code == 409
    assert confirm(client, done, outbound['headers']).status_code == 409
    for row in done['items']:
        assert row['locked'] and not row['stock_tracked'] and row['received_at'] is None
        assert row['dispatched_at'] == done['confirmed_at']
        assert [event['action'] for event in row['history']] == ['created', 'dispatched']
    totals = client.get(outbound['url'] + '/overview').json()['totals']
    assert totals['available_quantity'] == totals['on_hand_quantity'] == 140
    assert totals['reserved_quantity'] == 0 and totals['dispatched_quantity'] == 60


@pytest.mark.parametrize('mutation', ['edit', 'void', 'legacy_confirm'])
def test_stale_review_rejected_then_remaining_pending_can_confirm(client, outbound, mutation):
    group = external_dispatch(client, outbound).json()
    first = group['items'][0]
    url = '/api/material-transfers/' + first['batch_no']
    if mutation == 'edit':
        response = client.patch(url, headers=outbound['headers'], json={'quantity': 31, 'weight': '3.111', 'expected_version': first['version']})
        assert response.status_code == 200, response.text
    elif mutation == 'void':
        assert client.delete(url, headers=outbound['headers']).status_code == 204
    else:
        assert legacy_confirm(client, outbound, first).status_code == 200
    preserved = client.get(url, headers=outbound['headers']).json()
    assert confirm(client, group, outbound['headers']).status_code == 409
    current = client.get(detail_url(group), headers=outbound['headers']).json()
    assert current['items'][1]['status'] == 'pending' and current['confirmed_at'] is None
    result = confirm(client, current, outbound['headers'])
    assert result.status_code == 200, result.text
    done = result.json()
    assert done['status'] == 'dispatched' and done['pending_line_count'] == 0
    if mutation != 'edit':
        assert MaterialTransferResponse.model_validate(done['items'][0]).model_dump(mode='json') == preserved  # retain historical rows
    assert done['total_quantity'] == {'edit': 61, 'void': 30, 'legacy_confirm': 60}[mutation]


def test_batch_confirmation_is_atomic_and_unique_across_groups(client, outbound):
    group = external_dispatch(client, outbound).json()
    original = workflow._record_event
    count = 0
    def fail_second(*args, **kwargs):
        nonlocal count
        count += 1
        if count == 2:
            raise RuntimeError('second audit failed')
        return original(*args, **kwargs)
    with patch.object(workflow, '_record_event', fail_second):
        with pytest.raises(RuntimeError, match='second audit failed'):
            confirm(client, group, outbound['headers'])
    current = client.get(detail_url(group), headers=outbound['headers']).json()
    assert current['confirmed_at'] is None and current['revision'] == group['revision']
    assert all(row['status'] == 'pending' and len(row['history']) == 1 for row in current['items'])
    assert confirm(client, current, outbound['headers'], idempotency_key='shared-confirm-key').status_code == 200
    second = external_dispatch(client, outbound, idempotency_key='group-two').json()
    assert confirm(client, second, outbound['headers'], idempotency_key='shared-confirm-key').status_code == 409
    current = client.get(detail_url(second), headers=outbound['headers']).json()
    assert current['confirmed_at'] is None and all(row['status'] == 'pending' for row in current['items'])
    assert confirm(client, current, outbound['headers']).status_code == 200


def test_missing_batch_and_required_review_token(client, outbound):
    assert client.get('/api/material-dispatches/CKMISSING').status_code == 404
    group = external_dispatch(client, outbound).json()
    assert client.post(detail_url(group) + '/confirm-outbound', headers=outbound['headers'], json={'idempotency_key': 'no-review'}).status_code == 422
    assert confirm(client, group, outbound['headers'], expected_revision='bad').status_code == 422
    assert confirm(client, group, outbound['headers'], idempotency_key='  ').status_code == 422
    for row in group['items']:
        assert client.delete('/api/material-transfers/' + row['batch_no'], headers=outbound['headers']).status_code == 204
    current = client.get(detail_url(group), headers=outbound['headers']).json()
    assert current['locked'] and current['total_quantity'] == 0 and current['allowed_actions'] == []
    assert confirm(client, current, outbound['headers']).status_code == 409


@pytest.mark.parametrize('partial', [False, True])
def test_batch_migration_preserves_legacy_header_links_and_repeats(tmp_path, partial):
    engine = create_engine(f"sqlite:///{tmp_path / 'batch.sqlite'}")
    with engine.begin() as conn:
        conn.exec_driver_sql('CREATE TABLE teams (id INTEGER PRIMARY KEY)')
        conn.exec_driver_sql('CREATE TABLE users (id INTEGER PRIMARY KEY)')
        conn.exec_driver_sql('INSERT INTO teams VALUES (1),(2)')
        with Operations.context(MigrationContext.configure(conn)):
            for filename in ('20260906_0004_material_transfers.py', '20260906_0005_transfer_document.py',
                             '20260906_0006_transfer_query_indexes.py', '20260906_0007_team_material_stock.py',
                             '20260906_0008_warehouse_receipts.py', '20260907_0009_external_outbound.py'):
                migration(filename).upgrade()
        conn.exec_driver_sql("""INSERT INTO material_dispatches
            (id,dispatch_no,source_team_id,next_team_id,next_team_code,next_team_name,idempotency_key,request_hash,created_by,created_at)
            VALUES (1,'CK-PRESERVED',1,2,'B','下序','old-key','old-hash','班组长','2026-09-01')""")
        conn.exec_driver_sql("""INSERT INTO material_transfers
            (id,batch_no,serial_no,source_team_id,source_team_code,source_team_name,next_team_id,next_team_code,next_team_name,
             quantity,weight,status,created_by,created_at,updated_at,dispatch_id)
            VALUES (1,'TL-PRESERVED','SERIAL',1,'A','上序',2,'B','下序',10,1,'received','班组长','2026-09-01','2026-09-01',1)""")
        before = dict(conn.exec_driver_sql('SELECT * FROM material_dispatches').mappings().one())
        line = dict(conn.exec_driver_sql('SELECT * FROM material_transfers').mappings().one())
        if partial:
            conn.exec_driver_sql('ALTER TABLE material_dispatches ADD COLUMN confirmed_by VARCHAR(80)')
        with Operations.context(MigrationContext.configure(conn)):
            upgrade = migration('20260907_0010_dispatch_confirmation.py')
            upgrade.upgrade()
            upgrade.upgrade()
        after = dict(conn.exec_driver_sql('SELECT * FROM material_dispatches').mappings().one())
        assert {key: after[key] for key in before} == before
        assert after['confirmed_at'] is None and after['confirmation_idempotency_key'] is None
        assert dict(conn.exec_driver_sql('SELECT * FROM material_transfers').mappings().one()) == line
        assert conn.exec_driver_sql('PRAGMA foreign_key_check').fetchall() == []
        assert any(f['constrained_columns'] == ['confirmed_by_user_id'] for f in inspect(conn).get_foreign_keys('material_dispatches'))
        assert any(u['column_names'] == ['confirmation_idempotency_key'] for u in inspect(conn).get_unique_constraints('material_dispatches'))
    engine.dispose()
