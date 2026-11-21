"""Validate the destination serial of a stock reallocation."""

from fastapi import HTTPException
from sqlalchemy import select

from .models import ProcessRoutePolicy, ProcessRouteSerial, ProductionScheduleTask
from .schemas import SCRAP_MATERIAL_TYPES


def require_registered_serial(db, serial, material_type):
    if not serial or material_type in SCRAP_MATERIAL_TYPES:
        return
    if db.get(ProcessRoutePolicy, 1) is None:
        return  # Preserve the pre-engineering ledger; the policy is enabled by saved routes.
    if db.get(ProcessRouteSerial, serial.casefold()) is not None:
        return
    if (
        db.scalar(
            select(ProductionScheduleTask.id)
            .where(
                ProductionScheduleTask.serial_no == serial,
                ProductionScheduleTask.cancelled_at.is_(None),
            )
            .limit(1)
        )
        is not None
    ):
        return
    raise HTTPException(422, "转投流水号未登记，请选择已登记工艺或订单排期的流水号")
