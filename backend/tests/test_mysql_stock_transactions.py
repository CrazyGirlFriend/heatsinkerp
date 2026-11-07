"""Real row locks, retry identity and atomic outbox on disposable MySQL only."""

from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier, local

import pytest
from app import material_stock as stock
from app import material_transfer_workflow as workflow
from app.database import SessionLocal, engine
from app.models import (
    MaterialDispatch,
    MaterialStockBalance,
    MaterialTransfer,
    MaterialTransferEvent,
    NotificationOutbox,
    User,
)
from sender_helpers import sending_employee_id
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload
from test_material_stock import receive_lot
from test_material_transfers import _setup_three_teams

pytestmark = [
    pytest.mark.skipif(engine.dialect.name != "mysql", reason="requires disposable MySQL"),
    pytest.mark.usefixtures("legacy_stock"),
]


def setup_stock(client):
    setup = _setup_three_teams(client)
    setup["stock_team_id"] = setup["target"]["id"]
    setup["stock_headers"] = setup["target_headers"]
    lot = receive_lot(client, setup)
    employee_id = sending_employee_id(client, setup["target_headers"])
    with SessionLocal() as db:
        user = db.scalar(
            select(User)
            .options(selectinload(User.team))
            .where(User.id == setup["target_user"]["id"])
        )
    return setup, lot, employee_id, user


def payload(setup, lot, employee_id, key, quantity):
    return stock.DispatchCreate(
        sent_employee_id=employee_id,
        next_team_id=setup["third"]["id"],
        idempotency_key=key,
        lines=[
            stock.DispatchLine(
                source_transfer_id=lot["id"],
                quantity=quantity,
                weight=Decimal(quantity) / 10,
                transfer_specification="100 × 80 × 5 mm",
            )
        ],
    )


def snapshot(lot):
    with SessionLocal() as db:
        balance = db.get(MaterialStockBalance, lot["id"])
        return {
            "quantity": balance.on_hand_quantity,
            "weight": balance.on_hand_weight,
            **{
                model.__tablename__: db.scalar(select(func.count()).select_from(model))
                for model in (
                    MaterialTransfer,
                    MaterialDispatch,
                    MaterialTransferEvent,
                    NotificationOutbox,
                )
            },
        }


def concurrent_dispatch(monkeypatch, setup, user, payloads):
    barrier, state = Barrier(2), local()
    lock = stock.lock_lot

    def synchronized_lock(*args, **kwargs):
        if not getattr(state, "entered", False):
            state.entered = True
            barrier.wait(timeout=15)
        return lock(*args, **kwargs)

    def submit(data):
        with SessionLocal() as db:
            return stock.create_dispatch(db, setup["stock_team_id"], data, user)

    monkeypatch.setattr(stock, "lock_lot", synchronized_lock)
    with ThreadPoolExecutor(max_workers=2) as pool:
        return list(pool.map(submit, payloads))


def test_mysql_concurrent_dispatches_keep_every_balance_delta(client, monkeypatch):
    setup, lot, employee_id, user = setup_stock(client)
    before = snapshot(lot)
    concurrent_dispatch(
        monkeypatch,
        setup,
        user,
        [
            payload(setup, lot, employee_id, "race-a", 40),
            payload(setup, lot, employee_id, "race-b", 30),
        ],
    )
    after = snapshot(lot)
    assert (after["quantity"], after["weight"]) == (30, Decimal("3"))
    for table in (
        "material_transfers",
        "material_dispatches",
        "material_transfer_events",
        "notification_outbox",
    ):
        assert after[table] - before[table] == 2


def test_mysql_concurrent_retry_creates_one_dispatch_and_one_outbox(client, monkeypatch):
    setup, lot, employee_id, user = setup_stock(client)
    before = snapshot(lot)
    data = payload(setup, lot, employee_id, "same-request", 40)
    results = concurrent_dispatch(monkeypatch, setup, user, [data, data])
    assert [item["batch_no"] for item in results[0]["items"]] == [
        item["batch_no"] for item in results[1]["items"]
    ]
    after = snapshot(lot)
    assert (after["quantity"], after["weight"]) == (60, Decimal("6"))
    for table in (
        "material_transfers",
        "material_dispatches",
        "material_transfer_events",
        "notification_outbox",
    ):
        assert after[table] - before[table] == 1


def test_mysql_failed_dispatch_rolls_back_balance_audit_and_outbox(client, monkeypatch):
    setup, lot, employee_id, user = setup_stock(client)
    before = snapshot(lot)
    record_event = workflow._record_event

    def fail_after_audit(db, *args, **kwargs):
        record_event(db, *args, **kwargs)
        db.flush()
        raise RuntimeError("injected audit failure")

    monkeypatch.setattr(workflow, "_record_event", fail_after_audit)
    with SessionLocal() as db, pytest.raises(RuntimeError, match="injected audit failure"):
        stock.create_dispatch(
            db, setup["stock_team_id"], payload(setup, lot, employee_id, "rollback", 40), user
        )
    assert snapshot(lot) == before
