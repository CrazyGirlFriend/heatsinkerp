"""Stock residence starts at receipt into the current team, including derived lots."""

from sqlalchemy import literal, select

from .models import MaterialTransfer as Transfer


def stock_age_table(team_id=None):
    # Processing, splitting and reallocating within a team preserve its receipt clock.
    local_kinds = ("processing_output", "serial_reallocation", "rework_split")
    roots = (
        select(
            Transfer.id.label("transfer_id"),
            Transfer.next_team_id.label("team_id"),
            Transfer.received_at.label("started_at"),
            literal("received").label("basis"),
        )
        .where(
            Transfer.status == "received",
            Transfer.stock_tracked.is_(True),
            Transfer.entry_kind.not_in(local_kinds),
            Transfer.next_team_id == team_id if team_id is not None else True,
        )
    )
    clock = roots.cte("inventory_age_clock", recursive=True)
    return clock.union_all(
        select(
            Transfer.id,
            clock.c.team_id,
            clock.c.started_at,
            clock.c.basis,
        )
        .select_from(Transfer)
        .join(clock, Transfer.source_transfer_id == clock.c.transfer_id)
        .where(
            Transfer.entry_kind.in_(local_kinds),
            Transfer.status == "received",
            Transfer.stock_tracked.is_(True),
            Transfer.next_team_id == clock.c.team_id,
            Transfer.source_team_id == clock.c.team_id,
        )
    )
