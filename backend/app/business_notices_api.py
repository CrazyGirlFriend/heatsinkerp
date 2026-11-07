"""HTTP validation and identity boundary for business notices."""

from typing import Literal

from fastapi import Depends, Query
from sqlalchemy.orm import Session

from . import business_notices as service
from .async_api import AsyncAPIRouter
from .auth import get_current_user
from .database import get_db
from .models import (
    User,
)
from .notice_schemas import (
    BusinessNoticePageResponse,
    NoticeTargetResponse,
)
from .notice_schemas import (
    BusinessNoticeReadAll as ReadAll,
)
from .notice_schemas import (
    NoticeSource as Source,
)

router = AsyncAPIRouter(prefix="/api/business-notices", tags=["business notices"])


@router.get("", response_model=BusinessNoticePageResponse, response_model_exclude_unset=True)
def inbox(
    page: int = Query(1, ge=1),
    unread_only: bool = False,
    category: Literal["all", "schedule", "rework", "transfer", "pending"] = "all",
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return service.inbox(page=page, unread_only=unread_only, category=category, user=user, db=db)


@router.get(
    "/{source}/{notice_id}/target",
    response_model=NoticeTargetResponse,
    response_model_exclude_unset=True,
)
def target(
    source: Source,
    notice_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return service.target(source=source, notice_id=notice_id, user=user, db=db)


@router.post("/read-all", status_code=204)
def read_all(
    payload: ReadAll, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return service.read_all(payload=payload, user=user, db=db)


@router.post("/{source}/{notice_id}/read", status_code=204)
def mark_read(
    source: Source,
    notice_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return service.mark_read(source=source, notice_id=notice_id, user=user, db=db)
