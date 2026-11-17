"""Stable, per-serial batch labels for delivery tasks."""

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
