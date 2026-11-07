"""Authenticated reads and administrator-only serial urgency updates."""

from fastapi import Depends, Query
from sqlalchemy.orm import Session

from . import serial_urgency
from .async_api import AsyncAPIRouter
from .auth import get_current_user, require_admin
from .database import get_db
from .models import User
from .serial_urgency_schemas import UrgencyResponse, UrgencyUpdate

router = AsyncAPIRouter(prefix="/api/serial-urgency", tags=["serial urgency"])


@router.get("", response_model=UrgencyResponse)
def get_urgency(
    serial_no: str = Query(min_length=1, max_length=80),
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return serial_urgency.get_urgency(db, serial_no)


@router.put("", response_model=UrgencyResponse)
def set_urgency(
    payload: UrgencyUpdate, user: User = Depends(require_admin), db: Session = Depends(get_db)
):
    return serial_urgency.set_urgency(db, payload, user)
