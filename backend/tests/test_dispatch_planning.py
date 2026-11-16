import json
from datetime import datetime
from functools import lru_cache
from uuid import uuid4

import pytest
from app.database import SessionLocal
from app.models import MaterialTransfer, ProcessRoute, ProductionScheduleTask
from sqlalchemy import func, select
from test_material_transfers import _leader
from test_process_route_orders import VALUES, xlsx
from test_process_routes import published
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

URL = "/api/production-schedules"


@lru_cache
def order_file(serial):
    return xlsx([serial, *VALUES[1:]])


def submit(client, body, headers=None):
    return client.post(
        URL + "/tasks",
        headers=headers,
        data={"payload": json.dumps(body)},
        files={"file": ("订单.xlsx", order_file(body["serial_no"]))},
    )


@pytest.fixture()
def dispatcher(client):
    response = client.post(
        "/api/teams", json={"code": "FACTORY-DISPATCH", "name": "调度", "kind": "dispatch"}
    )
    assert response.status_code == 201, response.text
    return _leader(client, "dispatch-leader", response.json()["id"])[1]


def create(
    client,
    warehouse,
    dispatcher,
    final_due="2026-12-30T16:00:00+08:00",
    *,
    team_plans=False,
    same_team=False,
):
    route = published(client, warehouse, same_team)
    people = [
        client.post(URL + "/business-people", json={"name": name}).json()["id"]
        for name in ["业务甲", "业务乙"]
    ]
    body = dict(
        serial_no="WAREHOUSE-001",
        route_id=route["id"],
        route_version=route["version"],
        final_due_at=final_due,
        idempotency_key=uuid4().hex,
        business_person_ids=people,
        delivery_batches=[
            dict(batch_number=1, target_quantity=40, due_at="2026-12-29T16:00:00+08:00"),
            dict(batch_number=2, target_quantity=60, due_at="2026-12-30T16:00:00+08:00"),
        ],
    )
    if team_plans:
        steps = []
        for index, step in enumerate(route["steps"]):
            if steps and steps[-1][1]["team_id"] == step["team_id"]:
                steps[-1] = (index, step)
            else:
                steps.append((index, step))
        body["team_plans"] = [
            dict(
                process_step_index=index,
                batches=[
                    dict(
                        batch_number=1,
                        target_quantity=40,
                        due_at=f"2026-12-{20 + i}T08:00:00+08:00",
                    ),
                    dict(
                        batch_number=2,
                        target_quantity=60,
                        due_at=f"2026-12-{20 + i}T16:00:00+08:00",
                    ),
                ],
            )
            for i, (index, _) in enumerate(steps)
        ]
    assert submit(client, body, warehouse["headers"]).status_code == 403
    response = submit(client, body, dispatcher)
    assert response.status_code == 201, response.text
    assert submit(client, body, dispatcher).json()["id"] == response.json()["id"]
    return response.json(), people


def test_dispatch_creates_all_team_batches_in_one_form(client, warehouse, dispatcher):
    task, _ = create(client, warehouse, dispatcher, team_plans=True)
    assert len(task["nodes"]) == 3
    for index, node in enumerate(task["nodes"]):
        assert node["planning_state"] == "confirmed"
        assert node["target_quantity"] == 100
        assert [b["target_quantity"] for b in node["batches"]] == [40, 60]
        assert node["due_at"] == f"2026-12-{20 + index}T08:00:00+00:00"
        response = client.get(f"{URL}/{node['id']}", headers=warehouse["other_headers"])
        assert response.status_code == 200
        assert response.json()["batches"] == node["batches"]
    with SessionLocal() as db:
        assert db.scalar(select(func.count(MaterialTransfer.id))) == 0


def test_existing_handover_shows_all_local_operations_without_merging_later_visits(
    client, warehouse, dispatcher
):
    task, _ = create(client, warehouse, dispatcher, team_plans=True, same_team=True)
    nodes = task["nodes"]
    assert [n["process_step_index"] for n in nodes] == [0, 2, 3]
    assert [n["process_step_names"] for n in nodes] == [
        ["中转库"],
        ["轧板", "二次轧板"],
        ["库房成品入库"],
    ]
    assert nodes[0]["team_id"] == nodes[2]["team_id"]
    assert nodes[1]["target_quantity"] == 100
    assert nodes[1]["notes"] == "二次轧板"
    listed = client.get(URL + "/tasks", headers=dispatcher).json()["items"][0]
    assert listed["nodes"][1]["process_step_names"] == ["轧板", "二次轧板"]
    detail = client.get(f"{URL}/{nodes[1]['id']}", headers=warehouse["other_headers"]).json()
    assert detail["process_step_names"] == ["轧板", "二次轧板"]
    assert detail["batches"] == nodes[1]["batches"]


def team_change(node, due):
    return dict(
        schedule_id=node["id"],
        expected_version=node["version"],
        batches=[
            {
                k: b[k]
                for k in (
                    "id",
                    "batch_number",
                    "target_quantity",
                    "target_weight",
                    "upstream_batch_ids",
                )
            }
            | {"due_at": due}
            for b in node["batches"]
        ],
    )


def test_bulk_team_plan_edit_is_atomic_and_keeps_batch_ids(client, warehouse, dispatcher):
    task, _ = create(client, warehouse, dispatcher, team_plans=True)
    payload = dict(
        expected_version=task["version"],
        title=task["title"],
        notes="统一调整",
        team_plans=[team_change(n, "2026-12-25T16:00:00+08:00") for n in task["nodes"]],
    )
    endpoint = f"{URL}/tasks/{task['id']}"
    assert (
        client.patch(endpoint, headers=warehouse["other_headers"], json=payload).status_code == 403
    )
    payload["team_plans"][-1]["expected_version"] += 1
    failed = client.patch(endpoint, headers=dispatcher, json=payload)
    assert failed.status_code == 409, failed.text
    unchanged = client.get(endpoint, headers=dispatcher).json()
    assert unchanged["version"] == task["version"]
    assert unchanged["notes"] == task["notes"]
    assert [n["batches"] for n in unchanged["nodes"]] == [n["batches"] for n in task["nodes"]]
    payload["team_plans"][-1]["expected_version"] -= 1
    saved = client.patch(endpoint, headers=dispatcher, json=payload)
    assert saved.status_code == 200, saved.text
    saved = saved.json()
    for original, updated in zip(task["nodes"], saved["nodes"], strict=True):
        assert [b["id"] for b in updated["batches"]] == [b["id"] for b in original["batches"]]
        assert updated["due_at"] == "2026-12-25T08:00:00+00:00"
        assert updated["planning_state"] == "confirmed"
    assert client.patch(endpoint, headers=dispatcher, json=payload).status_code == 409


def test_creation_requires_complete_and_matching_team_plans_when_supplied(
    client, warehouse, dispatcher
):
    task, people = create(client, warehouse, dispatcher, team_plans=True)
    body = dict(
        serial_no=task["serial_no"],
        route_id=task["nodes"][0]["process_route_id"],
        route_version=1,
        final_due_at="2026-12-30T16:00:00+08:00",
        business_person_ids=people,
        planned_quantity=100,
        idempotency_key=uuid4().hex,
    )
    options = client.get(URL + "/route-options", params={"serial_no": task["serial_no"]}).json()
    body["route_version"] = next(r["version"] for r in options if r["id"] == body["route_id"])
    plans = [
        dict(
            process_step_index=n["process_step_index"],
            batches=[dict(batch_number=1, target_quantity=100, due_at="2026-12-25T16:00:00+08:00")],
        )
        for n in task["nodes"]
    ]
    for invalid in (
        [],
        plans[:-1],
        [plans[0], *plans[:-1]],
        [dict(plans[0], process_step_index=999), *plans[1:]],
    ):
        result = submit(client, body | {"team_plans": invalid}, dispatcher)
        assert result.status_code == 422, result.text
    with SessionLocal() as db:
        assert db.scalar(select(func.count(ProductionScheduleTask.id))) == 1


def test_dispatch_plans_take_effect_on_save_and_order_lock_prevents_changes(
    client, warehouse, dispatcher
):
    task, people = create(client, warehouse, dispatcher)
    assert len(task["nodes"]) == 3
    assert all(n["planning_state"] == "pending" and n["process_route_id"] for n in task["nodes"])
    assert {p["id"] for p in task["business_people"]} == set(people)
    for person in people:
        assert (
            client.get(URL + "/tasks", params={"business_person_ids": person}).json()["total"] == 1
        )
    plan = task["nodes"][1]
    endpoint = f"{URL}/{plan['id']}"
    proposal = dict(
        expected_version=plan["version"],
        batches=[dict(batch_number=1, target_quantity=100, due_at="2026-12-29T16:00:00+08:00")],
    )
    for headers in [warehouse["headers"], warehouse["other_headers"]]:
        assert client.put(endpoint + "/batches", headers=headers, json=proposal).status_code == 403
    response = client.put(endpoint + "/batches", headers=dispatcher, json=proposal)
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["planning_state"] == "confirmed" and saved["pending_batches"] is None
    assert saved["due_at"] == saved["batches"][0]["due_at"] == "2026-12-29T08:00:00+00:00"
    assert len(saved["batches"]) == 1
    for headers in [warehouse["headers"], warehouse["other_headers"]]:
        detail = client.get(endpoint, headers=headers)
        assert detail.status_code == 200, detail.text
        assert detail.json()["batches"] == saved["batches"]
    # The retired approval operation is no longer exposed, even to dispatch.
    assert client.post(endpoint + "/review", headers=dispatcher, json={}).status_code == 404
    notices = client.get("/api/business-notices", headers=dispatcher).json()["items"]
    assert any(n["kind"] == "changed" for n in notices)
    assert not any(n["kind"] == "review" for n in notices)
    changed = dict(
        expected_version=saved["version"],
        batches=[
            {
                **proposal["batches"][0],
                "id": saved["batches"][0]["id"],
                "due_at": "2026-12-30T16:00:00+08:00",
            }
        ],
    )
    response = client.put(endpoint + "/batches", headers=dispatcher, json=changed)
    assert response.status_code == 200, response.text
    revised = response.json()
    assert revised["planning_state"] == "confirmed" and revised["pending_batches"] is None
    assert revised["due_at"] == "2026-12-30T08:00:00+00:00"
    assert revised["batches"][0]["id"] == saved["batches"][0]["id"]
    assert client.put(endpoint + "/batches", headers=dispatcher, json=changed).status_code == 409
    task = client.get(f"{URL}/tasks/{task['id']}").json()
    lockurl = f"{URL}/tasks/{task['id']}/lock"
    assert (
        client.put(
            lockurl,
            headers=warehouse["headers"],
            json={"expected_version": task["version"], "locked": True},
        ).status_code
        == 403
    )
    locked = client.put(
        lockurl, headers=dispatcher, json={"expected_version": task["version"], "locked": True}
    )
    assert locked.status_code == 200, locked.text
    locked = locked.json()
    assert locked["locked_at"]
    assert client.get(f"{URL}/tasks/{task['id']}").json()["locked_at"] == locked["locked_at"]
    lock_filter = json.dumps(
        {"filters": [{"field": "locked", "kind": "select", "value": "已锁定"}]}
    )
    listed = client.get(URL + "/tasks", params={"table_query": lock_filter})
    assert listed.status_code == 200, listed.text
    assert listed.json()["total"] == 1
    assert listed.json()["items"][0]["locked_at"] == locked["locked_at"]
    current = client.get(endpoint).json()
    changed["expected_version"] = current["version"]
    assert client.put(endpoint + "/batches", headers=dispatcher, json=changed).status_code == 409
    assert (
        client.put(
            endpoint + "/batches", headers=warehouse["other_headers"], json=changed
        ).status_code
        == 403
    )
    assert (
        client.request(
            "DELETE",
            f"{URL}/tasks/{task['id']}",
            headers=dispatcher,
            json={"expected_version": locked["version"]},
        ).status_code
        == 409
    )
    unlock = client.put(
        lockurl, headers=dispatcher, json={"expected_version": locked["version"], "locked": False}
    )
    assert unlock.status_code == 200
    assert unlock.json()["locked_at"] is None
    assert client.get(f"{URL}/tasks/{task['id']}").json()["locked_at"] is None
    assert client.get(URL + "/tasks", params={"table_query": lock_filter}).json()["total"] == 0
    changed["expected_version"] = client.get(endpoint).json()["version"]
    assert client.put(endpoint + "/batches", headers=dispatcher, json=changed).status_code == 200
    with SessionLocal() as db:
        assert db.scalar(select(func.count(MaterialTransfer.id))) == 0


def test_customer_batches_people_admin_and_soft_delete(client, warehouse, dispatcher):
    task, people = create(client, warehouse, dispatcher)
    assert (
        client.post(URL + "/business-people", headers=dispatcher, json={"name": "越权"}).status_code
        == 403
    )
    person = client.get(URL + "/business-people").json()["items"][0]
    removed = client.patch(
        f"{URL}/business-people/{person['id']}",
        json={
            **{k: person[k] for k in ["name"]},
            "active": False,
            "expected_version": person["version"],
        },
    )
    assert removed.status_code == 200
    assert len(client.get(f"{URL}/tasks/{task['id']}").json()["business_people"]) == 2
    batches = task["delivery_batches"]
    batches[-1]["due_at"] = "2026-12-31T16:00:00+08:00"
    update = dict(
        expected_version=task["version"],
        title=task["title"],
        final_due_at="2026-12-31T16:00:00+08:00",
        delivery_batches=batches,
        business_person_ids=people,
    )
    response = client.patch(f"{URL}/tasks/{task['id']}", headers=dispatcher, json=update)
    assert response.status_code == 200, response.text
    assert any(
        n["kind"] == "final_due"
        for n in client.get("/api/business-notices", headers=warehouse["other_headers"]).json()[
            "items"
        ]
    )
    task = response.json()
    response = client.request(
        "DELETE",
        f"{URL}/tasks/{task['id']}",
        headers=dispatcher,
        json={"expected_version": task["version"]},
    )
    assert response.status_code == 204, response.text
    assert client.get(URL + "/tasks").json()["total"] == 0
    with SessionLocal() as db:
        assert db.get(ProductionScheduleTask, task["id"]).cancelled_at


@pytest.mark.parametrize("state", ["submitted", "revision_pending"])
def test_legacy_proposals_are_preserved_until_saved_directly(client, warehouse, dispatcher, state):
    from app.models import ProductionSchedule, ScheduleNotice

    task, _ = create(client, warehouse, dispatcher)
    plan = task["nodes"][1]
    draft = dict(
        id=None,
        batch_number=1,
        target_quantity=100,
        target_weight=None,
        upstream_batch_ids=[],
        due_at="2026-12-29T16:00:00+08:00",
    )
    with SessionLocal.begin() as db:
        model = db.get(ProductionSchedule, plan["id"])
        model.planning_state = state
        model.pending_batches = [draft]
        notice = ScheduleNotice(
            schedule_id=plan["id"],
            team_id=plan["team_id"],
            kind="review",
            message="请确认",
            event_key=f"legacy:{state}",
        )
        db.add(notice)
        db.flush()
        notice_id = notice.id
    endpoint = f"{URL}/{plan['id']}"
    current = client.get(endpoint).json()
    assert current["pending_batches"][0]["target_quantity"] == 100
    assert not any(
        n["kind"] == "review" for n in client.get("/api/business-notices").json()["items"]
    )
    assert not any(
        n["kind"] == "review" for n in client.get("/api/schedule-notices").json()["items"]
    )
    assert client.get(f"/api/business-notices/schedule/{notice_id}/target").status_code == 404
    result = client.put(
        endpoint + "/batches",
        headers=dispatcher,
        json={"expected_version": current["version"], "batches": [draft]},
    )
    assert result.status_code == 200, result.text
    saved = result.json()
    assert saved["planning_state"] == "confirmed" and saved["pending_batches"] is None
    assert datetime.fromisoformat(saved["due_at"]) == datetime.fromisoformat(draft["due_at"])
    if state == "revision_pending":
        assert saved["initial_due_at"] == current["initial_due_at"]


def test_new_order_requires_business_people(client, warehouse, dispatcher):
    route = published(client, warehouse)
    body = dict(
        serial_no="WAREHOUSE-001",
        route_id=route["id"],
        route_version=route["version"],
        final_due_at="2026-12-30T16:00:00+08:00",
        idempotency_key=uuid4().hex,
        business_person_ids=[],
    )
    assert submit(client, body, dispatcher).status_code == 422
    body["business_person_ids"] = [999999]
    assert submit(client, body, dispatcher).status_code == 422


def test_new_order_requires_a_current_published_process(client, warehouse, dispatcher):
    route = published(client, warehouse)
    person = client.post(URL + "/business-people", json={"name": "业务甲"}).json()
    body = dict(
        serial_no="WAREHOUSE-001",
        route_id=route["id"],
        route_version=route["version"],
        final_due_at="2026-12-30T16:00:00+08:00",
        idempotency_key=uuid4().hex,
        business_person_ids=[person["id"]],
    )
    for field in ("route_id", "route_version"):
        response = submit(
            client, {key: value for key, value in body.items() if key != field}, dispatcher
        )
        assert response.status_code == 422, response.text
    for override in (
        {"route_id": route["id"] + 999},
        {"route_version": route["version"] + 1},
    ):
        response = submit(client, {**body, **override}, dispatcher)
        assert response.status_code == 409, response.text
    with SessionLocal.begin() as db:
        db.get(ProcessRoute, route["id"]).state = "draft"
    assert submit(client, body, dispatcher).status_code == 409
    with SessionLocal.begin() as db:
        assert db.scalar(select(func.count()).select_from(ProductionScheduleTask)) == 0
        db.get(ProcessRoute, route["id"]).state = "published"
    response = submit(client, body, dispatcher)
    assert response.status_code == 201, response.text
    assert all(node["process_route_id"] == route["id"] for node in response.json()["nodes"])


def test_customer_batches_can_finish_before_deadline_without_being_overwritten(
    client, warehouse, dispatcher
):
    task, _ = create(client, warehouse, dispatcher, final_due="2026-12-31T16:00:00+08:00")
    endpoint = f"{URL}/tasks/{task['id']}"
    batches = task["delivery_batches"]
    update = dict(
        expected_version=task["version"],
        title=task["title"],
        final_due_at="2027-01-01T16:00:00+08:00",
    )
    response = client.patch(endpoint, headers=dispatcher, json=update)
    assert response.status_code == 200, response.text
    task = response.json()
    assert task["delivery_batches"] == batches
    # Tightening the deadline must validate the saved batches, and roll back on failure.
    update.update(expected_version=task["version"], final_due_at="2026-12-30T15:00:00+08:00")
    response = client.patch(endpoint, headers=dispatcher, json=update)
    assert response.status_code == 422, response.text
    assert "第 2 批交期不能晚于最终交期" in response.text
    current = client.get(endpoint).json()
    assert current["version"] == task["version"]
    assert current["final_due_at"] == task["final_due_at"]
    assert current["delivery_batches"] == batches
    # A deadline equal to the last batch is also valid.
    update["final_due_at"] = "2026-12-30T16:00:00+08:00"
    assert client.patch(endpoint, headers=dispatcher, json=update).status_code == 200


def test_customer_batch_updates_cannot_exceed_deadline(client, warehouse, dispatcher):
    task, _ = create(client, warehouse, dispatcher)
    endpoint = f"{URL}/tasks/{task['id']}"
    batches = task["delivery_batches"]
    batches[-1]["due_at"] = "2026-12-30T17:00:00+08:00"
    update = dict(expected_version=task["version"], title=task["title"], delivery_batches=batches)
    response = client.patch(endpoint, headers=dispatcher, json=update)
    assert response.status_code == 422
    assert "第 2 批交期不能晚于最终交期" in response.text
    batches[-1]["due_at"] = "2026-12-29T17:00:00+08:00"
    response = client.patch(endpoint, headers=dispatcher, json=update)
    assert response.status_code == 200, response.text
    assert response.json()["delivery_batches"][-1]["due_at"] == "2026-12-29T09:00:00+00:00"


def test_customer_batch_creation_rejects_late_dates(client, dispatcher):
    response = submit(
        client,
        headers=dispatcher,
        body=dict(
            serial_no="S-001",
            route_id=1,
            route_version=1,
            idempotency_key=uuid4().hex,
            business_person_ids=[1],
            final_due_at="2026-12-30T16:00:00+08:00",
            delivery_batches=[
                dict(batch_number=1, target_quantity=100, due_at="2026-12-30T17:00:00+08:00")
            ],
        ),
    )
    assert response.status_code == 422
    assert "第 1 批交期不能晚于最终交期" in response.text
