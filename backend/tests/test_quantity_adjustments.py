from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.database import SessionLocal
from app.models import MaterialQuantityAdjustment, MaterialStockBalance, MaterialTransfer
from test_warehouse_receipts import warehouse, intake  # noqa: F401
from test_warehouse_classification import base, dispatch, confirm


def change(client, setup, lot, quantity, *, workshop=False, revision=None, key="pieces", **extra):
    url = base(setup, workshop)
    if revision is None:
        revision = client.get(f"{url}/stock/{lot['id']}/quantity-adjustments").json()["revision"]
    return client.post(url + "/quantity-adjustments", headers=setup["other_headers" if workshop else "headers"],
        json={"source_transfer_id": lot["id"], "quantity": quantity, "expected_revision": revision,
              "reason": "板材切割后按实数更新件数，重量不变", "idempotency_key": key, **extra})


def test_cutting_preserves_mass_and_signed_receipt_and_supports_chips(client, warehouse):
    s = warehouse
    origin = intake(client, s, quantity=10, weight=100).json()
    sent = dispatch(client, s, [{"source_transfer_id": origin["id"], "quantity": 10, "weight": 100}]).json()
    assert confirm(client, s, sent, workshop=True).status_code == 200
    lot = sent["items"][0]
    response = change(client, s, lot, 100, workshop=True)
    assert response.status_code == 201, response.text
    assert response.json()["delta_quantity"] == 90 and response.json()["weight"] == 100
    out = dispatch(client, s, [
        {"source_transfer_id": lot["id"], "quantity": 60, "weight": 57},
        {"source_transfer_id": lot["id"], "quantity": 0, "weight": 5, "material_type": "scrap_chips"},
    ], workshop=True, notes="切割废屑单独称重回库")
    assert out.status_code == 201, out.text
    with SessionLocal() as db:
        balance = db.get(MaterialStockBalance, lot["id"])
        assert (balance.received_quantity, balance.adjusted_quantity, balance.on_hand_quantity) == (10, 90, 40)
        assert balance.on_hand_weight == Decimal(38)
        assert balance.received_weight == balance.on_hand_weight + balance.reserved_weight
        signed = db.get(MaterialTransfer, lot["id"])
        assert signed.quantity == 10 and signed.weight == 100
    # Historical piece curve incorporates processing, not a fictitious intake.
    history = client.get(base(s, True) + "/serial-history", params={"serial_no": lot["serial_no"]}).json()
    assert history["lots"][0]["closing_quantity"] == 40
    assert history["lots"][0]["closing_weight"] == 38
    assert history["groups"][0]["incoming_quantity"] == 10
    assert any(event["kind"] == "quantity_changed" and event["delta_weight"] == 0 for event in history["groups"][0]["events"])
    assert confirm(client, s, out.json()).status_code == 200
    chip = out.json()["items"][1]
    assert chip["source_transfer_id"] == lot["id"] and chip["weight"] == 5


def test_idempotency_stale_version_and_weight_and_quantity_bounds(client, warehouse):
    s = warehouse
    lot = intake(client, s, quantity=10, weight=100).json()
    first = change(client, s, lot, 100, revision=0)
    assert first.status_code == 201, first.text
    assert change(client, s, lot, 100, revision=0).json() == first.json()
    assert change(client, s, lot, 120, revision=0).status_code == 409
    assert change(client, s, lot, 120, revision=0, key="stale").status_code == 409
    assert change(client, s, lot, 100, key="same").status_code == 422
    for q, w in [(101, 50), (20, 101)]:
        excess = dispatch(client, s, [{"source_transfer_id": lot["id"], "quantity": q, "weight": w}], idempotency_key=f'excess-{q}')
        assert excess.status_code == 201, excess.text
        assert client.delete('/api/material-transfers/' + excess.json()['items'][0]['batch_no'], headers=s['headers']).status_code == 204
    out = dispatch(client, s, [{"source_transfer_id": lot["id"], "quantity": 100, "weight": 100}]).json()
    assert change(client, s, lot, 20, key="exhausted").status_code == 409
    assert client.delete('/api/material-transfers/' + out['items'][0]['batch_no'], headers=s['headers']).status_code == 204
    assert change(client, s, lot, 20, key="after-void").status_code == 201
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(MaterialQuantityAdjustment)) == 2
        row = db.scalar(select(MaterialQuantityAdjustment))
        row.after_quantity = 7
        with pytest.raises(RuntimeError, match="append-only"):
            db.flush()
        db.rollback()


def test_only_bound_team_may_change_and_weight_only_stock_allowed(client, warehouse):
    s = warehouse
    lot = intake(client, s, quantity=0, weight=100).json()
    assert change(client, s, lot, 10, workshop=True, revision=0).status_code == 403
    assert client.post(base(s) + '/quantity-adjustments', json={"source_transfer_id": lot["id"],
        "quantity": 10, "expected_revision": 0, "reason": "切割", "idempotency_key": "admin"}).status_code == 403
    assert change(client, s, lot, 10).status_code == 201
    assert change(client, s, lot, 0, key="weight-only").status_code == 201
    assert change(client, s, lot, 9, key="blank", reason=" ").status_code == 422
    assert change(client, s, lot, 9, key="forged-weight", weight=200).status_code == 422


def test_first_response_uses_persisted_timestamp_precision(client, warehouse, monkeypatch):
    from datetime import datetime, timezone
    from sqlalchemy import event
    from app import quantity_adjustments

    lot = intake(client, warehouse, quantity=10, weight=100).json()
    monkeypatch.setattr(quantity_adjustments, "utcnow", lambda: datetime(2026, 9, 27, 1, 2, 3, 123456, tzinfo=timezone.utc))

    # Emulate a database storing DateTime with second precision, as MySQL does.
    def persist_seconds(mapper, connection, row):
        table = MaterialQuantityAdjustment.__table__
        connection.execute(table.update().where(table.c.id == row.id)
                           .values(created_at=row.created_at.replace(microsecond=0)))

    event.listen(MaterialQuantityAdjustment, "after_insert", persist_seconds)
    try:
        first = change(client, warehouse, lot, 100, revision=0)
    finally:
        event.remove(MaterialQuantityAdjustment, "after_insert", persist_seconds)
    assert first.status_code == 201, first.text
    assert change(client, warehouse, lot, 100, revision=0).json() == first.json()


def test_pending_stock_is_not_recounted_and_confirmation_invalidates_snapshot(client, warehouse):
    s = warehouse
    lot = intake(client, s, quantity=10, weight=100).json()
    out = dispatch(client, s, [{"source_transfer_id": lot["id"], "quantity": 4, "weight": 40}]).json()
    assert change(client, s, lot, 60).status_code == 201
    context = client.get(f"{base(s)}/stock/{lot['id']}/quantity-adjustments").json()
    assert context["weight"] == 60
    assert confirm(client, s, out, workshop=True).status_code == 200
    assert change(client, s, lot, 30, revision=context["revision"], key="raced").status_code == 409
    with SessionLocal() as db:
        balance = db.get(MaterialStockBalance, lot["id"])
        assert balance.on_hand_quantity == 60 and balance.dispatched_quantity == 4


def test_cumulative_receipts_include_returns_and_dispatch_excludes_voids(client, warehouse):
    s = warehouse
    origin = intake(client, s, quantity=30, weight=30).json()
    first = dispatch(client, s, [{"source_transfer_id": origin["id"], "quantity": 30, "weight": 30}]).json()
    assert confirm(client, s, first, workshop=True).status_code == 200
    back = dispatch(client, s, [{"source_transfer_id": first["items"][0]["id"], "quantity": 30, "weight": 30}], workshop=True).json()
    # Pending receipt is not included until actually signed by this team.
    before = client.get(base(s) + "/overview").json()["totals"]
    assert before["received_weight"] == 30
    assert confirm(client, s, back).status_code == 200
    after = client.get(base(s) + "/overview").json()["totals"]
    assert (after["received_weight"], after["dispatched_weight"], after["on_hand_weight"]) == (60, 30, 30)
    returned = back["items"][0]
    assert change(client, s, returned, 300).status_code == 201
    after = client.get(base(s) + "/overview").json()["totals"]
    assert after["received_quantity"] == 60 and after["received_weight"] == 60
    pending = dispatch(client, s, [{"source_transfer_id": returned["id"], "quantity": 10, "weight": 1}], idempotency_key="void-this").json()["items"][0]
    amounts = client.get(base(s) + "/overview").json()["totals"]
    assert amounts["dispatched_weight"] + amounts["reserved_weight"] == 31
    assert client.delete('/api/material-transfers/' + pending['batch_no'], headers=s['headers']).status_code == 204
    amounts = client.get(base(s) + "/overview").json()["totals"]
    assert amounts["dispatched_weight"] + amounts["reserved_weight"] == 30


def test_piece_changes_notify_once_and_rollback_atomically(client, warehouse, monkeypatch):
    from sqlalchemy import event
    from sqlalchemy.orm import Session
    from app.main import app
    from app.models import MaterialTransferEvent
    from test_notification_queue import pending_rows

    s = warehouse
    lot = intake(client, s, quantity=10, weight=100).json()
    monkeypatch.setattr(app.state.notifications.transport, "ready", False)

    def fail_commit(db):
        if db.info.get("inventory_changed_transactions"):
            raise RuntimeError("quantity transaction failed")

    event.listen(Session, "before_commit", fail_commit)
    try:
        assert change(client, s, lot, 100, revision=0).status_code == 500
    finally:
        event.remove(Session, "before_commit", fail_commit)
    with SessionLocal() as db:
        assert db.get(MaterialStockBalance, lot["id"]).on_hand_quantity == 10
        assert db.scalar(select(func.count()).select_from(MaterialQuantityAdjustment)) == 0
        assert db.scalar(select(func.count()).select_from(MaterialTransferEvent).where(MaterialTransferEvent.action == "quantity_changed")) == 0
    assert pending_rows() == []
    assert change(client, s, lot, 100, revision=0).status_code == 201
    assert change(client, s, lot, 100, revision=0).status_code == 201
    messages = pending_rows()
    assert len(messages) == 1
    assert messages[0].payload["team_ids"] == [s["team"]["id"]]
