from datetime import datetime, timedelta

from app.database import SessionLocal
from app.models import ProductionSchedule, ScheduleNotice, ScheduleNoticeRead, User
from app.schedule_notices import refresh_deadlines
from sqlalchemy import func, select
from test_material_transfers import _leader
from test_production_schedules import URL, body, plan
from test_schedule_batches import batch
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

INBOX = "/api/schedule-notices"


def notices(client, headers=None, **params):
    response = client.get(INBOX, headers=headers or {}, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_scope_individual_receipts_idempotency_and_read_all_watermark(client, warehouse):
    s = warehouse
    payload = body(s, workshop=True)
    first = client.post(URL, json=payload)
    assert first.status_code == 201, first.text
    assert client.post(URL, json=payload).status_code == 201
    admin = notices(client)
    own = notices(client, s["other_headers"])
    assert admin["total"] == admin["unread"] == own["total"] == 1
    assert notices(client, s["headers"])["total"] == 0
    notice = own["items"][0]
    assert (
        notice["href"]
        == f"/team-workspaces/{s['other']['id']}?tab=delivery-schedule&schedule_id={first.json()['id']}"
    )
    read_url = f"{INBOX}/{notice['id']}/read"
    assert client.post(read_url, headers=s["headers"]).status_code == 404
    for _ in range(2):
        assert client.post(read_url, headers=s["other_headers"]).status_code == 204
    assert notices(client, s["other_headers"])["unread"] == 0
    assert notices(client)["unread"] == 1
    _, same_team = _leader(client, "second-rolling", s["other"]["id"])
    assert notices(client, same_team)["unread"] == 1
    plan(client, s, workshop=True)
    assert (
        client.post(INBOX + "/read-all", json={"through_id": admin["latest_id"]}).status_code == 204
    )
    assert notices(client)["unread"] == 1
    assert notices(client, unread_only=True)["total"] == 1
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(ScheduleNoticeRead)) == 2


def test_noop_failed_changes_and_cancelled_deadlines(client, warehouse):
    s = warehouse
    p = plan(client, s, workshop=True)
    unchanged = {**body(s, workshop=True), "expected_version": 1}
    assert client.patch(f"{URL}/{p['id']}", json=unchanged).status_code == 200
    assert notices(client)["total"] == 1
    assert client.patch(f"{URL}/{p['id']}", json=unchanged).status_code == 409
    assert notices(client)["total"] == 1
    assert (
        client.post(
            f"{URL}/{p['id']}/cancel", json={"expected_version": 2, "reason": "客户取消"}
        ).status_code
        == 200
    )
    with SessionLocal() as db:
        refresh_deadlines(
            db, db.scalar(select(User).where(User.role == "ADMIN")), datetime(2027, 1, 1)
        )
        db.commit()
    assert [n["kind"] for n in notices(client)["items"]] == ["cancelled", "new"]


def test_deadline_stages_deduplicate_and_warehouse_is_not_assessed(client, warehouse):
    s = warehouse
    p = plan(client, s, workshop=True)
    plan(client, s)
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.role == "ADMIN"))
        due = db.get(ProductionSchedule, p["id"]).due_at
        refresh_deadlines(db, user, due - timedelta(hours=25))
        assert db.scalar(select(func.count()).select_from(ScheduleNotice)) == 2
        for _ in range(2):
            refresh_deadlines(db, user, due - timedelta(hours=23))
            refresh_deadlines(db, user, due + timedelta(hours=1))
        db.commit()
    assert [n["kind"] for n in notices(client)["items"]] == ["overdue", "due_soon", "new", "new"]
    assert notices(client, s["headers"])["total"] == 1


def test_batch_deadlines_use_each_batch_not_parent_and_final_due_notifies_teams(client, warehouse):
    s = warehouse
    p = plan(client, s, workshop=True)
    result = client.put(
        f"{URL}/{p['id']}/batches",
        headers=s["other_headers"],
        json={
            "expected_version": 1,
            "batches": [
                batch(1, 40),
                batch(
                    2,
                    60,
                    planned_start_at="2026-12-22T08:00:00+08:00",
                    due_at="2026-12-23T16:00:00+08:00",
                ),
            ],
        },
    )
    assert result.status_code == 200, result.text
    with SessionLocal() as db:
        refresh_deadlines(
            db, db.scalar(select(User).where(User.role == "ADMIN")), datetime(2026, 12, 21, 12)
        )
        db.commit()
    due_messages = [n for n in notices(client)["items"] if n["kind"] in ("overdue", "due_soon")]
    assert len(due_messages) == 1
    assert "第 1 批" in due_messages[0]["message"]
    task = client.get(f"{URL}/tasks/{p['task_id']}").json()
    result = client.patch(
        f"{URL}/tasks/{p['task_id']}",
        json={
            "expected_version": task["version"],
            "title": task["title"],
            "notes": task["notes"],
            "final_due_at": "2026-12-25T17:00:00+08:00",
        },
    )
    assert result.status_code == 200, result.text
    assert notices(client)["items"][0]["kind"] == "final_due"


def test_completed_batch_does_not_create_reminders_and_cancelled_write_rolls_back(
    client, warehouse
):
    from app.schedule_notices import add_notice
    from test_quantity_adjustments import change, processing_lot
    from test_schedule_batches import save
    from test_warehouse_classification import dispatch

    s = warehouse
    lot = processing_lot(client, s, quantity=100, weight=10)
    assert (
        change(client, s, lot, 100, workshop=True, processing_status="complete").status_code == 201
    )
    p = plan(client, s, lot, workshop=True)
    response = save(client, p, [batch(1, 100)], s["other_headers"])
    assert response.status_code == 200, response.text
    b = response.json()["batches"][0]
    sent = dispatch(
        client,
        s,
        [
            {
                "source_transfer_id": lot["id"],
                "quantity": 100,
                "weight": 10,
                "production_schedule_id": p["id"],
                "production_schedule_batch_id": b["id"],
            }
        ],
        workshop=True,
    )
    assert sent.status_code == 201, sent.text
    with SessionLocal() as db:
        refresh_deadlines(
            db, db.scalar(select(User).where(User.role == "ADMIN")), datetime(2027, 1, 1)
        )
        db.commit()
        assert (
            db.scalar(
                select(func.count())
                .select_from(ScheduleNotice)
                .where(ScheduleNotice.kind == "overdue")
            )
            == 0
        )
        add_notice(db, db.get(ProductionSchedule, p["id"]), "changed", "应随事务回滚", "rollback")
        db.rollback()
        assert (
            db.scalar(select(ScheduleNotice).where(ScheduleNotice.event_key == "rollback")) is None
        )


def test_upstream_changes_reach_only_linked_successor_and_carry_its_deep_link(client, warehouse):
    from app.models import ProductionScheduleTask
    from app.schedule_notices import notify_change, notify_final_due

    s = warehouse
    first = plan(client, s)
    with SessionLocal() as db:
        original = db.get(ProductionSchedule, first["id"])
        next_plan = ProductionSchedule(
            idempotency_key="successor-notice-test",
            request_hash="test",
            task_id=original.task_id,
            serial_no=original.serial_no,
            team_id=s["other"]["id"],
            next_team_id=s["team"]["id"],
            predecessor_id=original.id,
            sequence_no=2,
            due_at=datetime(2026, 12, 22, 8),
            initial_due_at=datetime(2026, 12, 22, 8),
            target_quantity=100,
            completion_basis="quantity",
            version=1,
        )
        db.add(next_plan)
        db.flush()
        original.version += 1
        notify_change(db, original, "updated", {"due_at": "old"}, {"due_at": "new"})
        task = db.get(ProductionScheduleTask, original.task_id)
        task.final_due_at = datetime(2026, 12, 23, 8)
        task.version += 1
        notify_final_due(db, task)
        db.commit()
        successor_id = next_plan.id
    own = notices(client, s["other_headers"])
    assert {n["kind"] for n in own["items"]} == {"upstream", "final_due"}
    assert all(f"schedule_id={successor_id}" in n["href"] for n in own["items"])
    assert len([n for n in notices(client)["items"] if n["kind"] == "final_due"]) == 2
