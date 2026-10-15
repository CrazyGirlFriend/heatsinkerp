"""Fixed destinations apply to creation; legacy free-text documents remain usable."""

import pytest
from app.database import SessionLocal
from app.material_stock import DispatchCreate
from app.models import MaterialDispatch, MaterialTransfer
from app.team_constants import EXTERNAL_DESTINATIONS, EXTERNAL_ENTRY_KINDS
from sender_helpers import sender_post
from sqlalchemy import select
from test_dispatch_batches import external_dispatch
from test_external_outbound import confirm
from test_external_outbound import outbound as outbound


@pytest.mark.parametrize("entry_kind", EXTERNAL_ENTRY_KINDS)
@pytest.mark.parametrize("destination", EXTERNAL_DESTINATIONS)
def test_creation_schema_accepts_each_fixed_destination(entry_kind, destination):
    payload = DispatchCreate(
        sent_employee_id=1,
        entry_kind=entry_kind,
        external_destination=f" {destination} ",
        idempotency_key="destination",
        lines=[{"source_transfer_id": 1, "quantity": 1, "weight": 1}],
    )
    assert payload.external_destination == destination


@pytest.mark.parametrize("endpoint", ["dispatches", "outbound-batches"])
def test_both_creation_routes_reject_free_text_without_stock_changes(client, outbound, endpoint):
    url = outbound["url"] + "/" + endpoint
    body = {
        "entry_kind": outbound["kind"],
        "idempotency_key": "destination-check",
        "lines": [{"source_transfer_id": outbound["lots"][0]["id"], "quantity": 1, "weight": 0.1}],
    }
    before = client.get(outbound["url"] + "/overview").json()["totals"]
    for destination in ("客户 A", "外部", "成品库", "库房成品2", "", None):
        response = sender_post(
            client,
            url,
            headers=outbound["headers"],
            json={**body, "external_destination": destination},
        )
        assert response.status_code == 422, response.text
    assert client.get(outbound["url"] + "/overview").json()["totals"] == before
    for destination in EXTERNAL_DESTINATIONS:
        payload = {**body, "external_destination": destination, "idempotency_key": destination}
        response = sender_post(client, url, headers=outbound["headers"], json=payload)
        assert response.status_code == 201, response.text
        assert response.json()["items"][0]["external_destination"] == destination
        assert response.json()["items"][0]["status"] == "dispatched"
        assert sender_post(client, url, headers=outbound["headers"], json=payload).json() == (
            response.json()
        )


def test_legacy_free_text_survives_detail_list_and_both_confirmation_routes(client, outbound):
    response = external_dispatch(client, outbound)
    assert response.status_code == 201, response.text
    group = response.json()
    destination = "历史客户 A / 自由填写外部仓库"
    with SessionLocal.begin() as db:
        dispatch = db.scalar(
            select(MaterialDispatch).where(MaterialDispatch.dispatch_no == group["dispatch_no"])
        )
        dispatch.external_destination = destination
        for row in db.scalars(
            select(MaterialTransfer).where(MaterialTransfer.dispatch_id == dispatch.id)
        ):
            row.external_destination = destination
    for item in group["items"]:
        detail = client.get("/api/material-transfers/" + item["batch_no"])
        assert detail.status_code == 200, detail.text
        assert detail.json()["external_destination"] == destination
    records = client.get(
        outbound["url"] + "/outbound-batches", params={"entry_kind": outbound["kind"]}
    )
    assert records.status_code == 200, records.text
    assert records.json()["total"] == 2
    assert all(item["external_destination"] == destination for item in records.json()["items"])
    assert confirm(client, outbound, group["items"][0]).status_code == 200
    url = "/api/material-dispatches/" + group["dispatch_no"]
    detail = client.get(url)
    assert detail.status_code == 200, detail.text
    assert detail.json()["external_destination"] == destination
    result = client.post(
        url + "/confirm-outbound",
        headers=outbound["headers"],
        json={
            "idempotency_key": "legacy-destination",
            "expected_revision": detail.json()["revision"],
        },
    )
    assert result.status_code == 200, result.text
    assert all(
        item["external_destination"] == destination and item["status"] == "dispatched"
        for item in result.json()["items"]
    )
