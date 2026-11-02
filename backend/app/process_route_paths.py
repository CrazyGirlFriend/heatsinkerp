"""Resolve execution paths without making order serials part of engineering data."""

from fastapi import HTTPException
from sqlalchemy import case, func, select

from .models import MaterialTransfer, ProcessRoutePath, ProductionSchedule, ProductionScheduleTask


def execution_serial(route, serial):
    if serial in route.serial_nos:
        return serial
    paths = {
        tuple(
            index
            for index, step in enumerate(route.steps)
            if not step.get("serial_nos") or member in step["serial_nos"]
        )
        for member in route.serial_nos
    }
    if route.route_kind != "normal" or len(paths) != 1 or not route.serial_nos:
        raise HTTPException(422, "工艺包含不同流水号分支，请选择执行路线明确的工艺")
    return route.serial_nos[0]


def scheduled_route_ids(db, serial):
    return set(
        db.scalars(
            select(ProductionSchedule.process_route_id)
            .join(ProductionScheduleTask)
            .where(
                ProductionScheduleTask.serial_no == serial,
                ProductionScheduleTask.cancelled_at.is_(None),
                ProductionSchedule.cancelled_at.is_(None),
                ProductionSchedule.process_route_id.is_not(None),
            )
            .distinct()
        )
    )


def require_order_route(db, route, serial):
    execution_serial(route, serial)
    if serial not in route.serial_nos and route.id not in scheduled_route_ids(db, serial):
        raise HTTPException(422, "请先在该流水号的排期中关联工艺")


def path_serial(transfer=MaterialTransfer):
    """Bound external serials already passed the unambiguous-path validation above."""
    path = ProcessRoutePath.__table__.alias("order_execution_path")
    exact = (
        select(path.c.route_id)
        .where(
            path.c.route_id == transfer.process_route_id,
            path.c.serial_no == transfer.serial_no,
        )
        .correlate(transfer)
        .exists()
    )
    representative = (
        select(func.min(path.c.serial_no))
        .where(path.c.route_id == transfer.process_route_id, path.c.serial_no != "")
        .correlate(transfer)
        .scalar_subquery()
    )
    return case(
        (transfer.shared_unallocated.is_(True), ""),
        (exact, transfer.serial_no),
        else_=representative,
    )
