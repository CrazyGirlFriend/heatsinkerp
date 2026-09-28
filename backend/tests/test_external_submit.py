"""Warehouse exits and inspection shipments complete in the submission transaction."""
from unittest.mock import patch

from sqlalchemy import func, select

from app import material_transfer_workflow as workflow
from app.database import SessionLocal
from app.models import MaterialDispatch, MaterialTransfer
from test_external_outbound import outbound, dispatch


def test_external_submit_completes_each_line_and_retry_does_not_deduct_again(client, outbound):
    result = dispatch(client, outbound)
    assert result.status_code == 201, result.text
    rows = result.json()['items']
    assert len(rows) == 2
    for row in rows:
        assert row['status'] == 'dispatched'
        assert row['locked'] and row['allowed_actions'] == []
        assert row['dispatched_by'] == row['created_by']
        assert row['dispatched_at'] == row['created_at'] == row['locked_at']
        assert row['received_at'] is None and not row['stock_tracked'] and row['next_team'] is None
        detail = client.get('/api/material-transfers/' + row['batch_no']).json()
        assert [event['action'] for event in detail['history']] == ['dispatched']
        assert client.post('/api/material-transfers/' + row['batch_no'] + '/confirm-outbound', headers=outbound['headers'],
                           json={'idempotency_key': 'unnecessary-confirm'}).status_code == 409
        assert client.patch('/api/material-transfers/' + row['batch_no'], headers=outbound['headers'], json={'quantity': 1}).status_code == 409
        assert client.delete('/api/material-transfers/' + row['batch_no'], headers=outbound['headers']).status_code == 409
    before = client.get(outbound['url'] + '/overview').json()['totals']
    assert (before['on_hand_quantity'], before['on_hand_weight']) == (140, 14)
    assert before['reserved_quantity'] == before['reserved_weight'] == 0
    assert before['dispatched_quantity'] == 60 and before['dispatched_weight'] == 6
    assert dispatch(client, outbound).json() == result.json()
    assert client.get(outbound['url'] + '/overview').json()['totals'] == before
    assert client.get(outbound['url'] + '/outbound-batches', params={'status': 'pending', 'entry_kind': outbound['kind']}).json()['total'] == 0
    assert client.get(outbound['url'] + '/outbound-batches', params={'status': 'dispatched', 'entry_kind': outbound['kind']}).json()['total'] == 2
    for path in (outbound['url'] + '/inventory?availability=all', '/api/factory-overview'):
        response = client.get(path)
        assert response.status_code == 200
        data = response.json()
        amounts = data.get('items', [data.get('totals')])
        assert all(item['external_pending_quantity'] == item['external_pending_weight'] == 0 for item in amounts)
    dashboard = client.get('/api/factory-dashboard').json()
    assert dashboard['stock']['total'] == {'quantity': 140, 'weight': 14}
    for row in rows:
        series = next(item for item in dashboard['shipping']['series'] if item['serial_no'] == row['serial_no'])
        assert sum(value or 0 for value in series['values']) == 30


def test_external_submit_and_audit_are_atomic(client, outbound):
    before = client.get(outbound['url'] + '/overview').json()['totals']
    with SessionLocal() as db:
        transfers = db.scalar(select(func.count(MaterialTransfer.id)))
        submissions = db.scalar(select(func.count(MaterialDispatch.id)))
    original = workflow._record_event
    calls = 0

    def fail_second(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError('audit unavailable')
        return original(*args, **kwargs)

    with patch.object(workflow, '_record_event', fail_second):
        assert dispatch(client, outbound).status_code == 500
    with SessionLocal() as db:
        assert db.scalar(select(func.count(MaterialTransfer.id))) == transfers
        assert db.scalar(select(func.count(MaterialDispatch.id))) == submissions
    assert client.get(outbound['url'] + '/overview').json()['totals'] == before
    retry = dispatch(client, outbound)
    assert retry.status_code == 201
    assert all(row['status'] == 'dispatched' for row in retry.json()['items'])


def test_internal_submission_still_requires_downstream_receipt(client, outbound):
    response = dispatch(client, outbound, entry_kind='transfer', external_destination=None,
                        next_team_id=outbound['other']['id'])
    assert response.status_code == 201
    rows = response.json()['items']
    assert all(row['status'] == 'pending' and row['dispatched_at'] is None for row in rows)
    for row in rows:
        received = client.post('/api/material-transfers/' + row['batch_no'] + '/confirm',
                               headers=outbound['other_headers'], json={'idempotency_key': 'receive-' + row['batch_no']})
        assert received.status_code == 200
        assert received.json()['status'] == 'received'
