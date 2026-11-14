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


def create(client, warehouse, dispatcher, final_due="2026-12-30T16:00:00+08:00"):
    route = published(client, warehouse)
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
    assert submit(client, body).status_code == 403
    response = submit(client, body, dispatcher)
    assert response.status_code == 201, response.text
    assert submit(client, body, dispatcher).json()["id"] == response.json()["id"]
    return response.json(), people


def test_team_plans_take_effect_on_save_and_order_lock_prevents_changes(
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
    for headers in [None, warehouse["headers"]]:
        assert client.put(endpoint + "/batches", headers=headers, json=proposal).status_code == 403
    response = client.put(endpoint + "/batches", headers=warehouse["other_headers"], json=proposal)
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["planning_state"] == "confirmed" and saved["pending_batches"] is None
    assert saved["due_at"] == saved["batches"][0]["due_at"] == "2026-12-29T08:00:00+00:00"
    assert len(saved["batches"]) == 1
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
    response = client.put(endpoint + "/batches", headers=warehouse["other_headers"], json=changed)
    assert response.status_code == 200, response.text
    revised = response.json()
    assert revised["planning_state"] == "confirmed" and revised["pending_batches"] is None
    assert revised["due_at"] == "2026-12-30T08:00:00+00:00"
    assert revised["batches"][0]["id"] == saved["batches"][0]["id"]
    assert client.put(endpoint + "/batches", headers=dispatcher, json=changed).status_code == 409
    task = client.get(f"{URL}/tasks/{task['id']}").json()
    lockurl = f"{URL}/tasks/{task['id']}/lock"
    assert (
        client.put(lockurl, json={"expected_version": task["version"], "locked": True}).status_code
        == 403
    )
    locked = client.put(
        lockurl, headers=dispatcher, json={"expected_version": task["version"], "locked": True}
    )
    assert locked.status_code == 200, locked.text
    locked = locked.json()
    current = client.get(endpoint).json()
    changed["expected_version"] = current["version"]
    for headers in [dispatcher, warehouse["other_headers"]]:
        assert client.put(endpoint + "/batches", headers=headers, json=changed).status_code == 409
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
    changed["expected_version"] = client.get(endpoint).json()["version"]
    assert (
        client.put(
            endpoint + "/batches", headers=warehouse["other_headers"], json=changed
        ).status_code
        == 200
    )
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
        headers=warehouse["other_headers"],
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
