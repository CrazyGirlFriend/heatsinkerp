"""Administrative serial flags are independent of locked stock documents."""
from datetime import timezone
from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from .auth import actor_name, get_current_user, require_admin
from .database import get_db
from .models import MaterialTransfer, SerialUrgency, SerialUrgencyEvent, User, utcnow

from .async_api import AsyncAPIRouter as APIRouter

router = APIRouter(prefix="/api/serial-urgency", tags=["serial urgency"])


def urgency_dict(row):
    return {"urgent": bool(row and row.urgent), "reason": row.reason if row else None,
            "version": row.version if row else 0, "updated_by": row.updated_by if row else None,
            "updated_at": row.updated_at.replace(tzinfo=timezone.utc).isoformat() if row else None}


def urgency_map(db, serials):
    return {row.serial_no: urgency_dict(row) for row in db.scalars(
        select(SerialUrgency).where(SerialUrgency.serial_no.in_(serials)))} if serials else {}


class UrgencyUpdate(BaseModel):
    serial_no: str = Field(min_length=1, max_length=80)
    urgent: bool
    reason: str | None = Field(default=None, max_length=500)
    expected_version: int = Field(ge=0)


@router.get("")
def get_urgency(serial_no: str = Query(min_length=1, max_length=80),
                _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    serial = serial_no.strip()
    if not db.scalar(select(MaterialTransfer.id).where(MaterialTransfer.serial_no == serial).limit(1)):
        raise HTTPException(404, "未找到流水号")
    return urgency_dict(db.get(SerialUrgency, serial))


@router.put("")
def set_urgency(payload: UrgencyUpdate, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    serial = payload.serial_no.strip()
    with db.begin():
        # Lock an existing serial origin, including first-time flags. No phantom
        # flag row race and no stock balance/version changes.
        origin = db.scalar(select(MaterialTransfer.id).where(MaterialTransfer.serial_no == serial)
                           .order_by(MaterialTransfer.id).limit(1).with_for_update())
        if origin is None:
            raise HTTPException(404, "未找到流水号")
        row = db.scalar(select(SerialUrgency).where(SerialUrgency.serial_no == serial).with_for_update())
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
        db.add(SerialUrgencyEvent(serial_no=serial, urgent=row.urgent, reason=row.reason,
                                 actor=row.updated_by, actor_id=user.id, occurred_at=row.updated_at))
        db.flush()
        db.refresh(row)
        result = urgency_dict(row)
    return result
