"""HTTP validation and identity boundary for schedule notices."""

from fastapi import Depends, Query
from sqlalchemy.orm import Session

from . import schedule_notices as service
from .async_api import AsyncAPIRouter
from .auth import get_current_user
from .database import get_db
from .models import (
    User,
)
from .notice_schemas import ScheduleNoticePageResponse
from .notice_schemas import ScheduleNoticeReadAll as ReadAll

router = AsyncAPIRouter(prefix="/api/schedule-notices", tags=["schedule notices"])


@router.post("/refresh", status_code=204)
def refresh(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return service.refresh(user=user, db=db)


@router.get("", response_model=ScheduleNoticePageResponse)
def inbox(
    page: int = Query(default=1, ge=1),
    unread_only: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return service.inbox(page=page, unread_only=unread_only, user=user, db=db)


@router.post("/read-all", status_code=204)
def read_all(
    payload: ReadAll, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return service.read_all(payload=payload, user=user, db=db)


@router.post("/{notice_id}/read", status_code=204)
def mark_read(
    notice_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return service.mark_read(notice_id=notice_id, user=user, db=db)
