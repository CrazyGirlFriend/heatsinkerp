"""Dispatch owns order sheets; engineering owns originals and drawings."""

import json
from uuid import uuid4

from app.database import SessionLocal
from app.models import (
    ProcessRoute,
    ProcessRouteOrderFile,
    ProductionScheduleOrderFile,
    ProductionScheduleTask,
)
from sender_helpers import sender_post
from sqlalchemy import func, select
from test_dispatch_planning import URL, order_file  # noqa: F401
from test_dispatch_planning import dispatcher as dispatcher
from test_process_routes import published
from test_warehouse_receipts import intake  # noqa: F401
from test_warehouse_receipts import warehouse as warehouse


def setup_order(client, warehouse):
    route = published(client, warehouse)
    with SessionLocal() as db:
        db.delete(db.get(ProcessRouteOrderFile, route["id"]))
        row = db.get(ProcessRoute, route["id"])
        row.source_data = {
            key: value for key, value in row.source_data.items() if key != "order_document"
        }
        db.commit()
    person = client.post(URL + "/business-people", json={"name": "业务甲"}).json()["id"]
    return dict(
        serial_no="WAREHOUSE-001",
        route_id=route["id"],
        route_version=route["version"],
        final_due_at="2026-12-30T16:00:00+08:00",
        idempotency_key=uuid4().hex,
        business_person_ids=[person],
        delivery_batches=[
            dict(batch_number=1, target_quantity=100, due_at="2026-12-29T16:00:00+08:00")
        ],
    )


def post(client, dispatcher, body, content=None, filename="订单.xlsx"):
    return client.post(
        URL + "/tasks",
        headers=dispatcher,
        data={"payload": json.dumps(body)},
        files={"file": (filename, content)} if content is not None else None,
    )


def test_order_upload_is_required_validated_atomic_and_idempotent(client, warehouse, dispatcher):
    body = setup_order(client, warehouse)
    original = order_file(body["serial_no"])
    assert post(client, dispatcher, body).status_code == 422
    mismatch = post(client, dispatcher, body, order_file("OTHER"))
    assert mismatch.status_code == 422 and "流水号不一致" in mismatch.text
    assert post(client, dispatcher, body, b"bad spreadsheet").status_code == 422
    invalid = post(client, dispatcher, {**body, "route_version": 999}, original)
    assert invalid.status_code == 409
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(ProductionScheduleTask)) == 0
        assert db.scalar(select(func.count()).select_from(ProductionScheduleOrderFile)) == 0
    assert (
        client.post(URL + "/parse-order", files={"file": ("订单.xlsx", original)}).status_code
        == 403
    )
    preview = client.post(
        URL + "/parse-order", headers=dispatcher, files={"file": ("订单.xlsx", original)}
    )
    assert preview.status_code == 200, preview.text
    result = post(client, dispatcher, body, original)
    assert result.status_code == 201, result.text
    task = result.json()
    assert task["order_document"] == preview.json()
    assert post(client, dispatcher, body, original).json()["id"] == task["id"]
    assert post(client, dispatcher, body, original, filename="另一份订单.xlsx").status_code == 409
    endpoint = f"{URL}/tasks/{task['id']}"
    assert client.get(endpoint).json()["order_document"] == preview.json()
    downloaded = client.get(endpoint + "/order", headers=warehouse["headers"])
    assert downloaded.status_code == 200 and downloaded.content == original
    route = client.get(f"/api/process-routes/{body['route_id']}").json()
    assert "order_document" not in route["source_data"]
    related = client.get(
        f"/api/process-routes/{body['route_id']}/dispatch-order",
        params={"serial_no": body["serial_no"]},
        headers=warehouse["headers"],
    )
    assert related.json() == {"task_id": task["id"], "document": preview.json()}
    assert (
        client.get(
            f"/api/process-routes/{body['route_id']}/dispatch-order", params={"serial_no": "OTHER"}
        ).json()
        is None
    )


def test_warehouse_outbound_accepts_dispatch_order_without_engineering_order(
    client, warehouse, dispatcher
):
    body = setup_order(client, warehouse)
    receipt = intake(client, warehouse, serial_no="").json()
    payload = {
        "next_team_id": warehouse["other"]["id"],
        "idempotency_key": uuid4().hex,
        "lines": [
            {
                "source_transfer_id": receipt["id"],
                "serial_no": body["serial_no"],
                "quantity": 10,
                "weight": 1,
            }
        ],
    }
    url = warehouse["url"].replace("/receipts", "/dispatches")
    rejected = sender_post(client, url, headers=warehouse["headers"], json=payload)
    assert rejected.status_code == 422 and "订单表" in rejected.text
    task = post(client, dispatcher, body, order_file(body["serial_no"]))
    assert task.status_code == 201, task.text
    sent = sender_post(client, url, headers=warehouse["headers"], json=payload)
    assert sent.status_code == 201, sent.text
    assert sent.json()["items"][0]["process_route"]["id"] == body["route_id"]
