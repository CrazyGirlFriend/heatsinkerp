"""An order uses its selected engineering route without renaming either serial."""

from types import SimpleNamespace
from uuid import uuid4

import pytest
from app.database import SessionLocal
from app.models import (
    MaterialTransfer,
    ProcessRoute,
    ProcessRoutePath,
    ProductionScheduleTask,
    utcnow,
)
from app.process_route_paths import execution_serial
from fastapi import HTTPException
from sqlalchemy import select
from test_dispatch_order_documents import post, setup_order
from test_dispatch_planning import URL, order_file
from test_dispatch_planning import dispatcher as dispatcher  # noqa: F401
from test_outbound_documents import dispatch
from test_process_routes import published, work
from test_warehouse_classification import base, confirm
from test_warehouse_receipts import intake
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401


def selected_order(client, warehouse, dispatcher, *, repeated=False):
    route = published(client, warehouse, repeated)
    # Scope every step after stock preparation to the engineering serial. This
    # exercises path reuse rather than relying only on unrestricted common steps.
    draft = client.post(f"/api/process-routes/{route['id']}/revise").json()
    steps = draft["steps"]
    for step in steps[1:]:
        step["serial_nos"] = draft["serial_nos"]
    saved = client.put(
        f"/api/process-routes/{draft['id']}",
        json={
            **{key: draft[key] for key in ("title", "serial_nos", "version")},
            "steps": steps,
            "review_note": "核对执行路线",
        },
    )
    assert saved.status_code == 200, saved.text
    response = client.post(
        f"/api/process-routes/{draft['id']}/publish",
        json={"version": saved.json()["version"], "confirmed_imports": True},
    )
    assert response.status_code == 200, response.text
    route = response.json()
    person = client.post(URL + "/business-people", json={"name": "业务甲"}).json()["id"]
    serial = "CUSTOMER-ORDER-001"
    response = post(
        client,
        dispatcher,
        dict(
            serial_no=serial,
            route_id=route["id"],
            route_version=route["version"],
            final_due_at="2026-12-30T16:00:00+08:00",
            idempotency_key=uuid4().hex,
            business_person_ids=[person],
        ),
        order_file(serial),
    )
    assert response.status_code == 201, response.text
    return route, response.json()


@pytest.mark.parametrize("anonymous", [False, True])
def test_selected_engineering_route_drives_outbound_and_all_processing_steps(
    client, warehouse, dispatcher, anonymous
):
    route, task = selected_order(client, warehouse, dispatcher, repeated=True)
    serial = task["serial_no"]
    assert route["serial_nos"] == ["WAREHOUSE-001"]
    assert all(node["serial_no"] == serial for node in task["nodes"])
    assert [node["process_step_index"] for node in task["nodes"]] == [0, 2, 3]
    options = client.get(URL + "/route-options").json()
    assert options[0]["id"] == route["id"]
    assert options[0]["execution_serial"] == "WAREHOUSE-001"
    resolved = client.get("/api/process-routes/resolve", params={"serial_no": serial})
    assert resolved.status_code == 200 and resolved.json()["id"] == route["id"]
    linked_order = client.get(
        f"/api/process-routes/{route['id']}/dispatch-order", params={"serial_no": serial}
    )
    assert linked_order.json()["task_id"] == task["id"]
    origin = intake(client, warehouse, serial_no="" if anonymous else serial, weight=10).json()
    sent = dispatch(
        client,
        warehouse,
        [{"source_transfer_id": origin["id"], "serial_no": serial, "quantity": 100, "weight": 10}],
    )
    assert sent.status_code == 201, sent.text
    assert confirm(client, warehouse, sent.json(), workshop=True).status_code == 200
    current = sent.json()["items"][0]
    assert current["process_route"]["step_index"] == 1
    first = work(client, warehouse, current)
    assert first.status_code == 201, first.text
    child = first.json()["outputs"][0]
    choices = client.get(base(warehouse, True) + "/processing-stock").json()
    assert child["id"] in {item["transfer"]["id"] for item in choices["items"]}
    second = work(client, warehouse, child)
    assert second.status_code == 201, second.text
    assert second.json()["process_step_index"] == 2
    ready = second.json()["outputs"][0]
    from test_warehouse_classification import dispatch as send_finished

    finished = send_finished(
        client,
        warehouse,
        [{"source_transfer_id": ready["id"], "quantity": 100, "weight": 10}],
        workshop=True,
    )
    assert finished.status_code == 201, finished.text
    assert finished.json()["items"][0]["process_route"]["step_index"] == 3
    with SessionLocal() as db:
        assert db.get(ProcessRoute, route["id"]).serial_nos == ["WAREHOUSE-001"]
        assert serial not in set(db.scalars(select(ProcessRoutePath.serial_no)))
        raw = db.get(MaterialTransfer, origin["id"])
        assert raw.serial_no == ("" if anonymous else serial)
        if anonymous:
            assert raw.process_route_id is None


def test_foreign_route_needs_explicit_order_association_and_documents_stay_required(
    client, warehouse, dispatcher
):
    # Existing stock can predate the engineering entry policy; linking it still
    # requires an explicit order association with this different engineering serial.
    receipt = intake(client, warehouse, serial_no="INDEPENDENT-ORDER")
    assert receipt.status_code == 201, receipt.text
    origin = receipt.json()
    body = setup_order(client, warehouse)
    body["serial_no"] = "INDEPENDENT-ORDER"
    bound = client.post(
        f"/api/process-routes/{body['route_id']}/bind",
        json={"source_transfer_ids": [origin["id"]]},
    )
    assert bound.status_code == 422 and "排期" in bound.text
    mismatch = post(client, dispatcher, body, order_file("OTHER-ORDER"))
    assert mismatch.status_code == 422 and "订单表与排期流水号不一致" in mismatch.text
    task = post(client, dispatcher, body, order_file(body["serial_no"]))
    assert task.status_code == 201, task.text
    with SessionLocal.begin() as db:
        db.get(ProcessRoute, body["route_id"]).source_file = b""
    result = dispatch(
        client,
        warehouse,
        [{"source_transfer_id": origin["id"], "quantity": 10, "weight": 1}],
    )
    assert result.status_code == 422 and "工艺原件" in result.text
    with SessionLocal.begin() as db:
        db.get(ProductionScheduleTask, task.json()["id"]).cancelled_at = utcnow()
    assert (
        client.get(
            "/api/process-routes/resolve", params={"serial_no": body["serial_no"]}
        ).status_code
        == 404
    )


def test_only_identical_paths_can_be_reused_by_an_external_order():
    route = SimpleNamespace(
        route_kind="normal",
        serial_nos=["A", "B"],
        steps=[{"serial_nos": []}, {"serial_nos": ["A", "B"]}],
    )
    assert execution_serial(route, "ORDER") == "A"
    route.steps.append({"serial_nos": ["B"]})
    assert execution_serial(route, "B") == "B"
    with pytest.raises(HTTPException) as error:
        execution_serial(route, "ORDER")
    assert error.value.status_code == 422


def test_optional_intake_route_accepts_the_orders_selected_engineering_route(
    client, warehouse, dispatcher
):
    route, task = selected_order(client, warehouse, dispatcher)
    response = intake(
        client,
        warehouse,
        serial_no=task["serial_no"],
        process_route={
            key: route[key]
            for key in ("id", "title", "version", "serial_nos", "steps", "review_note")
        },
    )
    assert response.status_code == 201, response.text
    lot = response.json()
    assert lot["serial_no"] == task["serial_no"]
    assert lot["process_route"]["id"] == route["id"]
    assert lot["process_route"]["execution_serial"] == "WAREHOUSE-001"


def test_reused_route_does_not_attribute_other_orders_shared_stock_to_new_order(
    client, warehouse, dispatcher
):
    from route_document_helpers import add_documents
    from test_process_route_intake import route_payload

    draft = route_payload(client, warehouse)
    with SessionLocal.begin() as db:
        row = db.get(ProcessRoute, draft["id"])
        row.serial_nos = ["A", "B"]
        steps = [
            {**step, "planned_quantity": "100", "split_here": index == 1}
            for index, step in enumerate(row.steps)
        ]
        row.steps = [*steps, {**steps[0], "sequence_no": 2, "name": "库房成品入库"}]
    add_documents(draft["id"])
    response = client.post(
        f"/api/process-routes/{draft['id']}/publish", json={"version": draft["version"]}
    )
    assert response.status_code == 200, response.text
    route = response.json()
    receipt = intake(
        client,
        warehouse,
        serial_no="",
        quantity=1,
        weight=10,
    )
    assert receipt.status_code == 201, receipt.text
    person = client.post(URL + "/business-people", json={"name": "业务甲"}).json()["id"]
    tasks = {}
    for serial in ("A", "B", "INDEPENDENT-ORDER"):
        response = post(
            client,
            dispatcher,
            dict(
                serial_no=serial,
                route_id=route["id"],
                route_version=route["version"],
                final_due_at="2026-12-30T16:00:00+08:00",
                idempotency_key=uuid4().hex,
                business_person_ids=[person],
            ),
            order_file(serial),
        )
        assert response.status_code == 201, response.text
        tasks[serial] = response.json()["id"]
    sent = dispatch(
        client,
        warehouse,
        [
            {
                "source_transfer_id": receipt.json()["id"],
                "quantity": 1,
                "weight": 10,
                "shared_serials": [
                    dict(
                        serial_no=serial,
                        planned_quantity=50,
                        planned_weight=5,
                        planned_specification="按图",
                        process_route_id=route["id"],
                        process_route_version=route["version"],
                    )
                    for serial in ("A", "B")
                ],
            }
        ],
    )
    assert sent.status_code == 201, sent.text
    assert sent.json()["items"][0]["shared_unallocated"]
    for serial, shared in [("A", True), ("B", True), ("INDEPENDENT-ORDER", False)]:
        response = client.get(f"{URL}/tasks/{tasks[serial]}")
        assert response.status_code == 200, response.text
        task = response.json()
        assert task["shared_source"] is shared
