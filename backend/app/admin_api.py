"""Team and leader administration; no production-operation endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .admin_audit import audit, snapshot
from .api_errors import conflict as _conflict
from .api_errors import not_found as _not_found
from .auth import get_current_user, hash_password, require_admin
from .database import get_db
from .history_protection import team_has_historical_references
from .models import (
    MaterialTransfer,
    OpeningStockSubmission,
    Team,
    TeamPurpose,
    TeamSettingEvent,
    User,
    utcnow,
)
from .schemas import TeamCreate, TeamResponse, TeamUpdate, UserCreate, UserResponse, UserUpdate
from .serializers import team_dict, user_dict
from .team_constants import WAREHOUSE_TEAM_CODE, WAREHOUSE_TEAM_NAME

router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])


@router.post("/teams", response_model=TeamResponse, status_code=201, tags=["administration"])
def create_team(
    payload: TeamCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    if payload.kind == "warehouse" and (
        payload.code != WAREHOUSE_TEAM_CODE or payload.name != WAREHOUSE_TEAM_NAME
    ):
        raise HTTPException(422, "warehouse team must use the system warehouse code and name")
    if payload.code == WAREHOUSE_TEAM_CODE and payload.kind != "warehouse":
        raise HTTPException(422, "the system warehouse code is reserved for the warehouse team")
    team = Team(
        code=payload.code,
        name=payload.name,
        description=payload.description,
        active=payload.active,
        sort_order=payload.sort_order,
        kind=payload.kind,
    )
    try:
        db.add(team)
        audit(db, admin, team, "created")
        db.commit()
        db.refresh(team)
    except IntegrityError as exc:
        db.rollback()
        raise _conflict("team code or name already exists") from exc
    return team_dict(team)


@router.get("/teams", response_model=list[TeamResponse], tags=["administration"])
def list_teams(_: User = Depends(require_admin), db: Session = Depends(get_db)) -> list[dict]:
    return [
        team_dict(team)
        for team in db.scalars(select(Team).order_by(Team.sort_order, Team.id)).all()
    ]


@router.get("/team-directory", response_model=list[TeamResponse], tags=["teams"])
def team_directory(
    _: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[dict]:
    return [
        team_dict(team)
        for team in db.scalars(
            select(Team).where(Team.active.is_(True)).order_by(Team.sort_order, Team.id)
        ).all()
    ]


@router.get("/teams/{team_id}", response_model=TeamResponse, tags=["administration"])
def get_team(
    team_id: int,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    team = db.get(Team, team_id)
    if team is None:
        raise _not_found("team")
    return team_dict(team)


@router.patch("/teams/{team_id}", response_model=TeamResponse, tags=["administration"])
def update_team(
    team_id: int,
    payload: TeamUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    team = db.get(Team, team_id)
    if team is None:
        raise _not_found("team")
    before = snapshot(team)
    supplied = payload.model_fields_set
    if team.code == WAREHOUSE_TEAM_CODE and supplied.intersection(
        {"code", "name", "kind", "active"}
    ):
        final_code = payload.code if "code" in supplied else team.code
        final_name = payload.name if "name" in supplied else team.name
        final_kind = payload.kind if "kind" in supplied else team.kind
        final_active = payload.active if "active" in supplied else team.active
        if (
            final_code != WAREHOUSE_TEAM_CODE
            or final_name != WAREHOUSE_TEAM_NAME
            or final_kind != "warehouse"
            or not final_active
        ):
            raise _conflict(
                "the system warehouse boundary team cannot be renamed, retyped, or deactivated"
            )
    if any(getattr(payload, field) is None for field in supplied if field != "description"):
        raise HTTPException(422, "team fields cannot be null")
    if "kind" in supplied and payload.kind != team.kind:
        referenced = team_has_historical_references(db, team.id)
        referenced = referenced or any(
            db.scalar(select(func.count(MaterialTransfer.id)).where(column == team.id))
            for column in (
                MaterialTransfer.source_team_id,
                MaterialTransfer.next_team_id,
            )
        )
        if referenced:
            raise _conflict(
                "team kind cannot change after it is referenced by a route or production history"
            )
    for field in ("code", "name", "description", "active", "sort_order", "kind"):
        if field in supplied:
            setattr(team, field, getattr(payload, field))
    team.updated_at = utcnow()
    try:
        audit(db, admin, team, "updated", before)
        db.commit()
        db.refresh(team)
    except IntegrityError as exc:
        db.rollback()
        raise _conflict("team code or name already exists") from exc
    return team_dict(team)


@router.delete("/teams/{team_id}", status_code=204, tags=["administration"])
def delete_team(
    team_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Response:
    team = db.get(Team, team_id)
    if team is None:
        raise _not_found("team")
    if team.code == WAREHOUSE_TEAM_CODE:
        raise _conflict("the system warehouse boundary team cannot be deleted")
    in_use = any(
        db.scalar(select(func.count(model.id)).where(column == team_id))
        for model, column in (
            (User, User.team_id),
            (MaterialTransfer, MaterialTransfer.source_team_id),
            (MaterialTransfer, MaterialTransfer.next_team_id),
            (TeamPurpose, TeamPurpose.team_id),
            (TeamSettingEvent, TeamSettingEvent.team_id),
            (OpeningStockSubmission, OpeningStockSubmission.team_id),
        )
    )
    if in_use or team_has_historical_references(db, team_id):
        raise _conflict("team is in use and cannot be deleted; deactivate it instead")
    audit(db, admin, team, "deleted", snapshot(team))
    db.delete(team)
    db.commit()
    return Response(status_code=204)


def _validated_team(db: Session, role: str, team_id: int | None) -> Team | None:
    if role == "TEAM" and team_id is None:
        raise HTTPException(status_code=422, detail="TEAM users must have a team_id")
    if team_id is None:
        return None
    team = db.get(Team, team_id)
    if team is None or not team.active:
        raise HTTPException(status_code=422, detail="team_id must reference an active team")
    return team


@router.post("/users", response_model=UserResponse, status_code=201, tags=["administration"])
@router.post("/accounts", response_model=UserResponse, status_code=201, tags=["administration"])
def create_user(
    payload: UserCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    if payload.role != "TEAM":
        raise HTTPException(
            status_code=422,
            detail="new accounts must be team leader accounts bound to an active team",
        )
    team = _validated_team(db, payload.role, payload.team_id)
    user = User(
        username=payload.username,
        display_name=payload.display_name,
        password_hash=hash_password(payload.password),
        role=payload.role,
        team=team,
        active=payload.active,
    )
    try:
        db.add(user)
        audit(db, admin, user, "created")
        db.commit()
        db.refresh(user)
    except IntegrityError as exc:
        db.rollback()
        raise _conflict("username already exists") from exc
    return user_dict(user)


@router.get("/users", response_model=list[UserResponse], tags=["administration"])
@router.get("/accounts", response_model=list[UserResponse], tags=["administration"])
def list_users(_: User = Depends(require_admin), db: Session = Depends(get_db)) -> list[dict]:
    return [user_dict(user) for user in db.scalars(select(User).order_by(User.username)).all()]


def _get_user_or_404(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise _not_found("user")
    return user


@router.get("/users/{user_id}", response_model=UserResponse, tags=["administration"])
@router.get("/accounts/{user_id}", response_model=UserResponse, tags=["administration"])
def get_user(
    user_id: int,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    return user_dict(_get_user_or_404(db, user_id))


@router.patch("/users/{user_id}", response_model=UserResponse, tags=["administration"])
@router.patch("/accounts/{user_id}", response_model=UserResponse, tags=["administration"])
def update_user(
    user_id: int,
    payload: UserUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    user = _get_user_or_404(db, user_id)
    before = snapshot(user)
    supplied = payload.model_fields_set
    final_role = payload.role if "role" in supplied else user.role
    final_team_id = payload.team_id if "team_id" in supplied else user.team_id
    final_active = payload.active if "active" in supplied else user.active
    if user.role == "TEAM" and final_role != "TEAM":
        raise HTTPException(422, "team leader accounts cannot become administrators")
    if user.role == "ADMIN" and final_role != "ADMIN":
        raise _conflict("the system administrator role cannot be changed")
    if user.role == "ADMIN" and "team_id" in supplied and payload.team_id is not None:
        raise HTTPException(422, "the system administrator cannot be bound to a team")
    if user.role == "ADMIN" and user.active and (final_role != "ADMIN" or not final_active):
        other_active_admins = (
            db.scalar(
                select(func.count(User.id)).where(
                    User.role == "ADMIN",
                    User.active.is_(True),
                    User.id != user.id,
                )
            )
            or 0
        )
        if other_active_admins == 0:
            raise _conflict("at least one active administrator is required")
    team = _validated_team(db, final_role, final_team_id)
    if "display_name" in supplied:
        user.display_name = payload.display_name
    if "role" in supplied:
        user.role = payload.role
    if "team_id" in supplied or "role" in supplied:
        user.team = team
    if "active" in supplied:
        user.active = payload.active
    if "password" in supplied:
        user.password_hash = hash_password(payload.password)
    if "password" in supplied or ("active" in supplied and not payload.active):
        for auth_session in user.sessions:
            auth_session.revoked_at = utcnow()
    user.updated_at = utcnow()
    audit(db, admin, user, "updated", before, password_reset="password" in supplied)
    db.commit()
    db.refresh(user)
    return user_dict(user)


@router.delete("/users/{user_id}", status_code=204, tags=["administration"])
@router.delete("/accounts/{user_id}", status_code=204, tags=["administration"])
def delete_user(
    user_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Response:
    user = _get_user_or_404(db, user_id)
    if user.id == admin.id:
        raise _conflict("cannot delete the currently signed-in account")
    audit(db, admin, user, "deleted", snapshot(user))
    db.delete(user)
    db.commit()
    return Response(status_code=204)
