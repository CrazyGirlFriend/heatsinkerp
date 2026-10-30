from datetime import timedelta

from app.database import SessionLocal
from app.models import (
    ProductionSchedule,
    ReworkNotice,
    ReworkNoticeRead,
    ScheduleNotice,
    User,
    utcnow,
)
from app.schedule_notices import refresh_deadlines
from sqlalchemy import select
from test_material_transfers import _leader
from test_production_schedules import URL, body, plan
from test_schedule_batches import batch
from test_team_rework_notices import prepare
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

INBOX = "/api/business-notices"


def inbox(client, headers=None, **params):
    r = client.get(INBOX, headers=headers or {}, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def rework(client, s):
    _, payload, team, headers = prepare(client, s)
    r = client.post("/api/process-routes/rework-requests", json=payload, headers=s["other_headers"])
    assert r.status_code == 201, r.text
    return team, headers


def test_unified_scopes_independent_receipts(client, warehouse):
    s = warehouse
    team, headers = rework(client, s)
    plan(client, s, workshop=True)
    admin = inbox(client)
    assert {n["source"] for n in admin["items"]} == {"schedule", "rework"}
    assert admin["total"] == admin["unread"] == 2
    own = inbox(client, headers)
    assert own["total"] == 1 and own["items"][0]["source"] == "rework"
    n = own["items"][0]
    assert n["message"] == "厚度偏大，需精磨" and n["batch_no"]
    path = f"{INBOX}/rework/{n['id']}"
    assert client.get(path + "/target", headers=s["other_headers"]).status_code == 404
    assert client.post(path + "/read", headers=s["other_headers"]).status_code == 404
    t = client.get(path + "/target", headers=headers).json()
    assert t["section"] == "problem" and t["route"]["route_kind"] == "rework"
    for _ in range(2):
        assert client.post(path + "/read", headers=headers).status_code == 204
    assert inbox(client, headers)["unread"] == 0
    assert inbox(client)["unread"] == 2
    _, other = _leader(client, "other-engineer", team)
    assert inbox(client, other)["unread"] == 1
    assert inbox(client, category="rework")["total"] == 1
    with SessionLocal() as db:
        assert db.get(ReworkNotice, n["id"]).read_at is None
        assert len(list(db.scalars(select(ReworkNoticeRead)))) == 1


def test_pagination_and_read_all_watermarks(client, warehouse):
    s = warehouse
    rework(client, s)
    plan(client, s, workshop=True)
    with SessionLocal.begin() as db:
        original = db.scalar(select(ScheduleNotice))
        for index in range(23):
            db.add(
                ScheduleNotice(
                    event_key=f"fixture:{index}",
                    schedule_id=original.schedule_id,
                    team_id=original.team_id,
                    kind="changed",
                    message="计划调整",
                    created_at=utcnow() + timedelta(seconds=index),
                )
            )
    first, second = inbox(client), inbox(client, page=2)
    assert first["total"] == 25 and len(first["items"]) == 20 and len(second["items"]) == 5
    keys = [(n["source"], n["id"]) for n in first["items"] + second["items"]]
    assert len(set(keys)) == 25
    plan(client, s, workshop=True)
    assert client.post(INBOX + "/read-all", json=first["latest"]).status_code == 204
    assert inbox(client, unread_only=True)["total"] == 1
    assert inbox(client, s["other_headers"])["unread"] > 1


def test_old_notice_targets_own_revision(client, warehouse):
    s = warehouse
    p = plan(client, s, workshop=True)
    for version, quantity in [(1, 120), (2, 130)]:
        r = client.patch(
            f"{URL}/{p['id']}",
            json={
                **body(s, workshop=True),
                "target_quantity": quantity,
                "expected_version": version,
            },
        )
        assert r.status_code == 200, r.text
    items = inbox(client)["items"]
    assert items[0]["message"] == "数量已调整"
    targets = [client.get(f"{INBOX}/schedule/{n['id']}/target").json() for n in items[:2]]
    assert targets[0]["event_id"] != targets[1]["event_id"]
    detail = client.get(f"{URL}/{p['id']}").json()
    e = next(e for e in detail["history"] if e["id"] == targets[1]["event_id"])
    assert e["after"]["target_quantity"] == 120


def test_batch_and_final_due_targets(client, warehouse):
    s = warehouse
    p = plan(client, s, workshop=True)
    r = client.put(
        f"{URL}/{p['id']}/batches",
        headers=s["other_headers"],
        json={"expected_version": 1, "batches": [batch(1, 100)]},
    )
    assert r.status_code == 200, r.text
    b = r.json()["batches"][0]
    with SessionLocal.begin() as db:
        user = db.scalar(select(User).where(User.role == "ADMIN"))
        due = db.get(ProductionSchedule, p["id"]).due_at
        refresh_deadlines(db, user, due + timedelta(hours=1))
    n = next(n for n in inbox(client)["items"] if n["kind"] == "overdue")
    t = client.get(f"{INBOX}/schedule/{n['id']}/target").json()
    assert t["batch_id"] == b["id"] and t["event_id"] is None
    task = client.get(f"{URL}/tasks/{p['task_id']}").json()
    r = client.patch(
        f"{URL}/tasks/{p['task_id']}",
        json={
            "expected_version": task["version"],
            "title": task["title"],
            "notes": task["notes"],
            "final_due_at": "2026-12-30T17:00:00+08:00",
        },
    )
    assert r.status_code == 200, r.text
    n = next(n for n in inbox(client)["items"] if n["kind"] == "final_due")
    t = client.get(f"{INBOX}/schedule/{n['id']}/target").json()
    e = next(
        e
        for e in client.get(f"{URL}/{t['schedule_id']}").json()["history"]
        if e["id"] == t["event_id"]
    )
    assert e["action"] == "task_updated"


def test_ready_notice_locates_receiving_teams_instruction(client, warehouse):
    from app.models import ProcessRoute
    from test_engineered_rework import save_plan

    s = warehouse
    rework(client, s)
    with SessionLocal() as db:
        route_id = db.scalar(select(ProcessRoute.id))
    route = client.get(f"/api/process-routes/{route_id}").json()
    save_plan(client, s, route)
    own = inbox(client, s["other_headers"], category="rework")
    assert own["total"] == 1
    n = own["items"][0]
    assert n["kind"] == "ready"
    response = client.get(f"{INBOX}/rework/{n['id']}/target", headers=s["other_headers"])
    assert response.status_code == 200, response.text
    target = response.json()
    assert target["section"] == "steps"
    assert target["route"]["steps"][target["step_index"]]["team_id"] == s["other"]["id"]
