"""Current team stock, counted once per physical lot and per actual serial."""

from sqlalchemy import case, func, or_, select

from .models import SharedMaterialMember, Team
from .processing_records import registered_lots
from .schemas import SCRAP_MATERIAL_TYPES
from .team_constants import PROCESSING_TEAM_CODES


def stock_processing_totals(db, stock):
    """Group physical remaining stock with the same states used in team inventory."""
    registered = registered_lots(None)
    status = case(
        (stock.c.material_type.in_(SCRAP_MATERIAL_TYPES), "not_applicable"),
        (~Team.code.in_(PROCESSING_TEAM_CODES), "not_required"),
        (registered.c.rework_pending.is_(True), "rework"),
        (registered.c.processing_status == "complete", "complete"),
        (registered.c.processing_status == "partial", "partial"),
        (registered.c.processing_status == "unregistered", "unregistered"),
        (registered.c.latest_id.is_not(None), "registered"),
        else_="unregistered",
    )
    rows = db.execute(
        select(
            stock.c.team_id,
            status.label("state"),
            func.count().label("batch_count"),
            func.sum(stock.c.on_hand_quantity).label("quantity"),
            func.sum(stock.c.on_hand_weight).label("weight"),
        )
        .select_from(stock)
        .join(Team, Team.id == stock.c.team_id)
        .outerjoin(registered, registered.c.lot_id == stock.c.transfer_id)
        .where(or_(stock.c.on_hand_quantity > 0, stock.c.on_hand_weight > 0))
        .group_by(stock.c.team_id, status)
    ).mappings()
    result = {}
    for row in rows:
        result.setdefault(row["team_id"], []).append(
            {
                "state": row["state"],
                "batch_count": row["batch_count"],
                "quantity": int(row["quantity"] or 0),
                "weight": round(float(row["weight"] or 0), 6),
            }
        )
    return result


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
        "processing": stock_processing_totals(db, current).get(team.id, []),
    }
