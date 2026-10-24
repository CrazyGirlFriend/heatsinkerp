"""Task routes remain atomic, paginated, and distinct from physical execution."""

from uuid import uuid4

import pytest
from app.database import SessionLocal
from app.models import MaterialInspection, MaterialTransfer, ProductionScheduleTask
from sqlalchemy import func, select
from test_inspections import create_check
from test_inspections import inspection as inspection  # noqa: F401
from test_production_schedules import URL, body, get, plan
from test_quantity_adjustments import change, processing_lot
from test_warehouse_classification import confirm, dispatch
from test_warehouse_receipts import intake
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

TASKS = URL + "/tasks"


def route(s, lot=None, **extra):
    first = body(s, lot)
    second = body(s, workshop=True, target_quantity=20)
    exclude = {"idempotency_key", "serial_no", "sequence_no", "predecessor_id"}
    return {
        "idempotency_key": uuid4().hex,
        "title": "首批交货任务",
        "serial_no": first["serial_no"],
        "nodes": [
            {key: value for key, value in node.items() if key not in exclude}
            for node in (first, second)
        ],
        **extra,
    }


def create(client, payload):
    response = client.post(TASKS, json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def task_detail(client, task):
    response = client.get(f"{TASKS}/{task['id']}")
    assert response.status_code == 200, response.text
    return response.json()


def test_task_creation_is_atomic_idempotent_and_does_not_merge_same_serial(client, warehouse):
    s = warehouse
    payload = route(s)
    assert client.post(TASKS, headers=s["headers"], json=payload).status_code == 403
    broken = route(s)
    broken["nodes"][1]["next_team_id"] = 999999
    assert client.post(TASKS, json=broken).status_code == 422
    assert client.get(TASKS).json()["total"] == client.get(URL).json()["total"] == 0
    first = create(client, payload)
    assert client.post(TASKS, json=payload).json() == first
    assert client.post(TASKS, json={**payload, "title": "另一份"}).status_code == 409
    second = create(client, route(s, title="第二批交货任务"))
    assert first["id"] != second["id"] and first["serial_no"] == second["serial_no"]
    assert [node["sequence_no"] for node in first["nodes"]] == [1, 2]
    assert first["nodes"][1]["predecessor_id"] == first["nodes"][0]["id"]
    assert all(node["task_id"] == first["id"] for node in first["nodes"])
    assert [node["target_quantity"] for node in first["nodes"]] == [100, 20]
    assert all(node["execution_state"] == "waiting_material" for node in first["nodes"])
    assert client.get(f"{TASKS}/{first['id']}", headers=s["other_headers"]).status_code == 200
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(MaterialTransfer)) == 0
        assert db.scalar(select(func.count()).select_from(ProductionScheduleTask)) == 2


def test_task_filters_paginate_matching_tasks_but_return_whole_route(client, warehouse):
    s = warehouse
    lot = intake(client, s).json()
    payload = route(s, lot, title="第一批")
    payload["nodes"][1]["due_at"] = "2000-01-01T12:00:00+08:00"
    first = create(client, payload)
    second = create(client, route(s, title="第二批"))
    page = client.get(TASKS, params={"team_id": s["other"]["id"], "page_size": 1}).json()
    assert page["total"] == 2 and len(page["items"]) == 1 and len(page["items"][0]["nodes"]) == 2
    assert (
        client.get(TASKS, params={"query": second["task_no"]}).json()["items"][0]["id"]
        == second["id"]
    )
    assert client.get(TASKS, params={"query": "第二批"}).json()["total"] == 1
    assert (
        client.get(TASKS, params={"query": lot["batch_no"], "team_id": s["other"]["id"]}).json()[
            "total"
        ]
        == 0
    )
    assert (
        client.get(TASKS, params={"query": lot["batch_no"], "team_id": s["team"]["id"]}).json()[
            "total"
        ]
        == 1
    )
    assert (
        dispatch(
            client, s, [{"source_transfer_id": lot["id"], "quantity": 100, "weight": 10}]
        ).status_code
        == 201
    )
    assert task_detail(client, first)["nodes"][0]["status"] == "not_assessed"
    assert task_detail(client, first)["status"] == "overdue"
    assert client.get(TASKS, params={"status": "completed"}).json()["total"] == 0
    overdue = client.get(TASKS, params={"status": "overdue"}).json()
    assert overdue["total"] == 1 and overdue["items"][0]["id"] == first["id"]
    nodes = client.get(URL, params={"task_id": first["id"]}).json()
    assert nodes["total"] == 2 and all(node["task_id"] == first["id"] for node in nodes["items"])


@pytest.mark.parametrize(
    "basis,quantity,weight,complete",
    [
        ("quantity", 100, 9, True),
        ("weight", 90, 10, True),
        ("both", 100, 9, False),
    ],
)
def test_completion_basis_changes_only_fulfillment_not_actual_quantities(
    client, warehouse, basis, quantity, weight, complete
):
    s = warehouse
    lot = processing_lot(client, s)
    assert (
        change(client, s, lot, 100, workshop=True, processing_status="complete").status_code == 201
    )
    item = plan(client, s, lot, workshop=True, target_weight=10, completion_basis=basis)
    response = dispatch(
        client,
        s,
        [{"source_transfer_id": lot["id"], "quantity": quantity, "weight": weight}],
        workshop=True,
    )
    assert response.status_code == 201, response.text
    result = get(client, item)
    assert (result["status"] == "completed") is complete
    assert result["dispatched_quantity"] == quantity and result["dispatched_weight"] == weight
    assert result["execution_state"] == ("completed" if complete else "partial")
    task = client.get(f"{TASKS}/{item['task_id']}").json()
    assert task["nodes"][0]["completion_basis"] == basis
    updated = {
        **body(s, lot, workshop=True, target_weight=10),
        "expected_version": 1,
        "notes": "改备注，未改完成口径",
    }
    response = client.patch(f"{URL}/{item['id']}", json=updated)
    assert response.status_code == 200, response.text
    assert response.json()["completion_basis"] == basis


def test_execution_and_task_revisions_follow_real_receipt_and_node_edits(client, warehouse):
    s = warehouse
    lot = intake(client, s).json()
    item = create(client, route(s, lot))
    assert [node["execution_state"] for node in item["nodes"]] == ["ready", "waiting_material"]
    sent = dispatch(
        client, s, [{"source_transfer_id": lot["id"], "quantity": 10, "weight": 1}]
    ).json()
    assert [node["execution_state"] for node in task_detail(client, item)["nodes"]] == [
        "stock_dispatched",
        "pending_receipt",
    ]
    assert confirm(client, s, sent, workshop=True).status_code == 200
    assert task_detail(client, item)["nodes"][1]["execution_state"] == "ready"
    first = item["nodes"][0]
    assert (
        client.patch(
            f"{URL}/{first['id']}",
            json={**body(s, lot), "expected_version": 1, "notes": "调整节点"},
        ).status_code
        == 200
    )
    metadata = {"expected_version": 1, "title": "修改标题", "notes": "急件"}
    assert client.patch(f"{TASKS}/{item['id']}", json=metadata).status_code == 409
    metadata["expected_version"] = 2
    assert (
        client.patch(f"{TASKS}/{item['id']}", headers=s["headers"], json=metadata).status_code
        == 403
    )
    response = client.patch(f"{TASKS}/{item['id']}", json=metadata)
    assert response.status_code == 200, response.text
    assert (
        response.json()["version"] == 3 and response.json()["nodes"][0]["task_title"] == "修改标题"
    )
    assert get(client, first)["history"][0]["action"] == "task_updated"
    second = item["nodes"][1]
    assert (
        client.post(f"{URL}/{second['id']}/cancel", json={"expected_version": 1}).status_code == 200
    )
    assert task_detail(client, item)["version"] == 4


def test_nodes_cannot_cross_task_serial_or_break_route_and_basis_is_validated(client, warehouse):
    s = warehouse
    first = create(client, route(s))
    other = create(client, route(s))
    node = first["nodes"][1]
    update = {
        **body(s, workshop=True, target_quantity=20),
        "expected_version": 1,
        "predecessor_id": other["nodes"][0]["id"],
    }
    assert client.patch(f"{URL}/{node['id']}", json=update).status_code == 409
    update["predecessor_id"] = first["nodes"][0]["id"]
    assert (
        client.patch(f"{URL}/{node['id']}", json={**update, "predecessor_id": None}).status_code
        == 409
    )
    update["serial_no"] = "WRONG"
    assert client.patch(f"{URL}/{node['id']}", json=update).status_code == 409
    assert client.post(URL, json=body(s, completion_basis="both")).status_code == 422
    assert client.post(URL, json=body(s, completion_basis="weight")).status_code == 422
    broken = route(s)
    broken["nodes"][0]["next_team_id"] = 999
    assert client.post(TASKS, json=broken).status_code == 422


def test_quality_hold_is_exposed_without_claiming_material_is_processed(client, inspection):
    s, lot, _, _ = inspection
    item = plan(
        client,
        s,
        lot,
        workshop=True,
        target_quantity=10,
        sources=[{"source_transfer_id": lot["id"], "quantity": 10}],
    )
    assert get(client, item)["execution_state"] == "ready"
    issue = create_check(client, inspection).json()
    with SessionLocal.begin() as db:
        db.get(MaterialInspection, issue["id"]).blocks_outbound = True
    result = get(client, item)
    assert result["quality_held"] is True and result["execution_state"] == "ready"
    assert result["dispatched_quantity"] == 0
    options = client.get(
        URL + "/source-options",
        params={
            "team_id": s["other"]["id"],
            "serial_no": lot["serial_no"],
            "schedule_id": item["id"],
        },
    ).json()
    assert options["total"] == 0


def test_partial_completed_outputs_count_but_unprocessed_dispatch_does_not(client, warehouse):
    s = warehouse
    lot = processing_lot(client, s)
    item = plan(client, s, lot, workshop=True)
    raw = dispatch(
        client, s, [{"source_transfer_id": lot["id"], "quantity": 20, "weight": 2}], workshop=True
    )
    assert raw.status_code == 201, raw.text
    result = get(client, item)
    assert result["dispatched_quantity"] == 0
    assert (
        len(result["deliveries"]) == 1
    )  # Retain the physical journey without fulfilling delivery.
    changed = change(
        client,
        s,
        lot,
        80,
        workshop=True,
        processing_status="partial",
        outputs=[
            {"role": "produced", "quantity": 20, "weight": 2, "material_type": "semi_finished"},
            {"role": "remaining", "quantity": 60, "weight": 6, "material_type": "semi_finished"},
        ],
    )
    assert changed.status_code == 201, changed.text
    produced, _ = changed.json()["outputs"]
    sent = dispatch(
        client,
        s,
        [{"source_transfer_id": produced["id"], "quantity": 20, "weight": 2}],
        workshop=True,
        idempotency_key="produced-portion",
    )
    assert sent.status_code == 201, sent.text
    result = get(client, item)
    assert result["dispatched_quantity"] == 20 and result["remaining_quantity"] == 80
    assert result["stock"]["on_hand_quantity"] == 60
    assert result["execution_state"] == "partial"
    assert result["completed_at"] is None
    assert len(result["deliveries"]) == 2
    assert [delivery["counts_toward_delivery"] for delivery in result["deliveries"]] == [
        False,
        True,
    ]


def test_partial_flow_shows_actual_locations_and_warehouse_is_not_assessed(client, warehouse):
    s = warehouse
    lot = intake(client, s).json()
    item = create(client, route(s, lot))
    sent = dispatch(client, s, [{"source_transfer_id": lot["id"], "quantity": 40, "weight": 4}])
    assert sent.status_code == 201, sent.text
    task = task_detail(client, item)
    locations = {row["team_id"]: row for row in task["locations"]}
    assert locations[s["team"]["id"]]["quantity"] == 60
    assert locations[s["other"]["id"]]["pending_quantity"] == 40
    assert locations[s["other"]["id"]]["quantity"] == 0
    assert task["nodes"][0]["status"] == "not_assessed"
    assert task["nodes"][0]["assessment_enabled"] is False
    assert task["nodes"][0]["completed_at"] is None
    assert confirm(client, s, sent.json(), workshop=True).status_code == 200
    locations = {row["team_id"]: row for row in task_detail(client, item)["locations"]}
    assert locations[s["other"]["id"]]["quantity"] == 40
    assert locations[s["other"]["id"]]["pending_quantity"] == 0


def test_attention_and_completed_filters_are_server_paginated_and_exclude_warehouse(
    client, warehouse
):
    s = warehouse
    for title in ("第一批", "第二批"):
        payload = route(s, title=title)
        payload["nodes"][1]["due_at"] = "2000-01-01T12:00:00+08:00"
        create(client, payload)
    warehouse_only = plan(client, s, due_at="2000-01-01T12:00:00+08:00")
    assert get(client, warehouse_only)["status"] == "not_assessed"
    assert client.get(TASKS, params={"scope": "completed"}).json()["total"] == 0
    page = client.get(TASKS, params={"scope": "attention", "page_size": 1, "page": 2}).json()
    assert page["total"] == 2 and len(page["items"]) == 1
    assert len(page["items"][0]["nodes"]) == 2
    assert client.get(TASKS, params={"status": "not_assessed"}).json()["total"] == 1


def test_business_people_are_independent_and_filter_tasks_with_exact_multiple_serials(
    client, warehouse
):
    s = warehouse
    directory = URL + "/business-people"
    assert client.post(directory, headers=s["headers"], json={"name": "张工"}).status_code == 403
    zhang = client.post(directory, json={"name": "张工"}).json()
    li = client.post(directory, json={"name": "李工"}).json()
    first = create(client, route(s, title="张工订单", business_person_id=zhang["id"]))
    second_payload = route(s, title="李工订单", business_person_id=li["id"], serial_no="A,B")
    second = create(client, second_payload)
    create(client, route(s, title="其他订单"))
    assert first["business_person_name"] == "张工"
    filtered = client.get(
        TASKS,
        params=[
            ("business_person_ids", li["id"]),
            ("business_person_ids", zhang["id"]),
            ("serial_nos", "A,B"),
            ("serial_nos", "NOT-FOUND"),
        ],
    ).json()
    assert filtered["total"] == 1 and filtered["items"][0]["id"] == second["id"]
    assert client.get(URL + "/serial-options", params={"query": "A,B"}).json()["items"] == [
        {"serial_no": "A,B", "task_count": 1}
    ]
    disabled = client.patch(
        f"{directory}/{li['id']}", json={"name": "李工", "active": False, "expected_version": 1}
    )
    assert disabled.status_code == 200
    assert task_detail(client, second)["business_person_name"] == "李工"
    assert client.post(TASKS, json=route(s, business_person_id=li["id"])).status_code == 422
    assert (
        client.patch(
            f"{directory}/{li['id']}", json={"name": "李工", "active": True, "expected_version": 1}
        ).status_code
        == 409
    )
    assert client.post(directory, json={"name": " 张工 "}).status_code == 409
    assert client.post(directory, json={"name": "  "}).status_code == 422
    assert (
        client.patch(
            f"{TASKS}/{second['id']}",
            json={
                "expected_version": second["version"],
                "title": "改标题",
                "business_person_id": li["id"],
            },
        ).status_code
        == 200
    )


def test_repeated_team_visits_do_not_double_task_physical_inventory(client, warehouse):
    s = warehouse
    lot = intake(client, s).json()
    payload = route(s, lot)
    last = body(s, lot)
    payload["nodes"].append(
        {
            key: value
            for key, value in last.items()
            if key not in {"idempotency_key", "serial_no", "sequence_no", "predecessor_id"}
        }
    )
    task = create(client, payload)
    assert len(task["nodes"]) == 3
    assert len(task["locations"]) == 1
    assert task["locations"][0]["quantity"] == 100


def test_shared_source_is_explicit_instead_of_implying_exclusive_task_inventory(client, warehouse):
    s = warehouse
    lot = intake(client, s).json()
    first = create(client, route(s, lot))
    create(client, route(s, lot))
    assert task_detail(client, first)["shared_source"] is True
    assert task_detail(client, first)["locations"][0]["quantity"] == 100
