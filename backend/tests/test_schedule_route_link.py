"""Linking and reviewing routes preserves delivery commitments and executed history."""

from uuid import uuid4

from app.database import SessionLocal
from app.models import (
    MaterialTransfer,
    ProcessRoute,
)
from test_process_routes import published
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

URL = "/api/production-schedules/tasks"


def setup(client, s):
    process = published(client, s)
    steps = process["steps"]
    response = client.post(
        URL,
        json=dict(
            title="先排交货再关联工艺",
            serial_no="WAREHOUSE-001",
            idempotency_key=uuid4().hex,
            nodes=[
                dict(
                    team_id=step["team_id"],
                    next_team_id=steps[i + 1]["team_id"] if i + 1 < len(steps) else None,
                    external_destination=None if i + 1 < len(steps) else "库房成品",
                    due_at=f"2026-12-0{i + 1}T12:00:00+08:00",
                    target_quantity=100,
                    sources=[],
                )
                for i, step in enumerate(steps)
            ],
        ),
    )
    assert response.status_code == 201, response.text
    return process, response.json()


def binding(route, task):
    return dict(
        expected_version=task["version"],
        route_id=route["id"],
        route_version=route["version"],
        mappings=[
            dict(schedule_id=n["id"], expected_version=n["version"], step_index=i)
            for i, n in enumerate(task["nodes"])
        ],
    )


def test_late_link_preserves_dates_targets_and_rejects_foreign_team(client, warehouse):
    route, task = setup(client, warehouse)
    endpoint = f"{URL}/{task['id']}/route"
    payload = binding(route, task)
    assert client.post(endpoint, json=payload, headers=warehouse["headers"]).status_code == 403
    options = client.get(f"{URL}/{task['id']}/route-options").json()
    assert [o["id"] for o in options] == [route["id"]]
    response = client.post(endpoint, json=payload)
    assert response.status_code == 200, response.text
    linked = response.json()
    for before, after in zip(task["nodes"], linked["nodes"], strict=True):
        assert (
            after["due_at"] == before["due_at"]
            and after["target_quantity"] == before["target_quantity"]
        )
        assert after["route_link"]["state"] == "linked"
    assert linked["final_due_at"] == task["final_due_at"]
    assert client.post(endpoint, json=payload).status_code == 409
    with SessionLocal() as db:
        assert not db.query(MaterialTransfer).count()


def test_invalid_mapping_is_atomic_and_new_revision_is_only_a_notice(client, warehouse):
    route, task = setup(client, warehouse)
    body = binding(route, task)
    body["mappings"][-1]["step_index"] = 0
    assert client.post(f"{URL}/{task['id']}/route", json=body).status_code == 422
    assert all(
        n["process_route_id"] is None for n in client.get(f"{URL}/{task['id']}").json()["nodes"]
    )
    linked = client.post(f"{URL}/{task['id']}/route", json=binding(route, task)).json()
    # An accepted new version marks the task; neither stock nor plan is rewritten.
    with SessionLocal.begin() as db:
        old = db.get(ProcessRoute, route["id"])
        newer = ProcessRoute(
            title=old.title,
            filename="",
            source_sha256="",
            source_file=b"",
            source_data={},
            serial_nos=old.serial_nos,
            steps=old.steps,
            parent_id=old.id,
            state="published",
            created_by="工艺",
        )
        db.add(newer)
        db.flush()
        new_id = newer.id
    changed = client.get(f"{URL}/{task['id']}").json()
    assert changed["route_changed"] is True
    assert all(n["process_route_id"] == route["id"] for n in changed["nodes"])
    assert changed["nodes"][0]["route_link"]["latest_route_id"] == new_id
    assert changed["final_due_at"] == linked["final_due_at"]
