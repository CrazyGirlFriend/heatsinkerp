"""Dispatch owns order sheets; engineering owns originals and drawings."""

import json
from uuid import uuid4

import pytest
from app import order_document_response, production_schedule_api
from app.database import SessionLocal
from app.models import (
    ProcessRoute,
    ProcessRouteOrderFile,
    ProductionScheduleOrderFile,
    ProductionScheduleTask,
)
from fastapi import HTTPException
from sender_helpers import sender_post
from sqlalchemy import func, select
from test_dispatch_planning import URL, order_file  # noqa: F401
from test_dispatch_planning import dispatcher as dispatcher
from test_order_document_preview import pdf
from test_process_route_orders import xlsx
from test_process_routes import published
from test_warehouse_classification import base, confirm, dispatch
from test_warehouse_receipts import intake, legacy_unassigned_receipt  # noqa: F401
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


def test_opening_stock_uses_the_selected_order_batch_and_can_dispatch(
    client, warehouse, dispatcher
):
    body = setup_order(client, warehouse)
    serial = body["serial_no"]
    for key in ("opening-first-order", "opening-second-order"):
        response = post(client, dispatcher, {**body, "idempotency_key": key}, order_file(serial))
        assert response.status_code == 201, response.text
    task = response.json()
    endpoint = base(warehouse, True) + "/opening-stock"
    headers = warehouse["other_headers"]
    assert client.put(endpoint + "/authorization", json={"enabled": True}).status_code == 200
    response = client.get(endpoint + "/options", params={"serial_no": serial}, headers=headers)
    assert response.status_code == 200, response.text
    choices = response.json()
    assert [choice["task_batch_number"] for choice in choices] == [1, 2]
    option = choices[1]
    assert option["task_id"] == task["id"]
    assert [step["index"] for step in option["steps"]] == [1]
    line = {
        "stock_type": "order",
        "serial_no": serial,
        "material_name": "铜钼",
        "material_type": "semi_finished",
        "quantity": 12,
        "weight": 2,
        "production_schedule_id": option["schedule_id"],
        "process_route_id": option["route_id"],
        "process_route_version": option["route_version"],
        "process_step_index": 1,
        "process_step_complete": True,
        "transfer_specification": "100 × 80 × 5 mm",
    }
    invalid = client.post(
        endpoint,
        headers=headers,
        json={"idempotency_key": "opening", "lines": [{**line, "process_step_index": 0}]},
    )
    assert invalid.status_code == 422, invalid.text
    created = client.post(
        endpoint, headers=headers, json={"idempotency_key": "opening", "lines": [line]}
    )
    assert created.status_code == 201, created.text
    lot = created.json()["items"][0]
    assert lot["schedule_task_id"] == task["id"]
    assert lot["task_batch_number"] == 2
    assert lot["process_route"]["step_index"] == 1
    assert lot["process_route"]["next_team_id"] == warehouse["team"]["id"]
    assert lot["process_route"]["complete"] is True

    moved = dispatch(
        client,
        warehouse,
        [{"source_transfer_id": lot["id"], "quantity": 12, "weight": 2}],
        workshop=True,
    )
    assert moved.status_code == 201, moved.text
    transfer = moved.json()["items"][0]
    assert transfer["process_route"]["step_index"] == 2
    detail = client.get("/api/material-transfers/" + transfer["batch_no"]).json()
    assert detail["schedule_task_id"] == task["id"]
    assert detail["task_batch_number"] == 2


@pytest.mark.parametrize(("kind", "name"), [("waste", "铜钼废渣"), ("scrap_chips", "铜钼废屑")])
def test_anonymous_scrap_opening_can_transfer_to_the_warehouse(client, warehouse, kind, name):
    endpoint = base(warehouse, True) + "/opening-stock"
    opening = client.post(
        endpoint,
        json={
            "idempotency_key": "opening-scrap",
            "lines": [
                {
                    "stock_type": "non_order",
                    "material_name": name,
                    "material_type": kind,
                    "quantity": 0,
                    "weight": 8,
                }
            ],
        },
    )
    assert opening.status_code == 201, opening.text
    lot = opening.json()["items"][0]
    assert lot["serial_no"] == ""
    moved = dispatch(
        client,
        warehouse,
        [{"source_transfer_id": lot["id"], "quantity": 0, "weight": 3}],
        workshop=True,
    )
    assert moved.status_code == 201, moved.text
    item = moved.json()["items"][0]
    assert item["serial_no"] == "" and item["weight"] == 3
    assert item["process_route"] is None
    detail = client.get("/api/material-transfers/" + item["batch_no"]).json()
    assert detail["schedule_task_id"] is None
    assert confirm(client, warehouse, moved.json()).status_code == 200


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
        == 200
    )
    assert (
        client.post(
            URL + "/parse-order",
            headers=warehouse["headers"],
            files={"file": ("订单.xlsx", original)},
        ).status_code
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


def test_original_upload_preview_validates_before_rendering_and_requires_dispatch_or_admin(
    client, warehouse, dispatcher, monkeypatch
):
    calls = []

    def render(content, filename):
        calls.append((content, filename))
        return pdf()

    monkeypatch.setattr(order_document_response, "order_document_preview", render)
    content = order_file("PREVIEW-001")
    endpoint = URL + "/order-preview"
    for headers, expected in (
        (warehouse["headers"], 403),
        ({"Authorization": ""}, 401),
    ):
        assert (
            client.post(
                endpoint, headers=headers, files={"file": ("订单.xlsx", content)}
            ).status_code
            == expected
        )
    for original, filename, expected in (
        (b"bad spreadsheet", "订单.xlsx", 422),
        (xlsx(parts={"xl/vbaProject.bin": b"macro"}), "订单.xlsx", 422),
        (content, "订单.xls", 422),
        (b"x" * (production_schedule_api.MAX_FILE_BYTES + 1), "订单.xlsx", 413),
    ):
        response = client.post(endpoint, headers=dispatcher, files={"file": (filename, original)})
        assert response.status_code == expected, response.text
    assert calls == []
    for headers in (dispatcher, None):
        response = client.post(endpoint, headers=headers, files={"file": ("../订单.xlsx", content)})
        assert response.status_code == 200 and response.content == pdf()
        assert response.headers["content-type"] == "application/pdf"
        assert response.headers["content-disposition"].startswith("inline;")
        assert response.headers["cache-control"] == "private, no-store"
    assert calls == [(content, "订单.xlsx"), (content, "订单.xlsx")]
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(ProductionScheduleTask)) == 0


@pytest.mark.parametrize("failure", [503, 504, 422])
def test_saved_order_preview_uses_original_and_preserves_download_on_converter_failure(
    client, warehouse, dispatcher, monkeypatch, failure
):
    body = setup_order(client, warehouse)
    content = order_file(body["serial_no"])
    task = post(client, dispatcher, body, content).json()
    endpoint = f"{URL}/tasks/{task['id']}/order"
    calls = []

    def render(original, filename):
        calls.append((original, filename))
        return pdf()

    monkeypatch.setattr(order_document_response, "order_document_preview", render)
    downloaded = client.get(endpoint, headers=warehouse["headers"])
    assert downloaded.status_code == 200 and downloaded.content == content
    assert downloaded.headers["content-disposition"].startswith("attachment;")
    assert calls == []
    assert client.get(endpoint + "?preview=true", headers={"Authorization": ""}).status_code == 401
    response = client.get(endpoint + "?preview=true", headers=warehouse["headers"])
    assert response.status_code == 200 and response.content == pdf()
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["content-disposition"].startswith("inline;")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["cache-control"] == "private, no-store"
    assert calls == [(content, "订单.xlsx")]

    def unavailable(original, filename):
        raise HTTPException(failure, "订单原件预览暂时不可用")

    monkeypatch.setattr(order_document_response, "order_document_preview", unavailable)
    assert client.get(endpoint + "?preview=true").status_code == failure
    assert client.get(endpoint).content == content
    assert (
        client.post(
            URL + "/order-preview", headers=dispatcher, files={"file": ("订单.xlsx", content)}
        ).status_code
        == failure
    )
    assert client.get(f"{URL}/tasks/999999/order?preview=true").status_code == 404
    with SessionLocal() as db:
        db.delete(db.get(ProductionScheduleOrderFile, task["id"]))
        db.commit()
    assert client.get(endpoint + "?preview=true").status_code == 404


def test_warehouse_outbound_accepts_dispatch_order_without_engineering_order(
    client, warehouse, dispatcher
):
    body = setup_order(client, warehouse)
    receipt = legacy_unassigned_receipt(client, warehouse)
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
