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


def test_warehouse_feeds_two_stock_serials_to_one_processing_commitment(
    client, warehouse, dispatcher
):
    from app.models import MaterialStockBalance, MaterialTransfer, ProductionScheduleDelivery

    body = setup_order(client, warehouse)
    serial = body["serial_no"]
    for key in ("first-job", "second-job"):
        task = post(client, dispatcher, {**body, "idempotency_key": key}, order_file(serial))
        assert task.status_code == 201, task.text
    lots = []
    for name in ("SOURCE-A", "SOURCE-B"):
        receipt = intake(client, warehouse, serial_no=name, idempotency_key=name)
        assert receipt.status_code == 201, receipt.text
        lots.append(receipt.json())
    target_team = warehouse["other"]["id"]
    options = client.get(
        URL + "/warehouse-feeding-options",
        params={
            "team_id": warehouse["team"]["id"],
            "serial_no": serial,
        },
    )
    assert options.status_code == 200, options.text
    assert len(options.json()) == 2
    option = options.json()[1]
    assert option["team_id"] == target_team and option["task_id"] == task.json()["id"]
    target = {key: option[key] for key in ("serial_no", "schedule_id", "route_id", "route_version")}
    lines = [
        {"source_transfer_id": lot["id"], "quantity": i, "weight": i * 2}
        for i, lot in enumerate(lots, 1)
    ]
    for change in ({"serial_no": "SOURCE-A"}, {"route_version": target["route_version"] + 1}):
        failed = dispatch(client, warehouse, lines, feeding_target={**target, **change})
        assert failed.status_code in (409, 422), failed.text
    failed = dispatch(
        client,
        warehouse,
        [lines[0], {**lines[1], "production_schedule_id": target["schedule_id"]}],
        feeding_target=target,
    )
    assert failed.status_code == 422
    response = dispatch(client, warehouse, lines, feeding_target=target)
    assert response.status_code == 201, response.text
    rows = response.json()["items"]
    assert len(rows) == 2
    replay = dispatch(client, warehouse, lines, feeding_target=target)
    assert [r["id"] for r in replay.json()["items"]] == [r["id"] for r in rows]
    for row, lot, line in zip(rows, lots, lines, strict=True):
        assert (row["serial_no"], row["source_serial_no"], row["source_transfer_batch_no"]) == (
            serial,
            lot["serial_no"],
            lot["batch_no"],
        )
        assert (row["quantity"], row["weight"]) == (line["quantity"], line["weight"])
    confirmed = confirm(client, warehouse, response.json(), workshop=True)
    assert confirmed.status_code == 200, confirmed.text
    for row, lot, line in zip(rows, lots, lines, strict=True):
        detail = client.get("/api/material-transfers/" + row["batch_no"]).json()
        assert detail["status"] == "received" and detail["schedule_task_id"] == option["task_id"]
        assert detail["source_serial_no"] == lot["serial_no"]
        context = client.get(base(warehouse, True) + f"/stock/{row['id']}/quantity-adjustments")
        assert context.status_code == 200, context.text
        assert context.json()["production_schedule_id"] == option["schedule_id"]
        assert context.json()["production_schedule_locked"] is True
        with SessionLocal() as db:
            original = db.get(MaterialTransfer, lot["id"])
            assert original.serial_no == lot["serial_no"] and original.process_route_id is None
            balance = db.get(MaterialStockBalance, lot["id"])
            assert balance.on_hand_quantity == lot["quantity"] - line["quantity"]
            assert float(balance.on_hand_weight) == lot["weight"] - line["weight"]
            assert db.get(ProductionScheduleDelivery, row["id"]) is None
    progress = client.get(URL + "/" + str(option["schedule_id"])).json()
    assert progress["remaining_quantity"] == option["remaining_quantity"]
    assert progress["dispatched_quantity"] == 0

    from test_processing_daily import work

    worker = client.get(base(warehouse, True) + "/employees").json()[0]
    wrong = work(
        client,
        warehouse,
        rows[0],
        worker,
        processing_status="complete",
        production_schedule_id=options.json()[0]["schedule_id"],
    )
    assert wrong.status_code == 422
    recorded = work(
        client,
        warehouse,
        rows[0],
        worker,
        processing_mode="split",
        processing_status="complete",
        quantity=3,
        input_quantity=1,
        outputs=[
            {
                "role": "produced",
                "quantity": 3,
                "weight": 2,
                "material_type": "semi_finished",
                "transfer_specification": "10 × 10 × 5 mm",
            }
        ],
    )
    assert recorded.status_code == 201, recorded.text
    assert recorded.json()["production_schedule_id"] == option["schedule_id"]
    produced = recorded.json()["outputs"][0]
    next_move = dispatch(
        client,
        warehouse,
        [{"source_transfer_id": produced["id"], "quantity": 3, "weight": 2}],
        workshop=True,
    )
    assert next_move.status_code == 201, next_move.text
    assert next_move.json()["items"][0]["serial_no"] == serial
    assert client.get(URL + "/" + str(option["schedule_id"])).json()["dispatched_quantity"] == 3
