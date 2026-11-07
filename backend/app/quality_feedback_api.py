from datetime import date
from typing import Literal

from fastapi import Depends, Query
from sqlalchemy.orm import Session

from . import quality_feedback as feedback
from .async_api import AsyncAPIRouter
from .async_read_response import team_read_response
from .auth import get_current_user
from .database import get_db
from .models import User
from .processing_read_schemas import QuantityAdjustmentContextResponse
from .quality_schemas import (
    Decision,
    FeedbackWrite,
    QualityFeedbackDetailResponse,
    QualityFeedbackPageResponse,
    QualityReworkStockResponse,
)
from .read_schemas import PageResponse

router = AsyncAPIRouter(prefix="/api/quality-feedback", tags=["quality feedback"])


@router.get("", response_model=QualityFeedbackPageResponse, response_model_exclude_unset=True)
def records(
    team_id: int | None = Query(default=None, ge=1),
    query: str | None = Query(default=None, max_length=160),
    kind: Literal["patrol", "inspection"] | None = None,
    status: Literal["pending", "processing", "closed"] | None = None,
    problem_type_id: int | None = Query(default=None, ge=1),
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return team_read_response(
        db,
        lambda session: feedback.list_records(
            session,
            user,
            team_id=team_id,
            query=query,
            kind=kind,
            status=status,
            problem_type_id=problem_type_id,
            date_from=date_from,
            date_to=date_to,
            page=page,
            page_size=page_size,
        ),
        schema=QualityFeedbackPageResponse,
    )


@router.get(
    "/{issue_id}", response_model=QualityFeedbackDetailResponse, response_model_exclude_unset=True
)
def detail(issue_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return team_read_response(
        db,
        lambda session: feedback.detail(session, issue_id, user),
        schema=QualityFeedbackDetailResponse,
    )


@router.post(
    "/{issue_id}/reply",
    response_model=QualityFeedbackDetailResponse,
    response_model_exclude_unset=True,
)
def reply(
    issue_id: int,
    payload: FeedbackWrite,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return feedback.write(db, issue_id, payload, user)


@router.get(
    "/{issue_id}/rework-stock",
    response_model=PageResponse[QualityReworkStockResponse] | QuantityAdjustmentContextResponse,
    response_model_exclude_unset=True,
)
def rework_stock(
    issue_id: int,
    source_transfer_id: int | None = Query(default=None, ge=1),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return feedback.rework_stock(
        db, issue_id, user, source_transfer_id=source_transfer_id, page=page, page_size=page_size
    )


@router.post(
    "/{issue_id}/decision",
    response_model=QualityFeedbackDetailResponse,
    response_model_exclude_unset=True,
)
def decide(
    issue_id: int,
    payload: Decision,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return feedback.write(db, issue_id, payload, user, decision=True)
