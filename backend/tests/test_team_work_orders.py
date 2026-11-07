"""Team work-order counts use distinct serials and factory calendar dates."""

from datetime import date, datetime

import pytest
from app import team_dashboard
from app.database import SessionLocal
from app.models import (
    MaterialQuantityAdjustment,
    MaterialTransfer,
    ProductionSchedule,
    ProductionScheduleDelivery,
    ProductionScheduleTask,
    SharedMaterialGroup,
    SharedMaterialMember,
    Team,
    TeamEmployee,
)
from test_team_dashboard import overview
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401


@pytest.fixture(autouse=True)
def clock(monkeypatch):
    monkeypatch.setattr(team_dashboard, "utcnow", lambda: datetime(2026, 11, 7, 8))


def lot(db, team, serial, key, *, status="received", kind="semi_finished", **values):
    if status == "pending":
        source = db.query(Team).filter_by(code="FACTORY-WAREHOUSE").one()
        values.update(
            source_team_id=source.id, source_team_code=source.code, source_team_name=source.name
        )
    item = MaterialTransfer(
        batch_no=key,
        serial_no=serial,
        next_team_id=team["id"],
        next_team_code=team["code"],
        next_team_name=team["name"],
        entry_kind="opening_stock" if status == "received" else "transfer",
        status=status,
        stock_tracked=True,
        material_type=kind,
        quantity=10,
        weight=1,
        received_at=datetime(2026, 10, 30) if status == "received" else None,
        created_by="test",
        **values,
    )
    db.add(item)
    db.flush()
    return item


def work(db, item, employee, day, *, state="complete"):
    db.add(
        MaterialQuantityAdjustment(
            source_transfer_id=item.id,
            team_id=item.next_team_id,
            before_quantity=10,
            after_quantity=10,
            processing_status=state,
            processor_employee_id=employee.id,
            processing_date=day,
            completed_quantity=10,
            completed_weight=1,
            weight_snapshot=1,
            stock_revision_before=0,
            reason="测试加工",
            idempotency_key=f"work-{item.batch_no}",
            request_hash="test",
            created_by="test",
        )
    )


def send(db, source, target, key):
    item = MaterialTransfer(
        batch_no=key,
        serial_no=source.serial_no,
        source_transfer_id=source.id,
        source_team_id=source.next_team_id,
        source_team_code=source.next_team_code,
        source_team_name=source.next_team_name,
        next_team_id=target["id"],
        next_team_code=target["code"],
        next_team_name=target["name"],
        entry_kind="transfer",
        status="pending",
        quantity=10,
        weight=1,
        sent_processing_status="complete",
        created_at=datetime(2026, 11, 7, 1),
        created_by="test",
    )
    db.add(item)
    db.flush()
    return item


def test_periods_deduplicate_batches_and_preserve_completed_orders_after_dispatch(
    client, warehouse
):
    team = warehouse["other"]
    with SessionLocal() as db:
        employee = db.query(TeamEmployee).filter_by(team_id=team["id"]).first()
        for number, key, day, state in [
            ("A", "a1", date(2026, 11, 2), "complete"),
            ("A", "a2", date(2026, 11, 3), "complete"),
            ("B", "b", date(2026, 11, 1), "complete"),
            ("C", "c", date(2026, 11, 7), "complete"),
            ("D", "d", date(2026, 11, 6), "complete"),
            ("E", "e", date(2026, 10, 31), "complete"),
            ("F", "f", date(2026, 11, 7), "partial"),
        ]:
            item = lot(db, team, number, key, rework_pending=number == "D")
            work(db, item, employee, day, state=state)
            if number == "C":
                send(db, item, warehouse["team"], "c-out")
        lot(db, team, "A", "a3")  # One unfinished batch keeps the entire serial open.
        lot(db, team, "PENDING", "pending", status="pending")
        scrap = lot(db, team, "SCRAP", "scrap", kind="scrap_chips")
        work(db, scrap, employee, date(2026, 11, 7))
        lot(db, team, "", "unnumbered")
        db.commit()
    result = overview(client, team["id"])["work_orders"]
    assert result["in_progress_count"] == 3
    assert {
        item["key"]: (item["processed_count"], item["completed_count"])
        for item in result["periods"]
    } == {
        "today": (2, 1),
        "week": (4, 1),
        "month": (5, 2),
    }
    assert result["periods"][1]["date_from"] == "2026-11-02"
    # Zero remaining stock hides the serial in the default list, not in history.
    url = f"/api/team-materials/{team['id']}/inventory"
    assert client.get(url, params={"serial_no": "C"}).json()["total"] == 0
    assert client.get(url, params={"serial_no": "C", "availability": "all"}).json()["total"] == 1


def test_factory_midnight_and_week_start_are_not_utc_dates(client, warehouse, monkeypatch):
    monkeypatch.setattr(team_dashboard, "utcnow", lambda: datetime(2026, 11, 1, 16, 1))
    with SessionLocal() as db:
        team = warehouse["other"]
        employee = db.query(TeamEmployee).filter_by(team_id=team["id"]).first()
        work(db, lot(db, team, "SUNDAY", "sunday"), employee, date(2026, 11, 1))
        work(db, lot(db, team, "MONDAY", "monday"), employee, date(2026, 11, 2))
        db.commit()
    periods = overview(client, team["id"])["work_orders"]["periods"]
    assert [(p["date_from"], p["date_to"], p["completed_count"]) for p in periods] == [
        ("2026-11-02", "2026-11-02", 1),
        ("2026-11-02", "2026-11-02", 1),
        ("2026-11-01", "2026-11-02", 2),
    ]


def test_shared_stock_counts_each_member_once_and_excludes_arrivals(client, warehouse):
    with SessionLocal() as db:
        group = SharedMaterialGroup(batch_no="work-shared")
        db.add(group)
        db.flush()
        db.add_all([SharedMaterialMember(group_id=group.id, serial_no=n) for n in ("A", "B")])
        lot(
            db,
            warehouse["other"],
            "共投",
            "shared",
            shared_group_id=group.id,
            shared_unallocated=True,
        )
        lot(db, warehouse["other"], "A", "separate")
        lot(db, warehouse["other"], "C", "not-received", status="pending")
        db.commit()
    assert overview(client, warehouse["other"]["id"])["work_orders"]["in_progress_count"] == 2


def test_overdue_uses_delivery_status_deduplicates_serials_and_excludes_cancelled(
    client, warehouse
):
    team = warehouse["other"]
    with SessionLocal() as db:
        for key, number, planning, cancelled, done in [
            ("late1", "A", "confirmed", False, False),
            ("late2", "A", "confirmed", False, False),
            ("draft", "B", "pending", False, False),
            ("cancelled", "C", "confirmed", True, False),
            ("done", "D", "confirmed", False, True),
        ]:
            task = ProductionScheduleTask(
                title=number,
                serial_no=number,
                idempotency_key=key,
                request_hash="test",
                cancelled_at=datetime(2026, 11, 6) if cancelled else None,
            )
            db.add(task)
            db.flush()
            plan = ProductionSchedule(
                task_id=task.id,
                serial_no=number,
                team_id=team["id"],
                next_team_id=warehouse["team"]["id"],
                due_at=datetime(2026, 11, 6),
                initial_due_at=datetime(2026, 11, 6),
                target_quantity=10,
                planning_state=planning,
                idempotency_key=key,
                request_hash="test",
            )
            db.add(plan)
            db.flush()
            if done:
                origin = lot(db, team, number, "done-origin")
                outgoing = send(db, origin, warehouse["team"], "done-out")
                db.add(ProductionScheduleDelivery(schedule_id=plan.id, transfer_id=outgoing.id))
        db.commit()
    assert overview(client, team["id"])["work_orders"]["overdue_count"] == 1


def test_warehouse_shows_handling_not_fake_processing(client, warehouse):
    with SessionLocal() as db:
        first = lot(db, warehouse["team"], "SENT", "wh-first")
        first.received_at = datetime(2026, 11, 7, 0)
        second = lot(db, warehouse["team"], "HELD", "wh-second")
        second.received_at = datetime(2026, 11, 7, 0)
        send(db, first, warehouse["other"], "wh-out")
        db.commit()
    result = overview(client, warehouse["team"]["id"])["work_orders"]
    assert result["mode"] == "handling"
    assert result["in_progress_count"] == 1
    assert result["overdue_count"] is None
    assert all(p["processed_count"] == 2 and p["completed_count"] == 1 for p in result["periods"])
