"""Find dispatch order originals for a serial and its bound engineering version."""

from sqlalchemy import select

from .models import ProductionSchedule, ProductionScheduleOrderFile, ProductionScheduleTask


def route_order(db, route_id, serial_no, task_id=None):
    return db.scalar(
        select(ProductionScheduleOrderFile)
        .join(ProductionScheduleTask)
        .where(
            ProductionScheduleTask.serial_no == serial_no,
            ProductionScheduleTask.id == task_id
            if task_id is not None
            else ProductionScheduleTask.cancelled_at.is_(None),
            select(ProductionSchedule.id)
            .where(
                ProductionSchedule.task_id == ProductionScheduleTask.id,
                ProductionSchedule.process_route_id == route_id,
                ProductionSchedule.cancelled_at.is_(None),
            )
            .exists(),
        )
        .order_by(ProductionScheduleTask.id.desc())
        .limit(1)
    )
