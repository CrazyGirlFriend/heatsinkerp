"""Delivery progress and physical-lot queries shared by scheduling views."""

from datetime import datetime, time, timedelta, timezone

from sqlalchemy import and_, case, func, or_, select, union

from .models import (
    MaterialStockBalance as Balance,
)
from .models import (
    MaterialTransfer as Transfer,
)
from .models import (
    ProductionSchedule as Plan,
)
from .models import (
    ProductionScheduleBatch as Batch,
)
from .models import (
    ProductionScheduleDelivery as Delivery,
)
from .models import (
    ProductionScheduleSource as Source,
)
from .models import (
    SharedMaterialMember,
    Team,
)
from .team_constants import WAREHOUSE_TEAM_CODE

# Defective workpieces can still be scheduled for an explicitly chosen disposition.
EXCLUDED_MATERIAL_TYPES = ("waste", "sludge", "scrap_chips")
LOCAL_ZONE = timezone(timedelta(hours=8))


def iso(value):
    return value.replace(tzinfo=timezone.utc).isoformat() if value else None


def progress_table(*, plan_ids=None, team_id=None, batches=False, include_warehouse=False):
    """SQL aggregation precedes filtering/paging; cancelled transfers never fulfill."""
    transferred_at = case(
        (Transfer.entry_kind == "transfer", Transfer.created_at), else_=Transfer.dispatched_at
    )
    scope = []
    if plan_ids is not None:
        scope.append(Plan.id.in_(plan_ids))
    if team_id is not None:
        scope.append(Plan.team_id == team_id)
    warehouse = Plan.team_id.in_(select(Team.id).where(Team.code == WAREHOUSE_TEAM_CODE))
    key = Delivery.schedule_batch_id if batches else Delivery.schedule_id
    target = Batch if batches else Plan
    actual = (
        select(
            key.label("schedule_id"),
            (~warehouse).label("assessed"),
            Transfer.id.label("transfer_id"),
            Transfer.quantity,
            Transfer.weight,
            transferred_at.label("transferred_at"),
            case((Transfer.status == "received", Transfer.quantity), else_=0).label(
                "received_quantity"
            ),
            case((Transfer.status == "received", Transfer.weight), else_=0).label(
                "received_weight"
            ),
            target.target_quantity,
            target.target_weight,
            Plan.completion_basis,
            func.sum(Transfer.quantity)
            .over(
                partition_by=key,
                order_by=(transferred_at, Transfer.id),
                rows=(None, 0),
            )
            .label("running_quantity"),
            func.sum(Transfer.weight)
            .over(
                partition_by=key,
                order_by=(transferred_at, Transfer.id),
                rows=(None, 0),
            )
            .label("running_weight"),
        )
        .join(Transfer, Transfer.id == Delivery.transfer_id)
        .join(Plan, Plan.id == Delivery.schedule_id)
        .where(
            *scope,
            Transfer.serial_no == Plan.serial_no,
            Transfer.source_team_id == Plan.team_id,
            Transfer.next_team_id.is_not_distinct_from(Plan.next_team_id),
            Transfer.external_destination.is_not_distinct_from(Plan.external_destination),
            # Snapshot the processing state at dispatch, not the source's later state.
            # A produced child of a partially processed batch is already complete.
            or_(warehouse, Transfer.sent_processing_status == "complete"),
            or_(
                Plan.process_route_id.is_(None),
                and_(
                    Transfer.process_route_id == Plan.process_route_id,
                    Transfer.sent_process_step_index == Plan.process_step_index,
                ),
            ),
            or_(
                Transfer.material_type.is_(None),
                Transfer.material_type.not_in(EXCLUDED_MATERIAL_TYPES),
            ),
            or_(
                and_(
                    Transfer.entry_kind == "transfer", Transfer.status.in_(("pending", "received"))
                ),
                and_(
                    Transfer.entry_kind.in_(("warehouse_outbound", "inspection_shipment")),
                    Transfer.status == "dispatched",
                    Transfer.dispatched_at.is_not(None),
                ),
            ),
        )
    )
    if batches:
        actual = actual.join(Batch, Batch.id == Delivery.schedule_batch_id)
    actual = actual.subquery("batch_actual_deliveries" if batches else "schedule_actual_deliveries")
    reached = and_(
        True if include_warehouse else actual.c.assessed,
        or_(
            actual.c.completion_basis == "weight",
            actual.c.running_quantity >= actual.c.target_quantity,
        ),
        or_(
            actual.c.completion_basis == "quantity",
            actual.c.running_weight >= actual.c.target_weight,
        ),
    )
    totals = (
        select(
            actual.c.schedule_id,
            func.sum(actual.c.quantity).label("dispatched_quantity"),
            func.sum(actual.c.weight).label("dispatched_weight"),
            func.sum(actual.c.received_quantity).label("received_quantity"),
            func.sum(actual.c.received_weight).label("received_weight"),
            func.min(case((reached, actual.c.transferred_at), else_=None)).label("completed_at"),
        )
        .group_by(actual.c.schedule_id)
        .subquery("batch_progress" if batches else "schedule_totals")
    )
    if batches:
        return totals
    batch_progress = progress_table(
        plan_ids=plan_ids, team_id=team_id, batches=True, include_warehouse=include_warehouse
    )
    batch_completion = (
        select(
            Batch.schedule_id,
            case(
                (
                    func.count(batch_progress.c.completed_at) == func.count(Batch.id),
                    func.max(batch_progress.c.completed_at),
                ),
                else_=None,
            ).label("completed_at"),
        )
        .outerjoin(batch_progress, batch_progress.c.schedule_id == Batch.id)
        .group_by(Batch.schedule_id)
    )
    if plan_ids is not None:
        batch_completion = batch_completion.where(Batch.schedule_id.in_(plan_ids))
    batch_completion = batch_completion.subquery("schedule_batch_completion")
    # An over-delivered batch never settles another batch's unfulfilled commitment.
    return (
        select(
            *[c for c in totals.c if c.key != "completed_at"],
            case(
                (batch_completion.c.schedule_id.is_not(None), batch_completion.c.completed_at),
                else_=totals.c.completed_at,
            ).label("completed_at"),
        )
        .outerjoin(batch_completion, batch_completion.c.schedule_id == totals.c.schedule_id)
        .subquery("schedule_progress")
    )


def status_expression(progress, now, *, include_warehouse=False):
    local = now.replace(tzinfo=timezone.utc).astimezone(LOCAL_ZONE)
    end_today = datetime.combine(local.date() + timedelta(days=1), time(), LOCAL_ZONE)
    end_today = end_today.astimezone(timezone.utc).replace(tzinfo=None)
    batches = progress_table(batches=True, include_warehouse=include_warehouse)

    def batch_matches(condition):
        return (
            select(Batch.id)
            .outerjoin(batches, batches.c.schedule_id == Batch.id)
            .where(Batch.schedule_id == Plan.id, condition)
            .exists()
        )

    late_batch = batch_matches(
        and_(batches.c.completed_at.is_not(None), batches.c.completed_at > Batch.due_at)
    )
    overdue_batch = batch_matches(and_(batches.c.completed_at.is_(None), Batch.due_at < now))
    today_batch = batch_matches(and_(batches.c.completed_at.is_(None), Batch.due_at < end_today))
    return case(
        (Plan.cancelled_at.is_not(None), "cancelled"),
        (
            and_(
                not include_warehouse,
                Plan.team_id.in_(select(Team.id).where(Team.code == WAREHOUSE_TEAM_CODE)),
            ),
            "not_assessed",
        ),
        (
            and_(
                progress.c.completed_at.is_not(None),
                or_(progress.c.completed_at > Plan.due_at, late_batch),
            ),
            "completed_late",
        ),
        (progress.c.completed_at.is_not(None), "completed"),
        (and_(Plan.planning_state.in_(("pending", "submitted")), ~batch_matches(True)), "pending"),
        (or_(Plan.due_at < now, overdue_batch), "overdue"),
        (or_(Plan.due_at < end_today, today_batch), "today"),
        else_="pending",
    )


def shared_order_lot():
    return and_(
        Transfer.shared_unallocated.is_(True),
        select(SharedMaterialMember.id)
        .where(
            SharedMaterialMember.group_id == Transfer.shared_group_id,
            SharedMaterialMember.serial_no == Plan.serial_no,
        )
        .correlate(Transfer, Plan)
        .exists(),
    )


def linked_lots(ids):
    direct = select(Source.schedule_id, Source.source_transfer_id).where(
        Source.schedule_id.in_(ids)
    )
    inherited = (
        select(Plan.id.label("schedule_id"), Delivery.transfer_id.label("source_transfer_id"))
        .join(Delivery, Delivery.schedule_id == Plan.predecessor_id)
        .where(Plan.id.in_(ids))
    )
    routed = (
        select(Plan.id.label("schedule_id"), Transfer.id.label("source_transfer_id"))
        .join(Transfer, Transfer.process_route_id == Plan.process_route_id)
        .where(
            Plan.id.in_(ids),
            Plan.process_route_id.is_not(None),
            Transfer.next_team_id == Plan.team_id,
            Transfer.process_step_index == Plan.process_step_index,
            or_(Transfer.serial_no == Plan.serial_no, shared_order_lot()),
        )
    )
    return union(direct, inherited, routed).subquery()


def execution_lots(ids):
    """Follow local physical outputs; never jump across serials or team receipts."""
    links = linked_lots(ids)
    lots = (
        select(links.c.schedule_id, Transfer.id.label("lot_id"), Plan.team_id, Plan.serial_no)
        .join(Transfer, Transfer.id == links.c.source_transfer_id)
        .join(Plan, Plan.id == links.c.schedule_id)
        .where(
            Transfer.next_team_id == Plan.team_id,
            or_(
                Transfer.serial_no == Plan.serial_no,
                and_(
                    Plan.process_route_id == Transfer.process_route_id,
                    shared_order_lot(),
                ),
            ),
        )
        .cte("schedule_execution_lots", recursive=True)
    )
    lots = lots.union(
        select(lots.c.schedule_id, Transfer.id, lots.c.team_id, lots.c.serial_no)
        .join(Transfer, Transfer.source_transfer_id == lots.c.lot_id)
        .where(
            Transfer.entry_kind.in_(("processing_output", "serial_reallocation")),
            Transfer.source_team_id == lots.c.team_id,
            Transfer.next_team_id == lots.c.team_id,
            Transfer.serial_no == lots.c.serial_no,
        )
    )
    return lots


def stock_availability():
    return and_(
        Transfer.status == "received",
        Transfer.stock_tracked.is_(True),
        or_(Balance.on_hand_quantity > 0, Balance.on_hand_weight > 0),
    )


def usable_material():
    return and_(
        Transfer.shared_unallocated.is_(False),
        or_(
            Transfer.material_type.is_(None), Transfer.material_type.not_in(EXCLUDED_MATERIAL_TYPES)
        ),
    )


def execution_availability(db, ids):
    """Aggregate actual balances, never derive physical stock from delivery targets."""
    from .inspections import hold_column

    lots = execution_lots(ids)
    available = stock_availability()
    pending = and_(Transfer.status == "pending", Transfer.entry_kind == "transfer")
    statement = (
        select(
            lots.c.schedule_id,
            func.max(case((available, 1), else_=0)).label("available"),
            func.max(
                case((and_(available, hold_column(Transfer.id).is_not(None)), 1), else_=0)
            ).label("quality_held"),
            func.max(
                case(
                    (pending, 1),
                    else_=0,
                )
            ).label("pending_receipt"),
            func.sum(case((available, Balance.on_hand_quantity), else_=0)).label(
                "on_hand_quantity"
            ),
            func.sum(case((available, Balance.on_hand_weight), else_=0)).label("on_hand_weight"),
            func.sum(case((pending, Transfer.quantity), else_=0)).label("pending_quantity"),
            func.sum(case((pending, Transfer.weight), else_=0)).label("pending_weight"),
            func.sum(case((or_(available, pending), 1), else_=0)).label("batch_count"),
            func.sum(
                case(
                    (and_(available, Transfer.rework_pending.is_(True)), Balance.on_hand_quantity),
                    else_=0,
                )
            ).label("rework_quantity"),
        )
        .join(Transfer, Transfer.id == lots.c.lot_id)
        .outerjoin(Balance, Balance.transfer_id == Transfer.id)
        .where(usable_material())
        .group_by(lots.c.schedule_id)
    )
    return {row["schedule_id"]: row for row in db.execute(statement).mappings()}


def task_locations(db, task_ids, plan_ids):
    """One physical lot counts once per task, even on repeated visits to a team."""
    from .inspections import hold_column

    lots = execution_lots(plan_ids)
    physical = (
        select(Plan.task_id, lots.c.lot_id)
        .join(lots, lots.c.schedule_id == Plan.id)
        .where(Plan.task_id.in_(task_ids), Plan.cancelled_at.is_(None))
        .distinct()
        .subquery()
    )
    available = stock_availability()
    pending = and_(Transfer.status == "pending", Transfer.entry_kind == "transfer")
    rows = db.execute(
        select(
            physical.c.task_id,
            Team.id.label("team_id"),
            Team.name.label("team_name"),
            func.sum(case((available, Balance.on_hand_quantity), else_=0)).label("quantity"),
            func.sum(case((available, Balance.on_hand_weight), else_=0)).label("weight"),
            func.sum(case((pending, Transfer.quantity), else_=0)).label("pending_quantity"),
            func.sum(case((pending, Transfer.weight), else_=0)).label("pending_weight"),
            func.count().label("batch_count"),
            func.max(
                case((and_(available, hold_column(Transfer.id).is_not(None)), 1), else_=0)
            ).label("quality_held"),
        )
        .select_from(physical)
        .join(Transfer, Transfer.id == physical.c.lot_id)
        .join(Team, Team.id == Transfer.next_team_id)
        .outerjoin(Balance, Balance.transfer_id == Transfer.id)
        .where(usable_material(), or_(available, pending))
        .group_by(physical.c.task_id, Team.id, Team.name)
        .order_by(Team.id)
    ).mappings()
    result = {}
    for row in rows:
        result.setdefault(row["task_id"], []).append(
            {
                key: bool(row[key])
                if key == "quality_held"
                else float(row[key])
                if "weight" in key
                else row[key]
                for key in (
                    "team_id",
                    "team_name",
                    "quantity",
                    "weight",
                    "pending_quantity",
                    "pending_weight",
                    "batch_count",
                    "quality_held",
                )
            }
        )
    return result


def linked_batch_rows(ids):
    links = linked_lots(ids)
    return (
        select(
            links.c.schedule_id,
            Transfer.id.label("source_transfer_id"),
            Transfer.batch_no,
            Transfer.material_name,
            Transfer.quantity,
            Transfer.weight,
            Transfer.received_at,
            Transfer.status,
            func.count().over(partition_by=links.c.schedule_id).label("total"),
            func.row_number()
            .over(partition_by=links.c.schedule_id, order_by=Transfer.id.desc())
            .label("row_number"),
        )
        .join(Transfer, Transfer.id == links.c.source_transfer_id)
        .join(Plan, Plan.id == links.c.schedule_id)
        .where(
            Transfer.status != "voided",
            Transfer.next_team_id == Plan.team_id,
            Transfer.serial_no == Plan.serial_no,
            or_(
                Transfer.material_type.is_(None),
                Transfer.material_type.not_in(EXCLUDED_MATERIAL_TYPES),
            ),
        )
        .subquery()
    )


def linked_batches(db, ids):
    rows = linked_batch_rows(ids)
    result = {}
    for row in db.execute(select(rows).where(rows.c.row_number <= 100)).mappings():
        value = result.setdefault(row["schedule_id"], {"items": [], "total": row["total"]})
        value["items"].append(
            {
                field: row[field]
                for field in (
                    "source_transfer_id",
                    "batch_no",
                    "material_name",
                    "quantity",
                    "status",
                )
            }
            | {"weight": float(row["weight"]), "received_at": iso(row["received_at"])}
        )
    return result


def serial_options(db, query=None, page=1, page_size=20):
    from sqlalchemy import func, select

    from .material_stock import literal_query
    from .models import ProductionScheduleTask

    grouped = (
        select(ProductionScheduleTask.serial_no, func.count().label("task_count"))
        .where(ProductionScheduleTask.cancelled_at.is_(None))
        .group_by(ProductionScheduleTask.serial_no)
    )
    if query:
        grouped = grouped.where(literal_query(query, [ProductionScheduleTask.serial_no]))
    total = db.scalar(select(func.count()).select_from(grouped.subquery())) or 0
    rows = db.execute(
        grouped.order_by(ProductionScheduleTask.serial_no)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).mappings()
    return {
        "items": [dict(row) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }
