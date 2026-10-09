"""Physical slot balances, updated inside the material ledger transaction.

Internal dispatch leaves immediately; external dispatch leaves when completed
(new submissions complete immediately, legacy pending orders on confirmation).
Reversed deductions return to unassigned stock, never to an old/reused slot.
The source lot lock serializes withdrawals, restores and manual placement.
"""

from decimal import Decimal

from sqlalchemy import delete, func, select, update

from .models import (
    MaterialLoss,
    MaterialQuantityAdjustment,
    MaterialTransfer,
    Team,
    WarehouseLocation,
    WarehousePlacement,
)
from .team_constants import WAREHOUSE_TEAM_CODE


def physical_out(row):
    if not row or row["source_transfer_id"] is None:
        return (0, Decimal(0))
    left = row["status"] in ("received", "dispatched") or (
        row["status"] == "pending" and row["entry_kind"] == "transfer"
    )
    return (row["quantity"], Decimal(str(row["weight"]))) if left else (0, Decimal(0))


def subtract(connection, withdrawals):
    totals = {}
    for lot_id, q, w in withdrawals:
        if lot_id is not None and (q or w):
            old_q, old_w = totals.get(lot_id, (0, Decimal(0)))
            totals[lot_id] = (old_q + q, old_w + w)
    if not totals:
        return
    table = WarehousePlacement.__table__
    rows = (
        connection.execute(
            select(table)
            .where(table.c.transfer_id.in_(totals))
            .order_by(table.c.transfer_id, table.c.location_id)
            .with_for_update()
        )
        .mappings()
        .all()
    )
    # Pick assigned stock first, then unassigned stock. Positive reversals are
    # intentionally not allocated. Never reconstruct positions from snapshots.
    for row in rows:
        lot_id = row["transfer_id"]
        quantity, weight = totals[lot_id]
        q, w = min(quantity, row["quantity"]), min(weight, row["weight"])
        if not q and not w:
            continue
        remaining_q, remaining_w = row["quantity"] - q, row["weight"] - w
        where = (table.c.transfer_id == lot_id, table.c.location_id == row["location_id"])
        if not remaining_q and not remaining_w:
            connection.execute(delete(table).where(*where))
        else:
            connection.execute(
                update(table).where(*where).values(quantity=remaining_q, weight=remaining_w)
            )
        totals[lot_id] = (quantity - q, weight - w)


def apply_changes(connection, changes, fields):
    warehouse_id = connection.scalar(select(Team.id).where(Team.code == WAREHOUSE_TEAM_CODE))
    if warehouse_id is None:
        return
    table = WarehousePlacement.__table__
    withdrawals = []
    for obj, before, deleted in changes:
        model = type(obj)
        after = None if deleted else {key: getattr(obj, key) for key in fields[model]}
        if model is MaterialTransfer:
            if (
                before
                and before["next_team_id"] == warehouse_id
                and (not after or after["status"] == "voided")
            ):
                connection.execute(delete(table).where(table.c.transfer_id == obj.id))
            elif (
                after
                and after["next_team_id"] == warehouse_id
                and after["status"] in ("pending", "received")
                and after["warehouse_location"]
            ):
                existing = (
                    connection.execute(
                        select(table).where(table.c.transfer_id == obj.id).with_for_update()
                    )
                    .mappings()
                    .all()
                )
                # Only arrival/first selection allocates stock. A later edit to
                # a received document must not put returned stock back in a slot.
                first = (
                    before is None or before["warehouse_location"] != after["warehouse_location"]
                )
                if first and existing:
                    connection.execute(delete(table).where(table.c.transfer_id == obj.id))
                    existing = []
                if first and not existing:
                    location_id = connection.scalar(
                        select(WarehouseLocation.id).where(
                            WarehouseLocation.team_id == warehouse_id,
                            WarehouseLocation.name == after["warehouse_location"],
                        )
                    )
                    if location_id is not None:
                        connection.execute(
                            table.insert().values(
                                location_id=location_id,
                                transfer_id=obj.id,
                                quantity=after["quantity"],
                                weight=after["weight"],
                            )
                        )
                elif existing and before and before["status"] == "pending":
                    connection.execute(
                        update(table)
                        .where(table.c.transfer_id == obj.id)
                        .values(quantity=after["quantity"], weight=after["weight"])
                    )
            if (after or before)["source_team_id"] == warehouse_id:
                old_q, old_w = physical_out(before)
                new_q, new_w = physical_out(after)
                withdrawals.append(
                    (
                        (after or before)["source_transfer_id"],
                        max(0, new_q - old_q),
                        max(Decimal(0), new_w - old_w),
                    )
                )
        elif model is MaterialLoss and (after or before)["team_id"] == warehouse_id:
            old_q, old_w = (before["quantity"], before["weight"]) if before else (0, Decimal(0))
            new_q, new_w = (after["quantity"], after["weight"]) if after else (0, Decimal(0))
            withdrawals.append(
                (
                    (after or before)["source_transfer_id"],
                    max(0, new_q - old_q),
                    max(Decimal(0), new_w - old_w),
                )
            )
        elif model is MaterialQuantityAdjustment and after:
            # Quantity-only correction: no inferred weight or location for added pieces.
            withdrawals.append(
                (
                    after["source_transfer_id"],
                    max(0, after["before_quantity"] - after["after_quantity"]),
                    Decimal(0),
                )
            )
    subtract(connection, withdrawals)


def allocation_table():
    p = WarehousePlacement
    return (
        select(
            p.transfer_id,
            func.sum(p.quantity).label("quantity"),
            func.sum(p.weight).label("weight"),
        )
        .group_by(p.transfer_id)
        .subquery()
    )


def unassigned_predicate(stock):
    allocated = allocation_table()
    quantity = (
        select(allocated.c.quantity)
        .where(allocated.c.transfer_id == stock.c.transfer_id)
        .scalar_subquery()
    )
    weight = (
        select(allocated.c.weight)
        .where(allocated.c.transfer_id == stock.c.transfer_id)
        .scalar_subquery()
    )
    from sqlalchemy import or_

    return or_(
        stock.c.on_hand_quantity + stock.c.external_pending_quantity > func.coalesce(quantity, 0),
        stock.c.on_hand_weight + stock.c.external_pending_weight > func.coalesce(weight, 0),
    )


def stock_positions(db, items):
    """Decorate lot lists once per page, without changing inventory ownership."""
    warehouse_items = [
        item for item in items if item["transfer"]["next_team"]["code"] == WAREHOUSE_TEAM_CODE
    ]
    mapping = positions(db, [item["transfer"]["id"] for item in warehouse_items])
    for item in warehouse_items:
        rows = mapping.get(item["transfer"]["id"], [])
        item["warehouse_positions"] = rows
        for unit in ("quantity", "weight"):
            physical = item["on_hand_" + unit] + item["external_pending_" + unit]
            item["physical_" + unit] = physical
            item["unassigned_" + unit] = round(max(0, physical - sum(row[unit] for row in rows)), 6)
    return items


def positions(db, lot_ids):
    if not lot_ids:
        return {}
    p, loc = WarehousePlacement, WarehouseLocation
    rows = db.execute(
        select(p.transfer_id, p.location_id, loc.name, p.quantity, p.weight)
        .join(loc, loc.id == p.location_id)
        .where(p.transfer_id.in_(lot_ids))
        .order_by(p.location_id)
    ).mappings()
    result = {}
    for row in rows:
        result.setdefault(row["transfer_id"], []).append(
            {
                "location_id": row["location_id"],
                "name": row["name"],
                "quantity": row["quantity"],
                "weight": float(row["weight"]),
            }
        )
    return result
