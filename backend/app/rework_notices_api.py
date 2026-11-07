"""HTTP validation and identity boundary for rework notices."""

from fastapi import Depends, Query
from sqlalchemy.orm import Session

from . import rework_notices as service
from .async_api import AsyncAPIRouter
from .auth import get_current_user
from .database import get_db
from .models import User
from .notice_schemas import NoticeReadResponse, ReworkNoticePageResponse
from .process_route_read_schemas import ProcessRouteDetailResponse

router = AsyncAPIRouter(prefix="/api/rework-notices", dependencies=[Depends(get_current_user)])


@router.get("", response_model=ReworkNoticePageResponse)
def list_notices(
    team_id: int = Query(ge=1),
    page: int = Query(1, ge=1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return service.list_notices(team_id=team_id, page=page, user=user, db=db)


@router.get(
    "/{notice_id}/route",
    response_model=ProcessRouteDetailResponse,
    response_model_exclude_unset=True,
)
def notice_route(
    notice_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return service.notice_route(notice_id=notice_id, user=user, db=db)


@router.post("/{notice_id}/read", response_model=NoticeReadResponse)
def mark_read(
    notice_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return service.mark_read(notice_id=notice_id, user=user, db=db)
