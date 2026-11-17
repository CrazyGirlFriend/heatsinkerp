"""Stable, per-serial batch labels for delivery tasks."""

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import aliased

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
