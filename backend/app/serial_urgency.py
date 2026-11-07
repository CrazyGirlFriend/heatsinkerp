"""Serial urgency queries and a single versioned, audited write transaction."""

from datetime import timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import actor_name
from .models import MaterialTransfer, SerialUrgency, SerialUrgencyEvent, User, utcnow
from .serial_urgency_schemas import UrgencyUpdate


def urgency_dict(row):
    return {
        "urgent": bool(row and row.urgent),
        "reason": row.reason if row else None,
        "version": row.version if row else 0,
        "updated_by": row.updated_by if row else None,
        "updated_at": row.updated_at.replace(tzinfo=timezone.utc).isoformat() if row else None,
    }


def urgency_map(db, serials):
    return (
        {
            row.serial_no: urgency_dict(row)
            for row in db.scalars(select(SerialUrgency).where(SerialUrgency.serial_no.in_(serials)))
        }
        if serials
        else {}
    )


def get_urgency(db: Session, serial_no: str):
    serial = serial_no.strip()
    if not db.scalar(
        select(MaterialTransfer.id).where(MaterialTransfer.serial_no == serial).limit(1)
    ):
        raise HTTPException(404, "未找到流水号")
    return urgency_dict(db.get(SerialUrgency, serial))


def set_urgency(db: Session, payload: UrgencyUpdate, user: User):
    serial = payload.serial_no.strip()
    with db.begin():
        # Lock an existing serial origin, including first-time flags. No phantom
        # flag row race and no stock balance/version changes.
        origin = db.scalar(
            select(MaterialTransfer.id)
            .where(MaterialTransfer.serial_no == serial)
            .order_by(MaterialTransfer.id)
            .limit(1)
            .with_for_update()
        )
        if origin is None:
            raise HTTPException(404, "未找到流水号")
        row = db.scalar(
            select(SerialUrgency).where(SerialUrgency.serial_no == serial).with_for_update()
        )
        if (row.version if row else 0) != payload.expected_version:
            raise HTTPException(409, "加急状态已更新，请刷新后重试")
        if row is None:
            row = SerialUrgency(serial_no=serial, version=0)
            db.add(row)
        row.urgent = payload.urgent
        row.reason = ((payload.reason or "").strip() or None) if payload.urgent else None
        row.version += 1
        row.updated_by = actor_name(user)
        row.updated_at = utcnow()
        db.add(
            SerialUrgencyEvent(
                serial_no=serial,
                urgent=row.urgent,
                reason=row.reason,
                actor=row.updated_by,
                actor_id=user.id,
                occurred_at=row.updated_at,
            )
        )
        db.flush()
        db.refresh(row)
        result = urgency_dict(row)
    return result
