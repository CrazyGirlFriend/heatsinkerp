from uuid import uuid4

import pytest
from app.database import SessionLocal
from app.models import MaterialTransfer, ProductionScheduleTask
from sqlalchemy import func, select
from test_material_transfers import _leader
from test_process_routes import published
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

URL = "/api/production-schedules"


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
    assert client.post(URL + "/tasks", json=body).status_code == 403
    response = client.post(URL + "/tasks", headers=dispatcher, json=body)
    assert response.status_code == 201, response.text
    assert (
        client.post(URL + "/tasks", headers=dispatcher, json=body).json()["id"]
        == response.json()["id"]
    )
    return response.json(), people


def test_dispatch_route_team_review_lock_and_notices(client, warehouse, dispatcher):
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
        batches=[
            dict(
                batch_number=1,
                target_quantity=100,
                planned_start_at="2026-12-28T08:00:00+08:00",
                due_at="2026-12-29T16:00:00+08:00",
            )
        ],
    )
    assert client.put(endpoint + "/batches", json=proposal).status_code == 403
    assert (
        client.put(endpoint + "/batches", headers=warehouse["headers"], json=proposal).status_code
        == 403
    )
    response = client.put(endpoint + "/batches", headers=warehouse["other_headers"], json=proposal)
    assert response.status_code == 200, response.text
    submitted = response.json()
    assert submitted["planning_state"] == "submitted" and submitted["batches"] == []
    assert submitted["due_at"] == plan["due_at"]
    inbox = client.get("/api/business-notices", headers=dispatcher).json()
    assert any(n["kind"] == "review" for n in inbox["items"])
    review = {"expected_version": submitted["version"], "approve": True}
    assert (
        client.post(
            endpoint + "/review", headers=warehouse["other_headers"], json=review
        ).status_code
        == 403
    )
    approved = client.post(endpoint + "/review", headers=dispatcher, json=review)
    assert approved.status_code == 200, approved.text
    approved = approved.json()
    assert approved["planning_state"] == "confirmed" and approved["pending_batches"] is None
    assert len(approved["batches"]) == 1
    assert client.post(endpoint + "/review", headers=dispatcher, json=review).status_code == 409
    # A revision remains pending while the approved period stays live.
    changed = {**proposal, "expected_version": approved["version"]}
    changed["batches"][0]["id"] = approved["batches"][0]["id"]
    changed["batches"][0]["due_at"] = "2026-12-30T16:00:00+08:00"
    response = client.put(endpoint + "/batches", headers=warehouse["other_headers"], json=changed)
    assert response.status_code == 200, response.text
    revised = response.json()
    assert revised["planning_state"] == "revision_pending"
    assert revised["batches"][0]["due_at"] == approved["batches"][0]["due_at"]
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
    assert locked["locked_at"]
    assert any(
        n["kind"] == "locked"
        for n in client.get("/api/business-notices", headers=warehouse["other_headers"]).json()[
            "items"
        ]
    )
    current = client.get(endpoint).json()
    changed["expected_version"] = current["version"]
    for headers in [dispatcher, warehouse["other_headers"]]:
        assert client.put(endpoint + "/batches", headers=headers, json=changed).status_code == 409
    assert (
        client.post(
            endpoint + "/review",
            headers=dispatcher,
            json={"expected_version": current["version"], "approve": True},
        ).status_code
        == 409
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
    current = client.get(endpoint).json()
    returned = client.post(
        endpoint + "/review",
        headers=dispatcher,
        json={"expected_version": current["version"], "approve": False, "reason": "请提前一天"},
    )
    assert returned.status_code == 200, returned.text
    assert returned.json()["batches"][0]["due_at"] == approved["batches"][0]["due_at"]
    assert any(
        n["kind"] == "returned"
        for n in client.get("/api/business-notices", headers=warehouse["other_headers"]).json()[
            "items"
        ]
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


def test_legacy_confirmed_plan_stays_live_while_revision_is_reviewed(client, warehouse, dispatcher):
    from app.models import ProductionSchedule

    task, _ = create(client, warehouse, dispatcher)
    plan = task["nodes"][1]
    # Migrated plans have a confirmed date but no explicit batch rows.
    with SessionLocal.begin() as db:
        db.get(ProductionSchedule, plan["id"]).planning_state = "confirmed"
    endpoint = f"{URL}/{plan['id']}"
    current = client.get(endpoint).json()
    proposal = dict(
        expected_version=current["version"],
        batches=[
            dict(
                batch_number=1,
                target_quantity=100,
                planned_start_at="2026-12-28T08:00:00+08:00",
                due_at="2026-12-29T16:00:00+08:00",
            )
        ],
    )
    submitted = client.put(endpoint + "/batches", headers=warehouse["other_headers"], json=proposal)
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["planning_state"] == "revision_pending"
    assert submitted.json()["due_at"] == current["due_at"]
    returned = client.post(
        endpoint + "/review",
        headers=dispatcher,
        json=dict(
            expected_version=submitted.json()["version"],
            approve=False,
            reason="交期保留",
        ),
    )
    assert returned.status_code == 200, returned.text
    assert returned.json()["planning_state"] == "confirmed"
    assert returned.json()["due_at"] == current["due_at"]
    proposal["expected_version"] = returned.json()["version"]
    submitted = client.put(
        endpoint + "/batches", headers=warehouse["other_headers"], json=proposal
    ).json()
    approved = client.post(
        endpoint + "/review",
        headers=dispatcher,
        json=dict(
            expected_version=submitted["version"],
            approve=True,
        ),
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["initial_due_at"] == current["initial_due_at"]


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
    assert client.post(URL + "/tasks", headers=dispatcher, json=body).status_code == 422
    body["business_person_ids"] = [999999]
    assert client.post(URL + "/tasks", headers=dispatcher, json=body).status_code == 422


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
    response = client.post(
        URL + "/tasks",
        headers=dispatcher,
        json=dict(
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
