"""Current team stock, counted once per physical lot and per actual serial."""

from sqlalchemy import case, func, or_, select

from .models import SharedMaterialMember
from .processing_records import registered_lots
from .schemas import SCRAP_MATERIAL_TYPES
from .team_constants import PROCESSING_TEAM_CODES


def current_stock_summary(db, team, stock):
    # Pending outbound is already deducted by the stock ledger. Do not count
    # historical receipts or multiply quantities by a shared lot's members.
    current = (
        select(stock)
        .where(or_(stock.c.on_hand_quantity > 0, stock.c.on_hand_weight > 0))
        .subquery()
    )
    numbered = select(current.c.serial_no).where(
        current.c.shared_unallocated.is_(False),
        func.trim(func.coalesce(current.c.serial_no, "")) != "",
    )
    shared = select(SharedMaterialMember.serial_no).join(
        current,
        (current.c.shared_group_id == SharedMaterialMember.group_id)
        & current.c.shared_unallocated.is_(True),
    )
    serials = numbered.union(shared).subquery()
    registered = registered_lots(team.id)
    status = case(
        (current.c.material_type.in_(SCRAP_MATERIAL_TYPES), "not_applicable"),
        (team.code not in PROCESSING_TEAM_CODES, "not_required"),
        (registered.c.processing_status == "complete", "complete"),
        (registered.c.processing_status == "partial", "partial"),
        (registered.c.processing_status == "unregistered", "unregistered"),
        (registered.c.latest_id.is_not(None), "registered"),
        else_="unregistered",
    )
    rows = db.execute(
        select(
            status.label("state"),
            func.count().label("batch_count"),
            func.sum(current.c.on_hand_quantity).label("quantity"),
            func.sum(current.c.on_hand_weight).label("weight"),
        )
        .select_from(current)
        .outerjoin(registered, registered.c.lot_id == current.c.transfer_id)
        .group_by(status)
    ).mappings()
    return {
        "serial_count": db.scalar(select(func.count()).select_from(serials)) or 0,
        "unnumbered_batch_count": db.scalar(
            select(func.count())
            .select_from(current)
            .where(
                current.c.shared_unallocated.is_(False),
                func.trim(func.coalesce(current.c.serial_no, "")) == "",
            )
        )
        or 0,
        "processing": [
            {
                "state": row["state"],
                "batch_count": row["batch_count"],
                "quantity": int(row["quantity"] or 0),
                "weight": round(float(row["weight"] or 0), 6),
            }
            for row in rows
        ],
    }
