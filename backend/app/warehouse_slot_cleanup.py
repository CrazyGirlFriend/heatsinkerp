"""Reviewed, reversible cleanup of legacy multi-batch slot assignments only.

Preview: python -m app.warehouse_slot_cleanup --snapshot /secure/slots.json
Apply:   python -m app.warehouse_slot_cleanup --snapshot /secure/slots.json --apply
The snapshot is written exclusively before any changes. Stock and original
documents are never edited. A changed plan aborts instead of guessing.
"""

import argparse
import hashlib
import json
from pathlib import Path

from sqlalchemy import delete, select, update

from .database import SessionLocal
from .models import AdminAuditEvent, MaterialTransfer, Team, WarehouseLocation, WarehousePlacement
from .team_constants import WAREHOUSE_TEAM_CODE


def preview(db, *, locking=False):
    slot_query = (
        select(WarehouseLocation)
        .join(Team)
        .where(
            Team.code == WAREHOUSE_TEAM_CODE,
        )
        .order_by(WarehouseLocation.id)
    )
    slots = db.scalars(slot_query.with_for_update() if locking else slot_query).all()
    placement_query = select(WarehousePlacement, MaterialTransfer.batch_no, MaterialTransfer.status)
    placement_query = (
        placement_query.join(MaterialTransfer)
        .where(WarehousePlacement.location_id.in_([row.id for row in slots]))
        .order_by(WarehousePlacement.location_id, WarehousePlacement.transfer_id)
    )
    rows = db.execute(
        (placement_query.with_for_update() if locking else placement_query).execution_options(
            populate_existing=True
        )
    ).all()
    by_slot = {}
    for placement, batch_no, status in rows:
        by_slot.setdefault(placement.location_id, []).append(
            {
                "transfer_id": placement.transfer_id,
                "batch_no": batch_no,
                "status": status,
                "quantity": placement.quantity,
                "weight": str(placement.weight),
            }
        )
    plan = []
    for slot in slots:
        batches = by_slot.get(slot.id, [])
        if len(batches) > 1:
            # Retain the oldest received batch; an unsigned incoming batch is
            # retained only when there is no received material in this slot.
            batches.sort(key=lambda row: (row["status"] != "received", row["transfer_id"]))
            plan.append(
                {
                    "location_id": slot.id,
                    "name": slot.name,
                    "version": slot.version,
                    "keep": batches[0],
                    "unassign": batches[1:],
                }
            )
    return {"rule": "keep-oldest-received-batch", "locations": plan}


def digest(plan):
    return hashlib.sha256(json.dumps(plan, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def apply_plan(db, expected):
    """Caller owns transaction; lock lots before slots, like normal dispatch."""
    locations = expected["locations"]
    ids = sorted(
        {row["transfer_id"] for slot in locations for row in [slot["keep"], *slot["unassign"]]}
    )
    if ids:
        # Real write obtains SQLite's writer lock too, without changing data.
        table = MaterialTransfer.__table__
        db.connection().execute(
            update(table).where(table.c.id.in_(ids)).values(updated_at=table.c.updated_at)
        )
        db.execute(
            select(MaterialTransfer.id)
            .where(MaterialTransfer.id.in_(ids))
            .order_by(MaterialTransfer.id)
            .with_for_update()
        ).all()
    from .warehouse_locations import leased, lock_location

    locked = [lock_location(db, slot["location_id"]) for slot in locations]
    if any(leased(slot) for slot in locked):
        raise ValueError("仓位正在被表单使用，请稍后重新预览")
    db.execute(
        select(WarehousePlacement)
        .where(WarehousePlacement.location_id.in_([slot.id for slot in locked]))
        .with_for_update()
        .execution_options(populate_existing=True)
    ).all()
    actual = preview(db, locking=True)
    if digest(actual) != digest(expected):
        raise ValueError("仓位或库存已变化，请重新生成预览，未执行整理")
    for location, plan in zip(locked, locations, strict=True):
        db.execute(
            delete(WarehousePlacement).where(
                WarehousePlacement.location_id == location.id,
                WarehousePlacement.transfer_id.in_(
                    [row["transfer_id"] for row in plan["unassign"]]
                ),
            )
        )
        location.version += 1
        db.add(
            AdminAuditEvent(
                actor_user_id=0,
                actor="warehouse-slot-cleanup",
                target_type="warehouse_slot",
                target_id=location.id,
                action="unassigned",
                changes=plan,
            )
        )
    db.flush()  # Existing WarehouseLocation notification hook publishes the change.
    return {
        "locations": len(locations),
        "unassigned": sum(len(slot["unassign"]) for slot in locations),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", required=True, type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    # Register the same transaction notification hooks as API writes.
    from . import inventory_events  # noqa: F401

    with SessionLocal() as db, db.begin():
        if args.apply:
            snapshot = json.loads(args.snapshot.read_text())
            plan = snapshot["plan"]
            if snapshot["sha256"] != digest(plan):
                raise ValueError("快照校验失败")
            result = apply_plan(db, plan)
            print(json.dumps({"applied": result, "snapshot_sha256": snapshot["sha256"]}))
        else:
            plan = preview(db)
            # Never overwrite the only recovery copy.
            with args.snapshot.open("x", encoding="utf-8") as output:
                args.snapshot.chmod(0o600)
                json.dump(
                    {"sha256": digest(plan), "plan": plan}, output, ensure_ascii=False, indent=2
                )
            print(
                json.dumps(
                    {
                        "locations": len(plan["locations"]),
                        "unassigned": sum(len(slot["unassign"]) for slot in plan["locations"]),
                        "sha256": digest(plan),
                    },
                    ensure_ascii=False,
                )
            )


if __name__ == "__main__":
    main()
