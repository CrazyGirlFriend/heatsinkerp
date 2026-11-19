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
    TeamProblemResponse,
)
from .read_schemas import PageResponse

router = AsyncAPIRouter(prefix="/api/quality-feedback", tags=["quality feedback"])


@router.get("", response_model=QualityFeedbackPageResponse, response_model_exclude_unset=True)
def records(
    team_id: int | None = Query(default=None, ge=1),
    query: str | None = Query(default=None, max_length=160),
    kind: Literal["patrol", "inspection", "team_report"] | None = None,
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


@router.post("/team-problems/{route_id}/assign", response_model=TeamProblemResponse)
def assign_team_problem(
    route_id: int,
    repair_team_id: int = Query(ge=1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from .process_routes import require_route
    from .quality_team_problems import detail
    from .rework_routes import assign_repair

    with db.begin():
        detail(db, route_id, user)
        route = require_route(db, route_id, True)
        assign_repair(db, route, repair_team_id, user)
        return detail(db, route_id, user)


@router.post(
    "/{issue_id}/pending-repairs/{route_id}/assign",
    response_model=QualityFeedbackDetailResponse,
    response_model_exclude_unset=True,
)
def assign_pending_repair(
    issue_id: int,
    route_id: int,
    repair_team_id: int = Query(ge=1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from fastapi import HTTPException

    from . import quality_feedback
    from .process_routes import require_route
    from .rework_routes import assign_repair

    with db.begin():
        quality_feedback.require_rework_issue(db, issue_id, user, lock=True)
        route = require_route(db, route_id, True)
        if route.rework_inspection_id != issue_id:
            raise HTTPException(404, "未找到该检验记录的返修批次")
        assign_repair(db, route, repair_team_id, user)
        return quality_feedback.detail(db, issue_id, user)


@router.get("/team-problems/{route_id}", response_model=TeamProblemResponse)
def team_problem(
    route_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    from .quality_team_problems import detail

    return team_read_response(
        db, lambda session: detail(session, route_id, user), schema=TeamProblemResponse
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
