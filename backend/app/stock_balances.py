"""Transactional current balances; no history aggregation on business reads.

ORM flush hooks cover every ledger writer (including opening stock and seeding).
Only changed rows are compared; signed deltas update the affected source lots.
The SQL runs on the ledger transaction's connection, before commit notification.
Direct SQL maintenance must stop writers and reconcile/rebuild balances separately.
"""

from collections import defaultdict
from decimal import Decimal

from sqlalchemy import delete, event, func, select, update
from sqlalchemy.orm import Session

from .models import MaterialLoss, MaterialStockBalance, MaterialTransfer, utcnow

PREFIXES = ("received", "on_hand", "reserved", "in_transit", "dispatched", "lost")
AMOUNTS = tuple(f"{prefix}_{amount}" for prefix in PREFIXES for amount in ("quantity", "weight"))
FIELDS = {
    MaterialTransfer: (
        "id",
        "source_transfer_id",
        "next_team_id",
        "status",
        "stock_tracked",
        "entry_kind",
        "quantity",
        "weight",
    ),
    MaterialLoss: ("id", "source_transfer_id", "quantity", "weight"),
}
PENDING = "stock_balance_flush_changes"


def is_stock(row):
    return row is not None and row.get("status") == "received" and row.get("stock_tracked")


@event.listens_for(Session, "before_flush")
def remember_balances(db, *_):
    changes = []
    for model, fields in FIELDS.items():
        rows = [
            row
            for row in db.new | db.dirty | db.deleted
            if isinstance(row, model)
            and (
                row in db.new or row in db.deleted or db.is_modified(row, include_collections=False)
            )
        ]
        if not rows:
            continue
        ids = [row.id for row in rows if row not in db.new]
        table = model.__table__
        # Current/locking reads, not an earlier MySQL REPEATABLE READ snapshot.
        old = (
            {
                row.id: dict(row)
                for row in db.connection()
                .execute(
                    select(*(table.c[name] for name in fields))
                    .where(table.c.id.in_(ids))
                    .order_by(table.c.id)
                    .with_for_update()
                )
                .mappings()
            }
            if ids
            else {}
        )
        changes.extend((row, old.get(row.id), row in db.deleted) for row in rows)
    if changes:
        db.info[PENDING] = changes


def contribute(deltas, model, row, sign):
    if row is None:
        return

    def add(lot_id, prefix, direction=1):
        if lot_id is not None:
            deltas[lot_id][f"{prefix}_quantity"] += sign * direction * row["quantity"]
            deltas[lot_id][f"{prefix}_weight"] += sign * direction * Decimal(str(row["weight"]))

    if model is MaterialLoss:
        add(row["source_transfer_id"], "lost")
        add(row["source_transfer_id"], "on_hand", -1)
        return
    if is_stock(row):
        add(row["id"], "received")
        add(row["id"], "on_hand")
    if row["status"] == "pending":
        add(row["source_transfer_id"], "reserved")
        if row["entry_kind"] == "transfer":
            add(row["source_transfer_id"], "in_transit")
    elif row["status"] in ("received", "dispatched"):
        add(row["source_transfer_id"], "dispatched")
    if row["status"] in ("pending", "received", "dispatched"):
        add(row["source_transfer_id"], "on_hand", -1)


@event.listens_for(Session, "after_flush_postexec")
def apply_balances(db, *_):
    changes = db.info.pop(PENDING, ())
    if not changes:
        return
    deltas = defaultdict(lambda: {name: 0 for name in AMOUNTS})
    created, removed, teams = {}, set(), {}
    for row, before, deleted in changes:
        model = type(row)
        after = None if deleted else {name: getattr(row, name) for name in FIELDS[model]}
        contribute(deltas, model, before, -1)
        contribute(deltas, model, after, 1)
        if model is MaterialTransfer:
            if is_stock(after):
                teams[row.id] = after["next_team_id"]
                if not is_stock(before):
                    created[row.id] = after["next_team_id"]
            elif is_stock(before):
                removed.add(row.id)
    table = MaterialStockBalance.__table__
    connection = db.connection()
    if removed:
        connection.execute(delete(table).where(table.c.transfer_id.in_(removed)))
    for lot_id, delta in sorted(deltas.items()):
        if lot_id in removed:
            continue
        if lot_id in created:
            connection.execute(
                table.insert().values(
                    transfer_id=lot_id, team_id=created[lot_id], updated_at=utcnow(), **delta
                )
            )
            continue
        values = {
            name: func.round(table.c[name] + value, 3)
            if name.endswith("weight")
            else table.c[name] + value
            for name, value in delta.items()
            if value
        }
        if lot_id in teams:
            values["team_id"] = teams[lot_id]
        if values:
            result = connection.execute(
                update(table)
                .where(table.c.transfer_id == lot_id)
                .values(**values, updated_at=utcnow())
            )
            if result.rowcount != 1:
                raise RuntimeError(
                    f"Missing stock balance for lot {lot_id}; reconcile before writing"
                )


@event.listens_for(Session, "after_soft_rollback")
def discard_balances(db, *_):
    db.info.pop(PENDING, None)


@event.listens_for(Session, "do_orm_execute")
def reject_bulk_ledger_changes(state):
    # ORM bulk writes skip flush hooks. Maintenance uses explicitly scoped Core
    # statements; API/import writers must use normal ORM transactions instead.
    if state.is_update or state.is_delete or state.is_insert:
        if any(mapper.class_ in FIELDS for mapper in state.all_mappers):
            raise RuntimeError("Bulk ledger writes bypass stock balances; use ORM row transactions")
