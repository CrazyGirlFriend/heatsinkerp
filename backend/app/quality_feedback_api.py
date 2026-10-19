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

router = AsyncAPIRouter(prefix="/api/quality-feedback", tags=["quality feedback"])


@router.get("")
def records(
    team_id: int | None = Query(default=None, ge=1),
    query: str | None = Query(default=None, max_length=160),
    kind: Literal["patrol", "inspection"] | None = None,
    status: Literal["pending", "processing", "closed"] | None = None,
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
            date_from=date_from,
            date_to=date_to,
            page=page,
            page_size=page_size,
        ),
    )


@router.get("/{issue_id}")
def detail(issue_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return team_read_response(db, lambda session: feedback.detail(session, issue_id, user))


@router.post("/{issue_id}/reply")
def reply(
    issue_id: int,
    payload: feedback.FeedbackWrite,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return feedback.write(db, issue_id, payload, user)


@router.post("/{issue_id}/decision")
def decide(
    issue_id: int,
    payload: feedback.Decision,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return feedback.write(db, issue_id, payload, user, decision=True)
