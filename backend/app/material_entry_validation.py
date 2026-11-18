"""Validate new handoffs against local order/engineering records."""

from fastapi import HTTPException
from sqlalchemy import select

from .models import ProcessRoutePolicy, ProcessRouteSerial, ProductionScheduleTask
from .schemas import SCRAP_MATERIAL_TYPES


def require_registered_serial(db, serial, material_type, *, documents=()):
    if not serial or material_type in SCRAP_MATERIAL_TYPES:
        return  # Unassigned raw stock receives its serial before warehouse dispatch.
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
    for document in documents:
        parsed = document.parsed or {}
        if serial == parsed.get("serial_no") or serial in parsed.get("serial_nos", []):
            return
    raise HTTPException(
        422, "流水号未登记，请先关联工艺、订单排期或导入对应原件；暂未分配流水号的原料请留空"
    )
