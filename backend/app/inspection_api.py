"""Authenticated inspection reads and inspection-team-only sampling writes."""

from datetime import date
from typing import Literal

from fastapi import Depends, Query
from sqlalchemy.orm import Session

from . import inspections
from .async_api import AsyncAPIRouter as APIRouter
from .async_read_response import team_read_response
from .auth import get_current_user
from .database import get_db
from .models import User

router = APIRouter(prefix="/api/inspections", tags=["on-site inspection"])


@router.get("/{inspection_id}/recheck-context")
def recheck_context(
    inspection_id: int, _: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return team_read_response(
        db, lambda session: inspections.recheck_context(session, inspection_id)
    )


@router.get("/sources")
def sources(
    team_id: int = Query(ge=1),
    query: str | None = Query(default=None, max_length=160),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return team_read_response(
        db, lambda session: inspections.list_sources(session, team_id, query, page, page_size)
    )


@router.get("")
def records(
    team_id: int | None = Query(default=None, ge=1),
    source_transfer_id: int | None = Query(default=None, ge=1),
    query: str | None = Query(default=None, max_length=160),
    inspector_id: int | None = Query(default=None, ge=1),
    status: Literal["pending", "released", "passed", "failed"] | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return team_read_response(
        db,
        lambda session: inspections.list_records(
            session,
            team_id=team_id,
            source_transfer_id=source_transfer_id,
            query=query,
            inspector_id=inspector_id,
            status=status,
            date_from=date_from,
            date_to=date_to,
            page=page,
            page_size=page_size,
        ),
    )


@router.post("", status_code=201)
def create(
    payload: inspections.InspectionCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return inspections.create(db, payload, user)
