"""Quality-adjusted delivery credit, separate from the physical transfer ledger."""

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from json import dumps

from sqlalchemy import (
    DateTime,
    case,
    cast,
    event,
    func,
    literal,
    literal_column,
    select,
    type_coerce,
)
from sqlalchemy.dialects.mysql import DATETIME
from sqlalchemy.orm import Session, lazyload

from .material_lineage import relatives
from .models import InspectionFeedbackTeam as Involved
from .models import MaterialInspection as Check
from .models import MaterialQuantityAdjustment as Work
from .models import MaterialTransfer as Lot
from .models import ProcessRoute as Route
from .models import ProductionScheduleDelivery as Delivery

OUTBOUND = {"transfer", "warehouse_outbound", "inspection_shipment"}
CACHE = "delivery_quality"


@dataclass
class Credit:
    rejected: int = 0
    pending: int = 0
    restored_at: datetime | None = None
    repeated: bool = False
    recoveries: list[tuple[datetime, int]] = field(default_factory=list)


@event.listens_for(Session, "after_flush_postexec")
@event.listens_for(Session, "after_transaction_end")
def clear_cache(db, *_):
    db.info.pop(CACHE, None)


def credits(db):
    # Several schedule/filter queries share a transaction. Never reuse a snapshot
    # after a write or across transactions (including a rolled-back savepoint).
    db.flush()
    if CACHE not in db.info:
        db.info[CACHE] = _credits(db)
    return db.info[CACHE]


def _credits(db):
    roots = list(
        db.scalars(
            select(Check)
            .options(lazyload("*"))
            .where(Check.kind == "inspection", Check.parent_id.is_(None), Check.failed_quantity > 0)
            .order_by(Check.checked_at, Check.id)
        )
    )
    if not roots:
        return {}
    root_ids = {c.source_transfer_id for c in roots}
    up = relatives(root_ids, ancestors=True, name="quality_credit_ancestors")
    down = relatives(root_ids, name="quality_credit_descendants")
    lots = {
        lot.id: lot
        for lot in db.execute(
            select(
                Lot.id,
                Lot.source_transfer_id,
                Lot.source_team_id,
                Lot.next_team_id,
                Lot.quantity,
                Lot.entry_kind,
                Lot.status,
                Lot.created_at,
            ).where(Lot.id.in_(select(up.c.id).union(select(down.c.id))))
        )
    }
    children, checks, involved = defaultdict(list), defaultdict(list), defaultdict(set)
    for lot in lots.values():
        if lot.status not in {"voided", "rejected"}:
            children[lot.source_transfer_id].append(lot)
    for row in db.scalars(
        select(Check)
        .options(lazyload("*"))
        .where(Check.source_transfer_id.in_(select(down.c.id)), Check.kind == "inspection")
    ):
        checks[row.source_transfer_id].append(row)
    for check_id, team_id in db.execute(
        select(Involved.inspection_id, Involved.team_id).where(
            Involved.inspection_id.in_([c.id for c in roots])
        )
    ):
        involved[check_id].add(team_id)
    works = list(
        db.scalars(
            select(Work)
            .options(lazyload("*"))
            .where(Work.source_transfer_id.in_(select(down.c.id)), Work.work_kind == "rework")
        )
    )
    routes = dict(
        db.execute(
            select(Route.id, Route.steps).where(Route.id.in_({w.process_route_id for w in works}))
        ).all()
    )
    finished = {
        output["id"]: work.created_at
        for work in works
        if work.process_step_index == len(routes.get(work.process_route_id) or []) - 1
        for output in work.outputs or []
        if output["role"] == "produced"
    }
    roots_by_lot = defaultdict(list)
    for check in roots:
        roots_by_lot[check.source_transfer_id].append(check)
    result, covered = {}, set()

    def add(lot_id, rejected, pending, recoveries):
        value = result.setdefault(lot_id, Credit())
        value.rejected += rejected
        value.pending += pending
        value.recoveries.extend(recoveries)

    def walk(lot, bad, since, repaired=None):
        if not bad:
            return 0, []
        covered.add(lot.id)
        exposure = bad
        if lot.entry_kind == "rework_split":
            repaired = None
        repaired = finished.get(lot.id, repaired)
        # An inspection of remaining stock cannot change earlier departed stock.
        branches = children[lot.id]
        remaining = max(0, lot.quantity - sum(c.quantity for c in branches if c.created_at < since))
        events = [
            (c.created_at, 0 if c.entry_kind == "rework_split" else 1, c.id, c)
            for c in branches
            if c.created_at >= since
        ]
        if repaired:
            events += [
                (c.checked_at, 2, c.id, c)
                for c in checks[lot.id]
                if (c.scope == "full" or c.failed_quantity) and c.checked_at >= max(since, repaired)
            ]
        pending, local_recoveries, branch_recoveries = 0, [], []
        for at, kind, _, item in sorted(events, key=lambda entry: entry[:3]):
            if kind == 2:
                # Passing a sample, closing an issue or finishing work is not a
                # full reinspection of the repaired quantity.
                failed = (
                    item.failed_quantity if item.scope == "full" else max(bad, item.failed_quantity)
                )
                after = min(exposure, remaining, failed)
                if after < bad:
                    local_recoveries.append((at, bad - after))
                elif after > bad:
                    revoke = after - bad
                    while revoke and local_recoveries:
                        passed_at, quantity = local_recoveries.pop()
                        removed = min(revoke, quantity)
                        revoke -= removed
                        if quantity > removed:
                            local_recoveries.append((passed_at, quantity - removed))
                bad = after
                continue
            amount = min(item.quantity, remaining)
            # Explicit rework isolates the rejected pieces. Otherwise qualified
            # pieces leave first, with rejected pieces retained in the remainder.
            share = (
                min(bad, amount)
                if item.entry_kind == "rework_split"
                else max(0, bad - (remaining - amount))
            )
            left, recovered = walk(item, share, at, repaired)
            if item.entry_kind in OUTBOUND:
                add(item.id, share, left, recovered)
            bad -= share
            remaining -= amount
            pending += left
            branch_recoveries.extend(recovered)
        return pending + bad, local_recoveries + branch_recoveries

    for check in roots:
        if check.source_transfer_id in covered:
            continue  # Rechecks/rework rounds of the same physical pieces are not new deductions.
        lot = lots[check.source_transfer_id]
        same_lot = roots_by_lot[lot.id]
        rejected = max(c.failed_quantity for c in checks[lot.id])
        teams = set().union(*(involved[c.id] for c in same_lot))
        pending, recoveries = walk(lot, rejected, check.checked_at)
        path, seen = [], set()
        current = lot
        while current and current.id not in seen:
            seen.add(current.id)
            if current.entry_kind in OUTBOUND:
                path.append(current)
            current = lots.get(current.source_transfer_id)
        # Use the closest preceding occurrence of each involved team. A repeated
        # team earlier in the route must not extend the deduction further upstream.
        borders = [
            next((i for i, row in enumerate(path) if row.source_team_id == team), -1)
            for team in teams
        ]
        for row in path[: max(borders, default=-1) + 1]:
            add(row.id, rejected, pending, recoveries)
    for lot_id, value in result.items():
        value.rejected = min(lots[lot_id].quantity, value.rejected)
        value.pending = min(value.rejected, value.pending)
        # Later defects of repaired pieces revoke earlier credit; the same piece
        # cannot produce more than one unit of current delivery credit.
        excess = max(0, sum(q for _, q in value.recoveries) - (value.rejected - value.pending))
        recoveries = []
        for passed_at, quantity in sorted(value.recoveries):
            removed = min(quantity, excess)
            excess -= removed
            if quantity > removed:
                recoveries.append((passed_at, quantity - removed))
        value.recoveries = recoveries
        value.restored_at = recoveries[-1][0] if recoveries else None
    deliveries = dict(
        db.execute(
            select(Delivery.transfer_id, Delivery.schedule_id).where(Delivery.transfer_id.in_(lots))
        ).all()
    )
    for lot_id, plan_id in deliveries.items():
        current, seen = lots.get(lots[lot_id].source_transfer_id), set()
        while current and current.id not in seen:
            seen.add(current.id)
            if deliveries.get(current.id) == plan_id and current.status != "voided":
                result.setdefault(lot_id, Credit()).repeated = True
                break
            current = lots.get(current.source_transfer_id)
    return result


def quantity_columns(db, transfer=Lot):
    values = credits(db)

    def column(field, default):
        groups = defaultdict(list)
        for key, value in values.items():
            if amount := getattr(value, field):
                groups[amount].append(key)
        branches = [(transfer.id.in_(ids), amount) for amount, ids in groups.items()]
        return case(*branches, else_=default) if branches else default

    repeated = column("repeated", literal(False))
    pending = case((repeated, 0), else_=column("pending", literal(0)))
    rejected = column("rejected", literal(0))
    restored = column("restored_at", literal(None, type_=DateTime))
    if db.get_bind().dialect.name == "mysql":
        # MySQL otherwise promotes CASE datetime bind values to VARCHAR, which
        # would turn the completion date returned by the UNION into a string.
        restored = cast(restored, DATETIME(fsp=6))
    effective = case((repeated, 0), else_=transfer.quantity - pending)
    original = case((repeated, 0), else_=transfer.quantity - rejected)
    return effective, original, restored, pending


def credit_events(db, deliveries, *, id_column="transfer_id", time_column="transferred_at"):
    """Credit repaired portions on their actual passing dates, before SQL paging.

    JSON_TABLE/json_each keeps this a bounded SQL statement even when many
    historical defects exist. Original transfer rows remain unchanged.
    """
    initial_at = deliveries.c[time_column]
    if "completion_basis" in deliveries.c:
        initial_at = case(
            (
                (deliveries.c.completion_basis == "weight")
                & (deliveries.c.restored_at > initial_at),
                deliveries.c.restored_at,
            ),
            else_=initial_at,
        )
    common = [c for c in deliveries.c if c.key not in ("quantity", time_column)]
    initial = select(
        *common, deliveries.c.original_quantity.label("quantity"), initial_at.label(time_column)
    )
    rows = [
        dict(transfer_id=key, quantity=quantity, passed_at=at.strftime("%Y-%m-%d %H:%M:%S.%f"))
        for key, value in credits(db).items()
        if not value.repeated
        for at, quantity in value.recoveries
    ]
    if not rows:
        return initial.subquery()
    if db.get_bind().dialect.name == "sqlite":
        entries = func.json_each(dumps(rows)).table_valued("value")
        transfer_id = func.json_extract(entries.c.value, "$.transfer_id")
        quantity = func.json_extract(entries.c.value, "$.quantity")
        passed_at = type_coerce(func.json_extract(entries.c.value, "$.passed_at"), DateTime)
    else:
        entries = func.json_table(
            dumps(rows),
            literal_column(
                "'$[*]' COLUMNS(transfer_id INT PATH '$.transfer_id', quantity INT PATH '$.quantity', "
                "passed_at DATETIME(6) PATH '$.passed_at')"
            ),
        ).table_valued("transfer_id", "quantity", "passed_at")
        transfer_id, quantity, passed_at = (
            entries.c.transfer_id,
            entries.c.quantity,
            entries.c.passed_at,
        )
    restored = (
        select(
            *[literal(0).label(c.key) if c.key == "weight" else c for c in common],
            quantity.label("quantity"),
            case(
                (passed_at > deliveries.c[time_column], passed_at), else_=deliveries.c[time_column]
            ).label(time_column),
        )
        .select_from(deliveries)
        .join(entries, transfer_id == deliveries.c[id_column])
    )
    return initial.union_all(restored).subquery()
