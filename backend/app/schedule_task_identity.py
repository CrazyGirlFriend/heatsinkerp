"""Stable, per-serial batch labels for delivery tasks."""

from functools import cache

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import aliased

from .models import MaterialTransfer as Transfer
from .models import ProductionSchedule as Plan
from .models import ProductionScheduleDelivery as Delivery
from .models import ProductionScheduleTask as Task


def task_batch_number_column():
    previous = aliased(Task)
    # Cancelled tasks keep their place so existing batches never get renumbered.
    return (
        select(func.count(previous.id))
        .where(
            previous.serial_no == Task.serial_no,
            or_(
                previous.created_at < Task.created_at,
                and_(previous.created_at == Task.created_at, previous.id <= Task.id),
            ),
        )
        .correlate(Task)
        .scalar_subquery()
    )


def schedule_batch_number_column(schedule_id):
    return (
        select(task_batch_number_column())
        .select_from(Plan)
        .join(Task, Task.id == Plan.task_id)
        .where(Plan.id == schedule_id)
        .correlate_except(Plan, Task)
        .scalar_subquery()
    )


def transfer_batch_number_column():
    return (
        select(task_batch_number_column())
        .select_from(Delivery)
        .join(Plan, Plan.id == Delivery.schedule_id)
        .join(Task, Task.id == Plan.task_id)
        .where(Delivery.transfer_id == Transfer.id)
        .correlate(Transfer)
        .scalar_subquery()
    )


@cache
def stock_task_bindings():
    """Cache only the SQL expression; all identities are read from the current database."""
    lots = (
        select(Transfer.id.label("lot_id"), Transfer.serial_no, Plan.task_id)
        .outerjoin(Delivery, Delivery.transfer_id == Transfer.id)
        .join(Plan, Plan.id == func.coalesce(Transfer.processing_schedule_id, Delivery.schedule_id))
        .join(Task, Task.id == Plan.task_id)
        .where(Task.serial_no == Transfer.serial_no, Transfer.shared_unallocated.is_(False))
        .cte("stock_task_bindings", recursive=True)
    )
    # Partial processing and rework can create children without another delivery.
    # Keep their receipt's identity, but never carry it across serial reallocation.
    return lots.union(
        select(Transfer.id, Transfer.serial_no, lots.c.task_id)
        .join(lots, Transfer.source_transfer_id == lots.c.lot_id)
        .where(
            Transfer.entry_kind.in_(("processing_output", "rework_split")),
            Transfer.serial_no == lots.c.serial_no,
            Transfer.shared_unallocated.is_(False),
            or_(Transfer.processing_role.is_(None), Transfer.processing_role != "scrap"),
            Transfer.processing_schedule_id.is_(None),
            ~select(Delivery.transfer_id).where(Delivery.transfer_id == Transfer.id).exists(),
        )
    )


def stock_task_id_column(lot_id):
    bindings = stock_task_bindings()
    return (
        select(bindings.c.task_id)
        .where(bindings.c.lot_id == lot_id)
        .correlate_except(bindings)
        .scalar_subquery()
    )


def stock_batch_number_column(lot_id):
    bindings = stock_task_bindings()
    return (
        select(task_batch_number_column())
        .select_from(bindings)
        .join(Task, Task.id == bindings.c.task_id)
        .where(bindings.c.lot_id == lot_id)
        .correlate_except(bindings, Task)
        .scalar_subquery()
    )
