"""Explicit pre-upgrade external drafts for compatibility tests only."""
import httpx

from app.database import SessionLocal
from app.models import MaterialTransfer
from app.team_constants import EXTERNAL_ENTRY_KINDS


def pending_external_response(client, response):
    if response.status_code != 201:
        return response
    data = response.json()
    with SessionLocal() as db:
        for item in data['items']:
            row = db.get(MaterialTransfer, item['id'])
            if row.entry_kind not in EXTERNAL_ENTRY_KINDS or row.status != 'dispatched':
                continue
            if len(row.history) != 1 or row.history[0].action != 'dispatched':
                continue  # A replay of a previously confirmed legacy fixture stays confirmed.
            row.status = 'pending'
            row.dispatched_at = row.dispatched_by = row.dispatched_by_user_id = None
            event = row.history[0]
            event.action = 'created'
            event.changes = {**event.changes, 'status': {'before': None, 'after': 'pending'},
                             **{key: {'before': None, 'after': None} for key in ('dispatched_at', 'dispatched_by', 'dispatched_by_user_id')}}
        db.commit()
    for index, item in enumerate(data['items']):
        current = client.get('/api/material-transfers/' + item['batch_no'],
                             headers={'Authorization': response.request.headers['Authorization']})
        assert current.status_code == 200
        data['items'][index] = current.json()
        data['items'][index]['history'] = item['history']
    return httpx.Response(201, json=data, request=response.request)
