"""Authenticated serial history endpoint; event reconstruction lives in queries."""

from datetime import date

from fastapi import Depends, Path, Query
from sqlalchemy.orm import Session

from .async_api import AsyncAPIRouter as APIRouter
from .auth import get_current_user
from .database import get_db
from .models import User
from .serial_history_schemas import SerialHistory
from .team_serial_history_queries import serial_history

router = APIRouter(prefix="/api/team-materials", tags=["serial receipt and dispatch history"])


@router.get("/{team_id}/serial-history", response_model=SerialHistory)
def history(
    team_id: int = Path(ge=1),
    serial_no: str = Query(min_length=1, max_length=80),
    date_from: date | None = None,
    date_to: date | None = None,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return serial_history(db, team_id, serial_no, date_from, date_to)
