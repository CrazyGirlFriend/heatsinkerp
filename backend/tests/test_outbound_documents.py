"""Serial assignment and mandatory documents at outbound, not raw intake."""

from copy import deepcopy

import pytest
from app.database import SessionLocal
from app.models import MaterialTransfer, ProcessRoute, ProcessRouteDrawing, ProcessRouteOrderFile
from route_document_helpers import add_documents
from sender_helpers import sender_post
from sqlalchemy import delete, select
from test_process_route_intake import publish_payload, route_payload
from test_warehouse_receipts import intake
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401


def routes(client, warehouse):
    first = route_payload(client, warehouse)
    first["serial_nos"] = ["ORDER-A"]
    first = publish_payload(client, first)
    with SessionLocal() as db:
        original = db.get(ProcessRoute, first["id"])
        row = ProcessRoute(
            title="第二张订单",
            serial_nos=["ORDER-B"],
            steps=deepcopy(original.steps),
            filename="",
            source_file=b"",
            source_sha256="",
            source_data={"tables": [], "issues": []},
            created_by=original.created_by,
            created_by_user_id=original.created_by_user_id,
        )
        db.add(row)
        db.commit()
        second_id = row.id
    add_documents(second_id)
    response = client.post(f"/api/process-routes/{second_id}/publish", json={"version": 1})
    assert response.status_code == 200, response.text
    return first, response.json()


def dispatch(client, warehouse, lines, key="assign-on-outbound"):
    return sender_post(
        client,
        warehouse["url"].replace("/receipts", "/dispatches"),
        headers=warehouse["headers"],
        json={"next_team_id": warehouse["other"]["id"], "lines": lines, "idempotency_key": key},
    )


def test_unnamed_receipt_splits_into_serial_specific_routes_without_relabelling_remainder(
    client, warehouse
):
    first, second = routes(client, warehouse)
    receipt = intake(client, warehouse, serial_no="").json()
    assert receipt["serial_no"] == "" and receipt["process_route"] is None
    lines = [
        {"source_transfer_id": receipt["id"], "serial_no": "ORDER-A", "quantity": 30, "weight": 3},
        {"source_transfer_id": receipt["id"], "serial_no": "ORDER-B", "quantity": 40, "weight": 4},
    ]
    result = dispatch(client, warehouse, lines)
    assert result.status_code == 201, result.text
    items = result.json()["items"]
    assert [(item["serial_no"], item["process_route"]["id"]) for item in items] == [
        ("ORDER-A", first["id"]),
        ("ORDER-B", second["id"]),
    ]
    assert all(item["process_route"]["step_index"] == 1 for item in items)
    # A retry cannot allocate the same stock twice.
    assert dispatch(client, warehouse, lines).json() == result.json()
    with SessionLocal() as db:
        original = db.get(MaterialTransfer, receipt["id"])
        assert original.serial_no == "" and original.process_route_id is None
    stock = client.get(warehouse["url"].replace("/receipts", "/stock")).json()["items"]
    remainder = next(item for item in stock if item["transfer"]["id"] == receipt["id"])
    assert remainder["available_quantity"] == 30
    assert remainder["transfer"]["serial_no"] == ""
    for item in items:
        detail = client.get(
            "/api/material-transfers/" + item["batch_no"], headers=warehouse["other_headers"]
        ).json()
        route = client.get(
            f"/api/process-routes/{detail['process_route']['id']}",
            headers=warehouse["other_headers"],
        ).json()
        assert (
            route["filename"]
            and route["drawings"]
            and route["source_data"]["order_document"]["serial_no"] == item["serial_no"]
        )


@pytest.mark.parametrize("missing", ["serial", "order", "order_metadata", "word", "drawing"])
def test_missing_outbound_information_rejects_entire_order_without_stock_change(
    client, warehouse, missing
):
    first, _ = routes(client, warehouse)
    receipt = intake(client, warehouse, serial_no="").json()
    with SessionLocal() as db:
        if missing == "order":
            db.execute(
                delete(ProcessRouteOrderFile).where(ProcessRouteOrderFile.route_id == first["id"])
            )
        if missing == "order_metadata":
            row = db.get(ProcessRoute, first["id"])
            row.source_data = {**row.source_data, "order_document": None}
        if missing == "drawing":
            db.execute(
                delete(ProcessRouteDrawing).where(ProcessRouteDrawing.route_id == first["id"])
            )
        if missing == "word":
            db.get(ProcessRoute, first["id"]).source_file = b""
        db.commit()
    lines = [
        {"source_transfer_id": receipt["id"], "serial_no": "ORDER-B", "quantity": 30, "weight": 3},
        {"source_transfer_id": receipt["id"], "quantity": 30, "weight": 3},
    ]
    if missing != "serial":
        lines[1]["serial_no"] = "ORDER-A"
    result = dispatch(client, warehouse, lines)
    assert result.status_code == 422, result.text
    with SessionLocal() as db:
        assert list(db.scalars(select(MaterialTransfer.id))) == [receipt["id"]]
        assert db.get(MaterialTransfer, receipt["id"]).serial_no == ""


def test_serial_lookup_is_exact_and_bound_serial_cannot_be_replaced(client, warehouse):
    first, _ = routes(client, warehouse)
    assert (
        client.get(
            "/api/process-routes/resolve",
            params={"serial_no": "ORDER-A"},
            headers=warehouse["headers"],
        ).json()["id"]
        == first["id"]
    )
    assert (
        client.get(
            "/api/process-routes/resolve",
            params={"serial_no": "ORDER"},
            headers=warehouse["headers"],
        ).status_code
        == 404
    )
    receipt = intake(client, warehouse, serial_no="ORDER-A").json()
    rejected = dispatch(
        client,
        warehouse,
        [
            {
                "source_transfer_id": receipt["id"],
                "serial_no": "ORDER-B",
                "quantity": 10,
                "weight": 1,
            }
        ],
    )
    assert rejected.status_code == 422, rejected.text


def test_selected_version_conflict_does_not_bind_stock(client, warehouse):
    first, _ = routes(client, warehouse)
    receipt = intake(client, warehouse, serial_no="").json()
    result = dispatch(
        client,
        warehouse,
        [
            {
                "source_transfer_id": receipt["id"],
                "serial_no": "ORDER-A",
                "process_route_id": first["id"],
                "process_route_version": 999,
                "quantity": 10,
                "weight": 1,
            }
        ],
    )
    assert result.status_code == 409, result.text
    with SessionLocal() as db:
        assert db.get(MaterialTransfer, receipt["id"]).process_route_id is None
