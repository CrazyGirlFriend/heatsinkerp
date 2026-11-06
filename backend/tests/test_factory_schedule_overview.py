from datetime import datetime

import pytest
from app import factory_schedule_overview, production_schedules
from app.database import SessionLocal
from app.models import MaterialTransfer, ProductionScheduleTask
from test_production_schedules import plan
from test_quantity_adjustments import change, processing_lot
from test_warehouse_classification import dispatch
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

pytestmark = pytest.mark.usefixtures("legacy_stock")


@pytest.fixture(autouse=True)
def clock(monkeypatch):
    now = datetime(2026, 10, 22, 6)  # Factory time 14:00.
    monkeypatch.setattr(factory_schedule_overview, "utcnow", lambda: now)
    monkeypatch.setattr(production_schedules, "utcnow", lambda: now)


def overview(client, days=7):
    response = client.get("/api/production-schedules/overview", params={"days": days})
    assert response.status_code == 200, response.text
    return response.json()


def test_counts_all_nodes_but_limits_attention_and_excludes_warehouse_and_cancelled(
    client, warehouse
):
    for i in range(8):
        plan(
            client,
            warehouse,
            workshop=True,
            serial_no=f"LATE-{i}",
            due_at="2026-10-21T12:00:00+08:00",
        )
    plan(client, warehouse, workshop=True, due_at="2026-10-01T12:00:00+08:00")
    plan(client, warehouse, workshop=True, due_at="2026-10-22T16:00:00+08:00")
    plan(client, warehouse, workshop=True, due_at="2026-10-23T16:00:00+08:00")
    plan(client, warehouse, due_at="2026-10-21T12:00:00+08:00")
    cancelled = plan(client, warehouse, workshop=True, due_at="2026-10-21T12:00:00+08:00")
    with SessionLocal.begin() as db:
        db.get(ProductionScheduleTask, cancelled["task_id"]).cancelled_at = datetime(2026, 10, 21)
    data = overview(client)
    assert data["period"] == {"completed": 0, "completed_late": 0, "overdue": 8}
    assert data["overdue_count"] == 9  # Older overdue work remains visible.
    assert data["today_count"] == 1
    assert data["assessed_count"] == 8
    assert data["on_time_rate"] == 0
    assert len(data["attention"]) == 6
    assert all(row["status"] == "overdue" for row in data["attention"])


def test_completion_uses_actual_transfer_and_empty_period_has_no_rate(client, warehouse):
    assert overview(client)["on_time_rate"] is None
    lot = processing_lot(client, warehouse)
    assert (
        change(client, warehouse, lot, 100, workshop=True, processing_status="complete").status_code
        == 201
    )
    plan(client, warehouse, lot, workshop=True, due_at="2026-10-22T12:00:00+08:00")
    sent = dispatch(
        client,
        warehouse,
        [{"source_transfer_id": lot["id"], "quantity": 100, "weight": 10}],
        workshop=True,
    )
    assert sent.status_code == 201, sent.text
    transfer_id = sent.json()["items"][0]["id"]
    with SessionLocal.begin() as db:
        db.get(MaterialTransfer, transfer_id).created_at = datetime(2026, 10, 22, 3)
    data = overview(client)
    assert data["period"]["completed"] == 1
    assert data["on_time_rate"] == 100
    assert data["attention"] == []  # Receipt is still pending, but delivery is fulfilled.
    with SessionLocal.begin() as db:
        db.get(MaterialTransfer, transfer_id).created_at = datetime(2026, 10, 22, 5)
    data = overview(client)
    assert data["period"]["completed_late"] == 1
    assert data["period"]["completed"] == 0
    assert data["on_time_rate"] == 0
