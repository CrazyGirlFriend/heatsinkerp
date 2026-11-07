"""Current team stock, counted once per physical lot and per actual serial."""

from datetime import timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import and_, case, func, or_, select

from .config import settings
from .models import (
    MaterialTransfer,
    ProductionSchedule,
    ProductionScheduleTask,
    SharedMaterialMember,
    Team,
    utcnow,
)
from .processing_records import registered_lots
from .schemas import SCRAP_MATERIAL_TYPES
from .team_constants import PROCESSING_TEAM_CODES


def work_order_summary(db, team, stock, *, now=None):
    """Distinct serials, not receipt batches or repeated processing registrations."""
    from .factory_performance import production_facts
    from .process_routes import local_work_pending
    from .production_schedule_queries import progress_table, status_expression
    from .record_filters import day_bounds
    from .team_constants import EXTERNAL_ENTRY_KINDS

    now = now or utcnow()
    today = now.replace(tzinfo=timezone.utc).astimezone(ZoneInfo(settings.factory_timezone)).date()
    starts = {
        "today": today,
        "week": today - timedelta(days=today.weekday()),
        "month": today.replace(day=1),
    }
    first = min(starts.values())
    processing = team.code in PROCESSING_TEAM_CODES
    registered = registered_lots(team.id)
    serial = case(
        (stock.c.shared_unallocated.is_(True), SharedMaterialMember.serial_no),
        else_=stock.c.serial_no,
    )
    pending = (
        or_(
            MaterialTransfer.rework_pending.is_(True),
            local_work_pending(),
            func.coalesce(registered.c.processing_status, "") != "complete",
        )
        if processing
        else True
    )
    current = db.execute(
        select(serial.label("serial_no"), case((pending, 1), else_=0).label("pending"))
        .select_from(stock)
        .join(MaterialTransfer, MaterialTransfer.id == stock.c.transfer_id)
        .outerjoin(registered, registered.c.lot_id == stock.c.transfer_id)
        .outerjoin(
            SharedMaterialMember,
            and_(
                stock.c.shared_unallocated.is_(True),
                SharedMaterialMember.group_id == stock.c.shared_group_id,
            ),
        )
        .where(
            or_(stock.c.on_hand_quantity > 0, stock.c.on_hand_weight > 0),
            ~func.coalesce(stock.c.material_type, "").in_(SCRAP_MATERIAL_TYPES),
        )
    )
    unfinished = {
        row.serial_no for row in current if row.pending and row.serial_no and row.serial_no.strip()
    }
    if processing:
        facts = production_facts(db, [team.id], [first, today])
        activity = list(db.execute(select(facts.c.serial_no, facts.c.processing_date).distinct()))
        completed = {}
        for number, day in activity:
            if number and number.strip() and number not in unfinished:
                completed[number] = max(completed.get(number, day), day)
        progress = progress_table(team_id=team.id)
        overdue = (
            db.scalar(
                select(func.count(func.distinct(ProductionSchedule.serial_no)))
                .join(
                    ProductionScheduleTask, ProductionScheduleTask.id == ProductionSchedule.task_id
                )
                .outerjoin(progress, progress.c.schedule_id == ProductionSchedule.id)
                .where(
                    ProductionSchedule.team_id == team.id,
                    ProductionScheduleTask.cancelled_at.is_(None),
                    status_expression(progress, now) == "overdue",
                )
            )
            or 0
        )
    else:
        # Warehouse handles receipts and dispatches; it does not register machining.
        transfer = MaterialTransfer
        sent = or_(
            and_(transfer.entry_kind == "transfer", transfer.status.in_(("pending", "received"))),
            and_(transfer.entry_kind.in_(EXTERNAL_ENTRY_KINDS), transfer.status == "dispatched"),
        )
        outgoing = and_(transfer.source_team_id == team.id, sent)
        incoming = and_(
            transfer.next_team_id == team.id,
            transfer.status == "received",
            transfer.entry_kind.not_in(
                ("processing_output", "rework_split", "serial_reallocation")
            ),
        )
        at = case(
            (
                outgoing,
                case(
                    (transfer.entry_kind == "transfer", transfer.created_at),
                    else_=transfer.dispatched_at,
                ),
            ),
            else_=transfer.received_at,
        )
        number = case(
            (transfer.shared_unallocated.is_(True), SharedMaterialMember.serial_no),
            else_=transfer.serial_no,
        )
        rows = db.execute(
            select(number, at, case((outgoing, 1), else_=0))
            .outerjoin(
                SharedMaterialMember,
                and_(
                    transfer.shared_unallocated.is_(True),
                    SharedMaterialMember.group_id == transfer.shared_group_id,
                ),
            )
            .where(
                or_(outgoing, incoming),
                at >= day_bounds(first)[0],
                at <= now,
                ~func.coalesce(transfer.material_type, "").in_(SCRAP_MATERIAL_TYPES),
            )
        )
        activity, completed = [], {}
        for number, timestamp, dispatched in rows:
            if not number or not number.strip():
                continue
            day = (
                timestamp.replace(tzinfo=timezone.utc)
                .astimezone(ZoneInfo(settings.factory_timezone))
                .date()
            )
            activity.append((number, day))
            if dispatched and number not in unfinished:
                completed[number] = max(completed.get(number, day), day)
        overdue = None  # Existing warehouse delivery commitments are not assessed.
    return {
        "mode": "processing" if processing else "handling",
        "in_progress_count": len(unfinished),
        "overdue_count": overdue,
        "periods": [
            {
                "key": key,
                "date_from": start,
                "date_to": today,
                "processed_count": len(
                    {
                        number
                        for number, day in activity
                        if number and number.strip() and start <= day <= today
                    }
                ),
                "completed_count": sum(start <= day <= today for day in completed.values()),
            }
            for key, start in starts.items()
        ],
    }


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
