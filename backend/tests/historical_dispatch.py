"""Explicit historical fixtures: the current API never issues CK identities."""
from app.database import SessionLocal
from app.models import MaterialDispatch, MaterialTransfer


def historical_response(client, response):
    if response.status_code != 201:
        return response
    data = response.json()
    if "dispatch_no" in data:
        return response
    with SessionLocal() as db:
        submission = db.get(MaterialDispatch, db.get(MaterialTransfer, data['items'][0]['id']).dispatch_id)
        submission.dispatch_no = f"CK-LEGACY-{submission.id}"
        code = submission.dispatch_no
        db.commit()
    result = client.get('/api/material-dispatches/' + code, headers={'Authorization': response.request.headers['Authorization']})
    assert result.status_code == 200, result.text
    result.status_code = 201
    return result
