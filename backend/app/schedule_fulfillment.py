"""Customer fulfillment, separate from processing and internal handoffs."""

from datetime import datetime, time, timedelta, timezone

from sqlalchemy import and_, case, func, literal_column, or_, select, true
from sqlalchemy.orm import aliased

from .models import MaterialTransfer as Transfer
from .models import ProductionSchedule as Plan
from .models import ProductionScheduleDelivery as Delivery
from .models import ProductionScheduleTask as Task
from .models import utcnow
from .production_schedule_queries import LOCAL_ZONE, iso
from .team_constants import EXTERNAL_ENTRY_KINDS


def target_columns(db):
    last = aliased(Plan)
    last_node = (
        select(last.target_quantity)
        .where(last.task_id == Task.id, last.cancelled_at.is_(None))
        .order_by(last.sequence_no.desc(), last.id.desc())
        .limit(1)
        .scalar_subquery()
    )
    if db.get_bind().dialect.name == "sqlite":
        batches = func.json_each(Task.delivery_batches).table_valued("value")
        quantity = func.json_extract(batches.c.value, "$.target_quantity")
        length = func.json_array_length(Task.delivery_batches)
    else:
        batches = func.json_table(
            Task.delivery_batches,
            literal_column("'$[*]' COLUMNS(target_quantity INT PATH '$.target_quantity')"),
        ).table_valued("target_quantity")
        quantity = batches.c.target_quantity
        length = func.json_length(Task.delivery_batches)
    total = select(func.sum(quantity)).select_from(batches).scalar_subquery()
    due = func.coalesce(
        Task.final_due_at,
        select(last.due_at)
        .where(last.task_id == Task.id)
        .order_by(
            case((last.cancelled_at.is_(None), 0), else_=1), last.sequence_no.desc(), last.id.desc()
        )
        .limit(1)
        .scalar_subquery(),
    )
    return func.coalesce(total, last_node), due, func.coalesce(func.nullif(length, 0), 1)


def customer_shipments():
    return (
        Transfer.entry_kind.in_(EXTERNAL_ENTRY_KINDS),
        Transfer.external_destination == "对外转料",
        Transfer.material_type == "finished",
        Transfer.status == "dispatched",
        Transfer.dispatched_at.is_not(None),
    )


def fulfillment_table(db):
    quantity, due, _ = target_columns(db)
    targets = select(
        Task.id.label("task_id"), quantity.label("order_quantity"), due.label("order_due_at")
    ).subquery()
    # Prefer an explicit delivery link, then the source lot's processing/receipt link.
    # Unbound historical shipments may belong to a single active order only; the
    # same serial's shipment must never fulfill two orders or a later new order.
    source = aliased(Transfer)
    direct, received = aliased(Delivery), aliased(Delivery)
    direct_plan, work_plan, received_plan = aliased(Plan), aliased(Plan), aliased(Plan)
    only_task = (
        select(func.min(Task.id))
        .where(
            Task.serial_no == Transfer.serial_no,
            Task.cancelled_at.is_(None),
            Task.created_at <= Transfer.dispatched_at,
        )
        .having(func.count(Task.id) == 1)
        .correlate(Transfer)
        .scalar_subquery()
    )
    attributed = (
        select(
            Transfer.id,
            Transfer.quantity,
            Transfer.dispatched_at,
            func.coalesce(
                direct_plan.task_id, work_plan.task_id, received_plan.task_id, only_task
            ).label("task_id"),
        )
        .outerjoin(direct, direct.transfer_id == Transfer.id)
        .outerjoin(direct_plan, direct_plan.id == direct.schedule_id)
        .outerjoin(source, source.id == Transfer.source_transfer_id)
        .outerjoin(work_plan, work_plan.id == source.processing_schedule_id)
        .outerjoin(received, received.transfer_id == source.id)
        .outerjoin(received_plan, received_plan.id == received.schedule_id)
        .where(*customer_shipments())
        .subquery()
    )
    running = select(
        attributed,
        func.sum(attributed.c.quantity)
        .over(
            partition_by=attributed.c.task_id,
            order_by=(attributed.c.dispatched_at, attributed.c.id),
            rows=(None, 0),
        )
        .label("running_quantity"),
    ).subquery()
    totals = (
        select(
            running.c.task_id,
            func.sum(running.c.quantity).label("shipped_quantity"),
            func.min(
                case(
                    (
                        running.c.running_quantity >= targets.c.order_quantity,
                        running.c.dispatched_at,
                    ),
                    else_=None,
                )
            ).label("shipment_completed_at"),
        )
        .join(targets, targets.c.task_id == running.c.task_id)
        .group_by(running.c.task_id)
        .subquery()
    )
    # Customer batches are cumulative commitments; shipping the total later does
    # not erase a missed earlier batch deadline.
    if db.get_bind().dialect.name == "sqlite":
        entries = func.json_each(Task.delivery_batches).table_valued("value")
        batch_qty = func.json_extract(entries.c.value, "$.target_quantity")
        batch_due = func.datetime(func.json_extract(entries.c.value, "$.due_at"))
        batch_no = func.json_extract(entries.c.value, "$.batch_number")
    else:
        entries = func.json_table(
            Task.delivery_batches,
            literal_column(
                "'$[*]' COLUMNS(target_quantity INT PATH '$.target_quantity', "
                "due_at VARCHAR(40) PATH '$.due_at', batch_number INT PATH '$.batch_number')"
            ),
        ).table_valued("target_quantity", "due_at", "batch_number")
        batch_qty = entries.c.target_quantity
        batch_due = func.str_to_date(
            func.replace(func.substr(entries.c.due_at, 1, 19), "T", " "), "%Y-%m-%d %H:%i:%s"
        )
        batch_no = entries.c.batch_number
    commitments = (
        select(
            Task.id.label("task_id"),
            batch_due.label("due_at"),
            func.sum(batch_qty)
            .over(partition_by=Task.id, order_by=(batch_due, batch_no), rows=(None, 0))
            .label("quantity"),
        )
        .select_from(Task)
        .join(entries, true())
        .subquery()
    )
    before_due = running.c.dispatched_at <= commitments.c.due_at
    if db.get_bind().dialect.name == "sqlite":
        before_due = func.julianday(running.c.dispatched_at) <= func.julianday(commitments.c.due_at)
    delivered_on_time = (
        select(func.max(running.c.running_quantity))
        .where(
            running.c.task_id == commitments.c.task_id,
            before_due,
        )
        .correlate(commitments)
        .scalar_subquery()
    )
    missed_batch = (
        select(commitments.c.task_id)
        .where(
            commitments.c.task_id == targets.c.task_id,
            commitments.c.due_at < utcnow(),
            func.coalesce(delivered_on_time, 0) < commitments.c.quantity,
        )
        .correlate(targets)
        .exists()
    )
    shipped = func.coalesce(totals.c.shipped_quantity, 0)
    complete = and_(targets.c.order_quantity > 0, shipped >= targets.c.order_quantity)
    overdue = and_(
        targets.c.order_due_at.is_not(None),
        or_(
            and_(complete, totals.c.shipment_completed_at > targets.c.order_due_at),
            and_(~complete, targets.c.order_due_at < utcnow()),
            missed_batch,
        ),
    )
    return (
        select(
            targets,
            shipped.label("shipped_quantity"),
            totals.c.shipment_completed_at,
            case((complete, True), else_=False).label("order_completed"),
            case((overdue, True), else_=False).label("order_overdue"),
            case((complete, "shipped"), (shipped > 0, "partial"), else_="unshipped").label(
                "shipment_status"
            ),
        )
        .outerjoin(totals, totals.c.task_id == targets.c.task_id)
        .subquery("order_fulfillment")
    )


def fulfillment_values(db, ids):
    table = fulfillment_table(db)
    return {
        row.task_id: {
            **{
                key: row._mapping[key]
                for key in (
                    "order_quantity",
                    "shipped_quantity",
                    "order_completed",
                    "order_overdue",
                    "shipment_status",
                )
            },
            "shipment_completed_at": iso(row.shipment_completed_at),
            "fulfillment_status": row.fulfillment_status,
        }
        for row in db.execute(
            select(table, order_status(table).label("fulfillment_status")).where(
                table.c.task_id.in_(ids)
            )
        )
    }


def order_status(table):
    local = utcnow().replace(tzinfo=timezone.utc).astimezone(LOCAL_ZONE)
    end_today = datetime.combine(local.date() + timedelta(days=1), time(), LOCAL_ZONE)
    end_today = end_today.astimezone(timezone.utc).replace(tzinfo=None)
    return case(
        (and_(table.c.order_completed, table.c.order_overdue), "completed_late"),
        (table.c.order_completed, "completed"),
        (table.c.order_overdue, "overdue"),
        (table.c.order_due_at < end_today, "today"),
        else_="pending",
    )
