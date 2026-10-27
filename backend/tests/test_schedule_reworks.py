"""A reworked piece fulfills its original commitment only on actual delivery."""

from datetime import datetime
from uuid import uuid4

from app.database import SessionLocal
from app.models import ProductionSchedule, ProductionScheduleTask
from test_engineered_rework import save_plan
from test_processing_daily import work
from test_processing_route_methods import routed_lot
from test_processing_schedule_link import commitment
from test_production_schedules import URL, get, plan
from test_warehouse_classification import base, dispatch
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401


def request(client, s, lot, record, quantity=4):
    ctx = client.get(base(s, True) + f"/stock/{lot['id']}/quantity-adjustments").json()
    result = client.post(
        "/api/process-routes/rework-requests",
        headers=s["other_headers"],
        json=dict(
            source_transfer_id=lot["id"],
            rework_of_id=record["id"],
            expected_revision=ctx["revision"],
            quantity=quantity,
            weight=quantity * 10,
            reason="厚度超差",
            idempotency_key=uuid4().hex,
        ),
    )
    assert result.status_code == 201, result.text
    return result.json()


def task_detail(client, node):
    return client.get(f"{URL}/tasks/{node['task_id']}").json()


def test_three_reworks_do_not_add_quota_or_complete_delivery(client, warehouse):
    s = warehouse
    lot, employee, normal = routed_lot(client, s, second=False)
    node = commitment(client, s, lot, normal, 10, index=1)
    with SessionLocal.begin() as db:
        db.get(ProductionSchedule, node["id"]).due_at = datetime(2000, 1, 1)
        db.get(ProductionScheduleTask, node["task_id"]).final_due_at = datetime(2000, 1, 1)
    original = work(client, s, lot, employee).json()
    current = original["outputs"][0]
    record = original
    for round_no in range(1, 4):
        route = request(client, s, current, record)
        context = route["rework_request"]
        assert context["original_schedule_id"] == node["id"]
        assert context["original_task_id"] == node["task_id"]
        assert task_detail(client, node)["reworks"][-1]["state"] == "awaiting_route"
        if round_no == 1:
            sent = dispatch(
                client,
                s,
                [dict(source_transfer_id=current["id"], quantity=6, weight=60)],
                workshop=True,
            )
            assert sent.status_code == 201, sent.text
        route = save_plan(client, s, route)
        child = {"id": context["source_transfer_id"]}
        done = work(client, s, child, employee, work_kind="rework", idempotency_key=uuid4().hex)
        assert done.status_code == 201, done.text
        record = done.json()
        assert record["production_schedule_id"] == node["id"]
        current = record["outputs"][0]
        progress = get(client, node)
        assert progress["processed_quantity"] == 10
        assert progress["dispatched_quantity"] == 6
        assert progress["remaining_quantity"] == 4
        assert progress["status"] == "overdue"
        assert progress["target_quantity"] == 10
        task = task_detail(client, node)
        assert task["final_due_at"] == "2000-01-01T00:00:00+00:00"
        assert task["status"] == "overdue"
        assert len(task["nodes"]) == 1
        assert all(r["state"] == "processed" for r in task["reworks"])
        ctx = client.get(base(s, True) + f"/stock/{current['id']}/quantity-adjustments").json()
        resumed = client.post(
            f"/api/process-routes/rework-lots/{current['id']}/resume",
            headers=s["other_headers"],
            json={"expected_revision": ctx["revision"]},
        )
        assert resumed.status_code == 200, resumed.text
    sent = dispatch(
        client,
        s,
        [dict(source_transfer_id=current["id"], quantity=4, weight=40)],
        workshop=True,
        idempotency_key=uuid4().hex,
    )
    assert sent.status_code == 201, sent.text
    progress = get(client, node)
    assert (progress["dispatched_quantity"], progress["remaining_quantity"]) == (10, 0)
    assert progress["status"] == "completed_late"
    assert task_detail(client, node)["status"] == "completed_late"
    assert client.get(URL + "/tasks", params={"status": "completed_late"}).json()["total"] == 1


def test_link_old_rework_requires_actual_batch_and_preserves_commitment(client, warehouse):
    s = warehouse
    lot, employee, normal = routed_lot(client, s, second=False)
    original = work(client, s, lot, employee).json()
    route = request(client, s, original["outputs"][0], original)
    node = commitment(client, s, lot, normal, 10, index=1)
    task = task_detail(client, node)
    options = client.get(f"{URL}/tasks/{task['id']}/rework-options").json()
    assert [r["route_id"] for r in options] == [route["id"]]
    unrelated = plan(client, s, workshop=True, target_quantity=10, serial_no="OTHER-LOT")
    body = dict(
        expected_version=task["version"],
        route_id=route["id"],
        route_version=route["version"],
        schedule_id=unrelated["id"],
    )
    endpoint = f"{URL}/tasks/{task['id']}/rework"
    assert client.post(endpoint, json=body).status_code == 422
    body["schedule_id"] = node["id"]
    assert client.post(endpoint, json=body, headers=s["other_headers"]).status_code == 403
    saved = client.post(endpoint, json=body)
    assert saved.status_code == 200, saved.text
    assert saved.json()["nodes"][0]["target_quantity"] == 10
    assert saved.json()["final_due_at"] == task["final_due_at"]
    assert client.post(endpoint, json=body).status_code == 409
    route = client.get(f"/api/process-routes/{route['id']}").json()
    save_plan(client, s, route)
    result = work(
        client,
        s,
        {"id": route["rework_request"]["source_transfer_id"]},
        employee,
        work_kind="rework",
        idempotency_key=uuid4().hex,
    )
    assert result.status_code == 201, result.text
    assert result.json()["production_schedule_id"] == node["id"]


def test_final_deadline_is_not_replaced_by_later_team_commitment(client, warehouse):
    s = warehouse
    lot, employee, normal = routed_lot(client, s, second=False)
    node = commitment(client, s, lot, normal, 10, index=1)
    with SessionLocal.begin() as db:
        db.get(ProductionScheduleTask, node["task_id"]).final_due_at = datetime(2000, 1, 1)
    assert task_detail(client, node)["status"] == "overdue"
    assert client.get(URL + "/tasks", params={"status": "overdue"}).json()["total"] == 1
    assert client.get(URL + "/tasks", params={"scope": "attention"}).json()["total"] == 1
    original = work(client, s, lot, employee).json()
    sent = dispatch(
        client,
        s,
        [dict(source_transfer_id=original["outputs"][0]["id"], quantity=10, weight=100)],
        workshop=True,
        idempotency_key=uuid4().hex,
    )
    assert sent.status_code == 201, sent.text
    assert get(client, node)["status"] == "completed"
    assert task_detail(client, node)["status"] == "completed_late"
    assert client.get(URL + "/tasks", params={"status": "completed_late"}).json()["total"] == 1
    assert client.get(URL + "/tasks", params={"status": "completed"}).json()["total"] == 0


def test_rework_handoffs_keep_original_plan_without_crediting_delivery(client, warehouse):
    from test_material_transfers import _leader, _team
    from test_warehouse_classification import confirm

    s = warehouse
    lot, employee, normal = routed_lot(client, s, second=False)
    node = commitment(client, s, lot, normal, 10, index=1)
    original = work(client, s, lot, employee).json()
    route = request(client, s, original["outputs"][0], original, quantity=10)
    third = _team(client, "FACTORY-ANNEAL", "返工退火")
    _, headers = _leader(client, "rework-anneal", third["id"])
    third_s = {**s, "other": third, "other_headers": headers}
    employee3 = client.post(base(third_s, True) + "/employees", json={"name": "退火员"}).json()
    save_plan(client, s, route, team=third["id"])
    sent = dispatch(
        client,
        s,
        [
            dict(
                source_transfer_id=route["rework_request"]["source_transfer_id"],
                quantity=10,
                weight=100,
            )
        ],
        workshop=True,
        next_team_id=third["id"],
        idempotency_key=uuid4().hex,
    )
    assert sent.status_code == 201, sent.text
    assert get(client, node)["dispatched_quantity"] == 0
    assert confirm(client, third_s, sent.json(), workshop=True).status_code == 200
    result = work(
        client,
        third_s,
        sent.json()["items"][0],
        employee3,
        work_kind="rework",
        idempotency_key=uuid4().hex,
    )
    assert result.status_code == 201, result.text
    assert result.json()["production_schedule_id"] == node["id"]
    returned = dispatch(
        client,
        third_s,
        [dict(source_transfer_id=result.json()["outputs"][0]["id"], quantity=10, weight=100)],
        workshop=True,
        next_team_id=s["other"]["id"],
        idempotency_key=uuid4().hex,
    )
    assert returned.status_code == 201, returned.text
    assert get(client, node)["dispatched_quantity"] == 0
    assert confirm(client, s, returned.json(), workshop=True).status_code == 200
    sent = dispatch(
        client,
        s,
        [dict(source_transfer_id=returned.json()["items"][0]["id"], quantity=10, weight=100)],
        workshop=True,
        idempotency_key=uuid4().hex,
    )
    assert sent.status_code == 201, sent.text
    assert get(client, node)["dispatched_quantity"] == 10
