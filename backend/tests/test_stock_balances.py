"""Durable current balances must exactly match the independently read ledger."""

import importlib.util
from decimal import Decimal
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import delete, select, update

from app.database import SessionLocal, engine
from app.material_stock import stock_table
from app.models import MaterialLoss, MaterialStockBalance, MaterialTransfer
from test_warehouse_classification import confirm, dispatch
from test_warehouse_receipts import intake, warehouse  # noqa: F401


def reconcile():
    with SessionLocal() as db:
        transfers = db.execute(
            select(
                MaterialTransfer.id,
                MaterialTransfer.source_transfer_id,
                MaterialTransfer.next_team_id,
                MaterialTransfer.status,
                MaterialTransfer.stock_tracked,
                MaterialTransfer.entry_kind,
                MaterialTransfer.quantity,
                MaterialTransfer.weight,
            )
        ).all()
        losses = db.execute(
            select(MaterialLoss.source_transfer_id, MaterialLoss.quantity, MaterialLoss.weight)
        ).all()
        saved = {row.transfer_id: row for row in db.scalars(select(MaterialStockBalance))}
        assert set(saved) == {
            row.id for row in transfers if row.status == "received" and row.stock_tracked
        }
        for lot_id, balance in saved.items():
            lot = next(row for row in transfers if row.id == lot_id)
            assert balance.team_id == lot.next_team_id
            outgoing = [row for row in transfers if row.source_transfer_id == lot_id]
            categories = {
                "received": [lot],
                "reserved": [row for row in outgoing if row.status == "pending"],
                "in_transit": [
                    row
                    for row in outgoing
                    if row.status == "pending" and row.entry_kind == "transfer"
                ],
                "dispatched": [row for row in outgoing if row.status in ("received", "dispatched")],
                "lost": [row for row in losses if row.source_transfer_id == lot_id],
            }
            for amount in ("quantity", "weight"):
                sums = {
                    key: sum((getattr(row, amount) for row in rows), Decimal(0))
                    for key, rows in categories.items()
                }
                sums["on_hand"] = (
                    sums["received"] - sums["reserved"] - sums["dispatched"] - sums["lost"]
                )
                for key, value in sums.items():
                    assert getattr(balance, f"{key}_{amount}") == value, (lot_id, key, amount)
        return {lot_id: (row.on_hand_quantity, row.on_hand_weight) for lot_id, row in saved.items()}


def test_balances_follow_split_edit_receive_void_loss_and_idempotency(client, warehouse):  # noqa: F811
    origin = intake(client, warehouse).json()
    first = dispatch(
        client, warehouse, [{"source_transfer_id": origin["id"], "quantity": 30, "weight": "3.125"}]
    ).json()
    batch = first["items"][0]
    assert reconcile()[origin["id"]] == (70, Decimal("7"))
    edited = client.patch(
        "/api/material-transfers/" + batch["batch_no"],
        headers=warehouse["headers"],
        json={"quantity": 40, "weight": "4.125", "expected_version": batch["version"]},
    )
    assert edited.status_code == 200, edited.text
    assert reconcile()[origin["id"]] == (60, Decimal("6"))
    first["items"][0] = edited.json()
    received = confirm(client, warehouse, first, workshop=True)
    assert received.status_code == 200, received.text
    assert reconcile() == {origin["id"]: (60, Decimal("6")), batch["id"]: (40, Decimal("4.125"))}
    second = dispatch(
        client,
        warehouse,
        [{"source_transfer_id": origin["id"], "quantity": 10, "weight": ".001"}],
        idempotency_key="balance-second",
    ).json()
    assert reconcile()[origin["id"]] == (50, Decimal("5.999"))
    assert (
        client.delete(
            "/api/material-transfers/" + second["items"][0]["batch_no"],
            headers=warehouse["headers"],
        ).status_code
        == 204
    )
    assert reconcile()[origin["id"]] == (60, Decimal("6"))
    payload = {
        "source_transfer_id": origin["id"],
        "quantity": 1,
        "weight": ".001",
        "reason": "清点",
        "idempotency_key": "balance-loss",
    }
    for _ in range(2):
        assert (
            client.post(
                f"/api/team-materials/{warehouse['team']['id']}/losses",
                headers=warehouse["headers"],
                json=payload,
            ).status_code
            == 201
        )
    assert reconcile()[origin["id"]] == (59, Decimal("5.999"))


def test_rollback_and_savepoint_do_not_leave_balance_deltas(client, warehouse):  # noqa: F811
    lot = intake(client, warehouse).json()
    before = reconcile()
    with SessionLocal() as db:
        row = db.get(MaterialTransfer, lot["id"])
        row.quantity = 120
        db.flush()
        assert db.get(MaterialStockBalance, row.id).on_hand_quantity == 120
        db.rollback()
    assert reconcile() == before
    with SessionLocal.begin() as db:
        row = db.get(MaterialTransfer, lot["id"])
        nested = db.begin_nested()
        row.quantity = 120
        db.flush()
        nested.rollback()
        row.quantity = 110
    assert reconcile()[lot["id"]][0] == 110


def test_bulk_orm_updates_are_rejected_and_reads_never_reaggregate_history(client, warehouse):  # noqa: F811
    lot = intake(client, warehouse).json()
    with SessionLocal() as db, pytest.raises(RuntimeError, match="Bulk ledger"):
        db.execute(
            update(MaterialTransfer).where(MaterialTransfer.id == lot["id"]).values(quantity=999)
        )
    query = str(select(stock_table(warehouse["team"]["id"])))
    assert "material_stock_balances" in query
    assert "material_losses" not in query and "GROUP BY" not in query
    assert reconcile()[lot["id"]][0] == 100


def test_backfill_is_repeatable_and_refuses_a_mismatch(client, warehouse):  # noqa: F811
    lot = intake(client, warehouse).json()
    dispatch(
        client, warehouse, [{"source_transfer_id": lot["id"], "quantity": 7, "weight": ".125"}]
    )
    before = reconcile()
    path = Path(__file__).parents[1] / "alembic/versions/20260923_0017_stock_balances.py"
    spec = importlib.util.spec_from_file_location("stock_balance_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    with engine.begin() as connection:
        connection.execute(delete(MaterialStockBalance.__table__))
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            migration.upgrade()
    assert reconcile() == before
    with engine.begin() as connection:
        connection.execute(
            update(MaterialStockBalance.__table__).values(
                received_quantity=101, on_hand_quantity=94
            )
        )
        with (
            Operations.context(MigrationContext.configure(connection)),
            pytest.raises(RuntimeError, match="reconciliation failed"),
        ):
            migration.upgrade()
