import asyncio
from datetime import timedelta
from unittest.mock import AsyncMock, Mock

import pytest
from app import factory_stream, notification_queue
from app.database import SessionLocal
from app.inventory_events import InventoryChange, inventory_events
from app.main import app
from app.models import MaterialStockBalance, NotificationOutbox, utcnow
from app.notification_queue import NotificationService, claim, complete, prune_published
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import func, select
from test_inventory_stream import LiveRequest
from test_warehouse_receipts import intake, warehouse  # noqa: F401


def pending_rows():
    with SessionLocal() as db:
        return list(
            db.scalars(select(NotificationOutbox).where(NotificationOutbox.published_at.is_(None)))
        )


def test_notification_stages_are_correlated_without_business_data(client, warehouse, monkeypatch):  # noqa: F811
    from test_observability import capture

    records = capture(monkeypatch)
    result = intake(client, warehouse, serial_no="PRIVATE-SERIAL")
    assert result.status_code == 201
    stages = {row["event"]: row for row in records}
    staged = stages["notification.staged"]
    assert staged["request_id"] == result.headers["x-request-id"]
    assert stages["notification.transaction_committed"]["request_id"] == staged["request_id"]
    assert stages["notification.claimed"]["message_id"] == staged["message_id"]
    assert stages["notification.publish_finished"]["message_id"] == staged["message_id"]
    assert stages["notification.publish_finished"]["success"]
    assert "PRIVATE-SERIAL" not in str(records)


def test_many_flushes_in_one_dispatch_emit_one_committed_notification(
    client,
    warehouse,  # noqa: F811
    monkeypatch,
):
    lot = intake(client, warehouse).json()
    monkeypatch.setattr(app.state.notifications.transport, "ready", False)
    response = client.post(
        f"/api/team-materials/{warehouse['team']['id']}/dispatches",
        headers=warehouse["headers"],
        json={
            "next_team_id": warehouse["other"]["id"],
            "idempotency_key": "one-notification-per-transaction",
            "lines": [
                {"source_transfer_id": lot["id"], "quantity": 1, "weight": ".1"} for _ in range(4)
            ],
        },
    )
    assert response.status_code == 201
    assert len(response.json()["items"]) == 4
    rows = pending_rows()
    assert len(rows) == 1
    assert set(rows[0].payload["team_ids"]) == {warehouse["team"]["id"], warehouse["other"]["id"]}


def test_nested_flushes_merge_only_committed_scopes(client, monkeypatch):
    from app.models import Team, TeamPurpose

    with SessionLocal.begin() as db:
        teams = [Team(code=f"NESTED-{index}", name=f"班组 {index}") for index in range(3)]
        db.add_all(teams)
        db.flush()
        ids = [team.id for team in teams]
    client.drain_notifications()
    monkeypatch.setattr(app.state.notifications.transport, "ready", False)
    with SessionLocal.begin() as db:
        db.add(TeamPurpose(team_id=ids[0], name="外层"))
        db.flush()
        with db.begin_nested():
            db.add(TeamPurpose(team_id=ids[1], name="提交保存点"))
            db.flush()
        with db.begin_nested() as nested:
            db.add(TeamPurpose(team_id=ids[2], name="回滚保存点"))
            db.flush()
            nested.rollback()
    rows = pending_rows()
    assert len(rows) == 1
    assert set(rows[0].payload["team_ids"]) == set(ids[:2])


def test_commit_failure_after_outbox_insert_rolls_back_stock_and_notification(client, warehouse):  # noqa: F811
    from app.inventory_events import PENDING
    from sqlalchemy import event
    from sqlalchemy.orm import Session

    with SessionLocal() as db:
        before = db.scalar(select(func.count()).select_from(NotificationOutbox))

    def fail_after_staging(db):
        if db.info.get(PENDING):
            raise RuntimeError("simulated commit failure after staging")

    event.listen(Session, "before_commit", fail_after_staging)
    try:
        assert intake(client, warehouse).status_code == 500
    finally:
        event.remove(Session, "before_commit", fail_after_staging)
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(NotificationOutbox)) == before
        assert db.scalar(select(func.count()).select_from(MaterialStockBalance)) == 0


def test_broker_outage_keeps_committed_inventory_readable_and_notification_durable(
    client,
    warehouse,  # noqa: F811
    monkeypatch,
):
    monkeypatch.setattr(app.state.notifications.transport, "ready", False)
    publish = Mock(wraps=inventory_events.publish)
    monkeypatch.setattr(inventory_events, "publish", publish)
    result = intake(client, warehouse)
    assert result.status_code == 201
    publish.assert_not_called()
    assert len(pending_rows()) == 1
    balance = client.get(f"/api/team-materials/{warehouse['team']['id']}/overview").json()
    assert balance["totals"]["on_hand_quantity"] == 100
    health = client.get("/api/notifications/status").json()
    assert health["connection"] == "reconnecting" and health["pending"] == 1
    assert set(health) == {"connection", "pending", "oldest_pending_seconds"}
    assert client.get("/api/notifications/status", headers=warehouse["headers"]).status_code == 403
    assert client.get("/api/factory-overview/stream").status_code == 503
    assert (
        client.get(
            "/api/factory-overview/stream", headers={"Authorization": "Bearer bad"}
        ).status_code
        == 401
    )
    monkeypatch.setattr(app.state.notifications.transport, "ready", True)
    client.drain_notifications()
    publish.assert_called_once()
    assert not pending_rows()


def test_publisher_failure_retries_without_exposing_secrets_or_repeating_stock(
    client,
    warehouse,  # noqa: F811
    monkeypatch,
):
    monkeypatch.setattr(app.state.notifications.transport, "ready", False)
    lot = intake(client, warehouse).json()
    transport = Mock(
        ready=True, publish=AsyncMock(side_effect=RuntimeError("amqp://private-password"))
    )
    service = NotificationService(transport)
    assert asyncio.run(service.send_batch())
    failed = pending_rows()[0]
    assert (
        failed.attempts == 1 and failed.last_error == "RuntimeError" and failed.lease_owner is None
    )
    assert not asyncio.run(service.send_batch())  # Backoff, not a busy retry loop.
    monkeypatch.setattr(
        notification_queue, "utcnow", lambda: failed.available_at + timedelta(seconds=1)
    )
    transport.publish = AsyncMock()
    assert asyncio.run(service.send_batch())
    transport.publish.assert_awaited_once()
    assert not pending_rows()
    with SessionLocal() as db:
        assert db.get(MaterialStockBalance, lot["id"]).on_hand_quantity == 100
        done = db.get(NotificationOutbox, failed.id)
        assert done.attempts == 2 and done.published_at and done.last_error is None


def test_expired_lease_can_be_reclaimed_but_stale_owner_cannot_ack(client, warehouse, monkeypatch):  # noqa: F811
    monkeypatch.setattr(app.state.notifications.transport, "ready", False)
    intake(client, warehouse)
    with SessionLocal() as db:
        first = claim(db, "old-worker")
        assert len(first) == 1
        assert claim(db, "new-worker") == []
        future = utcnow() + timedelta(seconds=121)
        monkeypatch.setattr(notification_queue, "utcnow", lambda: future)
        second = claim(db, "new-worker")
        assert second[0][0] == first[0][0] and second[0][2] == 2
        complete(db, first[0][0], "old-worker", 1)
        assert len(pending_rows()) == 1
        complete(db, second[0][0], "new-worker", 2)
    assert not pending_rows()


def test_cancelled_publication_stays_pending_for_crash_recovery(client, warehouse, monkeypatch):  # noqa: F811
    monkeypatch.setattr(app.state.notifications.transport, "ready", False)
    intake(client, warehouse)

    async def run():
        entered = asyncio.Event()

        async def stalled(*_):
            entered.set()
            await asyncio.Event().wait()

        service = NotificationService(Mock(ready=True, publish=stalled))
        task = asyncio.create_task(service.send_batch())
        await asyncio.wait_for(entered.wait(), 2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        pending = pending_rows()
        assert len(pending) == 1 and pending[0].lease_owner == service.owner

    asyncio.run(run())


def test_duplicate_consumption_never_executes_business_writes(client, warehouse):  # noqa: F811
    lot = intake(client, warehouse).json()
    change = InventoryChange(team_ids=frozenset((warehouse["team"]["id"],)))
    inventory_events.publish(InventoryChange.from_envelope(change.envelope()))
    inventory_events.publish(InventoryChange.from_envelope(change.envelope()))
    with SessionLocal() as db:
        assert db.get(MaterialStockBalance, lot["id"]).on_hand_quantity == 100


def test_retention_never_deletes_pending_or_recent_messages(client):
    now = utcnow()
    with SessionLocal.begin() as db:
        for key, published in (
            ("old", now - timedelta(days=8)),
            ("recent", now),
            ("pending", None),
        ):
            db.add(
                NotificationOutbox(
                    id=key,
                    payload=InventoryChange().envelope(),
                    created_at=now - timedelta(days=8),
                    available_at=now,
                    attempts=1,
                    published_at=published,
                )
            )
    with SessionLocal() as db:
        assert prune_published(db) == 1
        assert db.get(NotificationOutbox, "old") is None
        assert db.get(NotificationOutbox, "recent") is not None
        assert db.get(NotificationOutbox, "pending") is not None


def test_outbox_rows_roll_back_with_business_writes(client, warehouse, monkeypatch):  # noqa: F811
    monkeypatch.setattr(app.state.notifications.transport, "ready", False)
    with SessionLocal() as db:
        before = db.scalar(select(func.count()).select_from(NotificationOutbox))
    monkeypatch.setattr(
        "app.warehouse_receipts.workflow._record_event",
        Mock(side_effect=RuntimeError("failed audit")),
    )
    assert intake(client, warehouse).status_code == 500
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(NotificationOutbox)) == before
        assert db.scalar(select(func.count()).select_from(MaterialStockBalance)) == 0


def test_maintenance_orm_writer_registers_outbox_without_importing_the_web_app(client):
    import subprocess
    import sys

    subprocess.run(
        [
            sys.executable,
            "-c",
            "from app.database import SessionLocal; "
            "from app.models import Team; "
            "db=SessionLocal(); db.add(Team(code='CLI-MQ', name='CLI队列验证')); "
            "db.commit(); db.close()",
        ],
        check=True,
    )
    assert len(pending_rows()) == 1


def test_existing_stream_closes_when_broker_disconnects(client, monkeypatch):
    async def run():
        token = client.headers["Authorization"].split(" ", 1)[1]
        stream = factory_stream.inventory_stream(
            LiveRequest(), HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
        )
        try:
            assert (await anext(stream)).startswith("event: inventory")
            monkeypatch.setattr(factory_stream, "HEARTBEAT_SECONDS", 0.01)
            monkeypatch.setattr(app.state.notifications.transport, "ready", False)
            with pytest.raises(StopAsyncIteration):
                await asyncio.wait_for(anext(stream), 1)
        finally:
            await stream.aclose()

    asyncio.run(run())


@pytest.mark.parametrize(
    "invalid",
    [
        None,
        {},
        {**InventoryChange().envelope(), "team_ids": [True]},
        {**InventoryChange().envelope(), "directory": 1},
        {**InventoryChange().envelope(), "sessions": [123]},
    ],
)
def test_invalid_message_envelopes_are_rejected(invalid):
    with pytest.raises(ValueError):
        InventoryChange.from_envelope(invalid)
