"""Stock waiting clocks: receipt before processing, last work after processing."""

from sqlalchemy import case, func, select

from .models import MaterialQuantityAdjustment as Work
from .models import MaterialTransfer as Transfer


def stock_age_table(team_id=None):
    # Only real processing changes the clock. Quantity corrections and outbound
    # bookkeeping must not make an old batch appear newly processed.
    work = (
        select(
            Work.source_transfer_id.label("lot_id"),
            Work.team_id,
            func.max(Work.created_at).label("processed_at"),
        )
        .where(
            Work.processing_status.is_not(None),
            ~Work.idempotency_key.like("outbound-clear:%"),
            Work.team_id == team_id if team_id is not None else True,
        )
        .group_by(Work.source_transfer_id, Work.team_id)
        .subquery()
    )
    local_kinds = ("processing_output", "serial_reallocation", "rework_split")
    work_join = (work.c.lot_id == Transfer.id) & (work.c.team_id == Transfer.next_team_id)
    receipt = Transfer.received_at
    roots = (
        select(
            Transfer.id.label("transfer_id"),
            Transfer.next_team_id.label("team_id"),
            receipt.label("received_at"),
            case(
                (Transfer.rework_pending.is_(True), receipt),
                else_=func.coalesce(work.c.processed_at, receipt),
            ).label("started_at"),
            case(
                (Transfer.rework_pending.is_(True), "received"),
                (work.c.processed_at.is_not(None), "processed"),
                else_="received",
            ).label("basis"),
        )
        .outerjoin(work, work_join)
        .where(
            Transfer.status == "received",
            Transfer.stock_tracked.is_(True),
            Transfer.entry_kind.not_in(local_kinds),
            Transfer.next_team_id == team_id if team_id is not None else True,
        )
    )
    clock = roots.cte("inventory_age_clock", recursive=True)
    awaiting = Transfer.rework_pending.is_(True)
    unworked_output = (Transfer.entry_kind == "processing_output") & (
        Transfer.processing_role == "remaining"
    )
    worked_output = (Transfer.entry_kind == "processing_output") & (
        Transfer.processing_role.in_(("produced", "scrap"))
    )
    return clock.union_all(
        select(
            Transfer.id,
            clock.c.team_id,
            clock.c.received_at,
            case(
                (awaiting, clock.c.received_at),
                (work.c.processed_at.is_not(None), work.c.processed_at),
                (unworked_output, clock.c.received_at),
                (worked_output, Transfer.created_at),
                else_=clock.c.started_at,
            ),
            case(
                (awaiting, "received"),
                (work.c.processed_at.is_not(None), "processed"),
                (unworked_output, "received"),
                (worked_output, "processed"),
                else_=clock.c.basis,
            ),
        )
        .select_from(Transfer)
        .join(clock, Transfer.source_transfer_id == clock.c.transfer_id)
        .outerjoin(work, work_join)
        .where(
            Transfer.entry_kind.in_(local_kinds),
            Transfer.status == "received",
            Transfer.stock_tracked.is_(True),
            Transfer.next_team_id == clock.c.team_id,
            Transfer.source_team_id == clock.c.team_id,
        )
    )
