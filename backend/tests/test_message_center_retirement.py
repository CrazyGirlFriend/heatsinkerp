"""Business records and live refresh work without generating inbox messages."""

from app.database import SessionLocal, engine
from app.models import (
    MaterialTransferAmendment,
    NotificationOutbox,
)
from sqlalchemy import func, inspect, select
from test_dispatch_planning import create
from test_dispatch_planning import dispatcher as dispatcher  # noqa: F401
from test_inspections import create_check
from test_inspections import inspection as inspection  # noqa: F401
from test_quality_rework_routes import decide
from test_transfer_amendments import handoff as handoff  # noqa: F401
from test_transfer_amendments import request
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401


def test_retired_message_tables_are_not_created(client):
    assert not {
        "schedule_notices",
        "schedule_notice_reads",
        "quality_notices",
        "quality_notice_reads",
        "rework_notices",
        "rework_notice_reads",
        "transfer_amendment_notices",
        "transfer_amendment_notice_reads",
        "serial_delivery_plans",
    }.intersection(inspect(engine).get_table_names())


def test_schedule_changes_keep_business_history_without_messages(client, warehouse, dispatcher):
    task, _ = create(client, warehouse, dispatcher)
    result = client.patch(
        f"/api/production-schedules/tasks/{task['id']}",
        headers=dispatcher,
        json={
            "expected_version": task["version"],
            "title": task["title"],
            "final_due_at": "2027-01-01T16:00:00+08:00",
            "delivery_batches": [
                {**batch, "due_at": "2027-01-01T16:00:00+08:00"}
                for batch in task["delivery_batches"]
            ],
        },
    )
    assert result.status_code == 200, result.text
    assert result.json()["final_due_at"] == "2027-01-01T08:00:00+00:00"


def test_quality_feedback_remains_visible_without_messages(client, inspection):
    setup, _, headers, _ = inspection
    result = create_check(client, inspection)
    assert result.status_code == 201, result.text
    issue = result.json()
    path = f"/api/quality-feedback/{issue['id']}"
    assert client.get(path, headers=setup["other_headers"]).status_code == 200
    result = decide(client, headers, issue, disposition="other")
    assert result.status_code == 200, result.text
    detail = client.get(path, headers=setup["other_headers"]).json()
    assert detail["feedback_status"] == "processing"


def test_amendments_refresh_both_teams_without_messages_and_only_after_commit(client, handoff):
    setup, _, lot = handoff
    result = request(client, setup, lot)
    assert result.status_code == 201, result.text
    amendment_id = result.json()["id"]
    with SessionLocal() as db:
        before = db.scalar(select(func.count()).select_from(NotificationOutbox))
        previous_ids = list(db.scalars(select(NotificationOutbox.id)))
    with SessionLocal() as db:
        amendment = db.get(MaterialTransferAmendment, amendment_id)
        amendment.status = "rejected"
        amendment.pending_transfer_id = None
        db.flush()
        db.rollback()
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(NotificationOutbox)) == before
    with SessionLocal.begin() as db:
        amendment = db.get(MaterialTransferAmendment, amendment_id)
        amendment.status = "rejected"
        amendment.pending_transfer_id = None
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(NotificationOutbox)) == before + 1
        event = db.scalar(
            select(NotificationOutbox).where(NotificationOutbox.id.not_in(previous_ids))
        )
        assert event.payload["team_ids"] == sorted([setup["target"]["id"], setup["third"]["id"]])
