"""Current serial stock, grouped by its physical team, without loading lineage."""

from datetime import timezone

from fastapi import HTTPException
from sqlalchemy import and_, case, func, literal, or_, select, union_all

from .inspections import hold_column
from .models import MaterialStockBalance, MaterialTransfer, SharedMaterialMember, Team, utcnow


def serial_predicate(serial):
    mt = MaterialTransfer
    return or_(
        and_(mt.serial_no == serial, mt.shared_unallocated.is_(False)),
        and_(
            mt.shared_unallocated.is_(True),
            mt.shared_group_id.in_(
                select(SharedMaterialMember.group_id).where(
                    SharedMaterialMember.serial_no == serial
                )
            ),
        ),
    )


def require_serial(db, serial):
    serial = serial.strip()
    if not serial:
        raise HTTPException(422, "请输入流水号")
    if not db.scalar(
        select(MaterialTransfer.id)
        .where(serial_predicate(serial), MaterialTransfer.status != "voided")
        .limit(1)
    ):
        raise HTTPException(404, "未找到该流水号")
    return serial


def inventory_rows(serial):
    mt, balance = MaterialTransfer, MaterialStockBalance
    metadata = (
        mt.id,
        mt.batch_no,
        func.coalesce(mt.material_name, "").label("material_name"),
        func.coalesce(mt.material_type, "").label("material_type"),
        mt.shared_unallocated,
        mt.transfer_specification,
        mt.rework_pending,
        mt.rework_count,
    )
    current = (
        select(
            *metadata,
            balance.team_id,
            balance.on_hand_quantity.label("quantity"),
            balance.on_hand_weight.label("weight"),
            literal("stock").label("location"),
        )
        .join(balance, balance.transfer_id == mt.id)
        .where(
            serial_predicate(serial),
            mt.status == "received",
            mt.stock_tracked.is_(True),
            or_(balance.on_hand_quantity != 0, balance.on_hand_weight != 0),
        )
    )
    incoming = select(
        *metadata,
        mt.next_team_id.label("team_id"),
        mt.quantity,
        mt.weight,
        literal("incoming").label("location"),
    ).where(
        serial_predicate(serial),
        mt.status == "pending",
        mt.entry_kind == "transfer",
        mt.next_team_id.is_not(None),
    )
    # Pending internal transfers belong to the receiving team's incoming column,
    # never to either team's on-hand column. External shipments have no receiver.
    return union_all(current, incoming).subquery()


def amounts(row):
    return {
        key: round(float(value or 0), 6) if key.endswith("weight") else value
        for key, value in row.items()
    }


def overview(db, serial):
    serial = require_serial(db, serial)
    rows = inventory_rows(serial)
    keys = (
        rows.c.team_id,
        Team.name.label("team_name"),
        rows.c.material_name,
        rows.c.material_type,
        rows.c.shared_unallocated,
    )
    aggregates = [
        func.sum(case((rows.c.location == location, rows.c[amount]), else_=0)).label(
            f"{location}_{amount}"
        )
        for location in ("stock", "incoming")
        for amount in ("quantity", "weight")
    ]
    data = db.execute(
        select(*keys, *aggregates)
        .join(Team, Team.id == rows.c.team_id)
        .group_by(*keys)
        .order_by(
            rows.c.team_id, rows.c.material_name, rows.c.material_type, rows.c.shared_unallocated
        )
    ).mappings()
    return {
        "serial_no": serial,
        "items": [amounts(dict(row)) for row in data],
        "untracked_count": db.scalar(
            select(func.count(MaterialTransfer.id)).where(
                serial_predicate(serial),
                MaterialTransfer.status == "received",
                MaterialTransfer.stock_tracked.is_(False),
            )
        ),
        "as_of": utcnow().replace(tzinfo=timezone.utc).isoformat(),
    }


def batches(
    db, serial, *, team_id, material_name, material_type, shared, location, page, page_size
):
    serial = require_serial(db, serial)
    rows = inventory_rows(serial)
    predicates = [
        rows.c.team_id == team_id,
        rows.c.material_name == material_name,
        rows.c.material_type == material_type,
        rows.c.shared_unallocated.is_(shared),
        rows.c.location == location,
    ]
    total = db.scalar(select(func.count()).select_from(rows).where(*predicates)) or 0
    data = db.execute(
        select(rows, hold_column(rows.c.id).label("inspection_hold_id"))
        .where(*predicates)
        .order_by(rows.c.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).mappings()
    return {
        "items": [amounts(dict(row)) for row in data],
        "total": total,
        "page": page,
        "page_size": page_size,
    }
