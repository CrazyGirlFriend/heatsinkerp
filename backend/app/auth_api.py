"""Authentication and public health endpoints."""

from __future__ import annotations

from asyncio import to_thread
from datetime import timezone

from fastapi import Depends, HTTPException, Response
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from .admin_audit import audit, snapshot
from .async_api import AsyncAPIRouter as APIRouter
from .auth import AuthContext, create_session, get_auth_context, hash_password, verify_password
from .database import get_db
from .models import AuthSession, User, utcnow
from .observability import record
from .schemas import (
    HealthResponse,
    LoginRequest,
    LoginResponse,
    PasswordChangeRequest,
    ProfileUpdate,
    UserResponse,
)
from .serializers import user_dict

router = APIRouter(prefix="/api")


@router.get("/health", response_model=HealthResponse, tags=["system"])
def health(db: Session = Depends(get_db)) -> dict:
    try:
        db.execute(text("SELECT 1"))
    except Exception as exc:
        record("health.database_unavailable", error=exc)
        raise HTTPException(status_code=503, detail="database unavailable") from exc
    return {"status": "ok", "database": "ok"}


@router.post("/auth/login", response_model=LoginResponse, tags=["authentication"])
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)) -> dict:
    user = await db.scalar(select(User).where(User.username == payload.username))
    verified_hash = user.password_hash if user else None
    if (
        user is None
        or not user.active
        or (user.role == "TEAM" and (user.team is None or not user.team.active))
        or not await to_thread(verify_password, payload.password, verified_hash)
    ):
        raise HTTPException(status_code=401, detail="invalid username or password")
    # Credential changes may have committed while password verification ran.
    await db.execute(update(User).where(User.id == user.id).values(updated_at=User.updated_at))
    user = await db.scalar(
        select(User)
        .where(User.id == user.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if (
        user is None
        or user.password_hash != verified_hash
        or not user.active
        or (user.role == "TEAM" and (user.team is None or not user.team.active))
    ):
        raise HTTPException(status_code=401, detail="invalid username or password")
    raw_token, auth_session = await db.run_sync(lambda session: create_session(session, user))
    await db.commit()
    return {
        "access_token": raw_token,
        "token_type": "bearer",
        "expires_at": auth_session.expires_at.replace(tzinfo=timezone.utc),
        "user": user_dict(user),
    }


@router.get("/auth/me", response_model=UserResponse, tags=["authentication"])
def auth_me(context: AuthContext = Depends(get_auth_context)) -> dict:
    return user_dict(context.user)


@router.patch("/auth/me", response_model=UserResponse, tags=["authentication"])
def update_profile(
    payload: ProfileUpdate,
    context: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
) -> dict:
    # Resolve the target exclusively from the authenticated session.
    user = db.scalar(
        select(User)
        .where(User.id == context.user.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    before = snapshot(user)
    for field in payload.model_fields_set:
        setattr(user, field, getattr(payload, field))
    audit(db, user, user, "updated", before)
    db.commit()
    db.refresh(user)
    return user_dict(user)


@router.post("/auth/logout", status_code=204, tags=["authentication"])
def logout(
    context: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
) -> Response:
    context.session.revoked_at = utcnow()
    db.commit()
    return Response(status_code=204)


@router.post("/auth/change-password", status_code=204, tags=["authentication"])
async def change_password(
    payload: PasswordChangeRequest,
    context: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
) -> Response:
    # Match login's account-first lock order, including SQLite's write lock.
    await db.execute(
        update(User).where(User.id == context.user.id).values(updated_at=User.updated_at)
    )
    user = await db.scalar(
        select(User)
        .where(User.id == context.user.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    session = await db.scalar(
        select(AuthSession)
        .where(AuthSession.id == context.session.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if (
        user is None
        or session is None
        or session.revoked_at is not None
        or session.expires_at <= utcnow()
        or not user.active
        or (user.role == "TEAM" and (user.team is None or not user.team.active))
    ):
        raise HTTPException(status_code=401, detail="invalid or expired access token")
    if not await to_thread(verify_password, payload.old_password, user.password_hash):
        raise HTTPException(status_code=422, detail="旧密码不正确")
    if payload.old_password == payload.new_password:
        raise HTTPException(status_code=422, detail="新密码不能与旧密码相同")
    before = snapshot(user)
    user.password_hash = await to_thread(hash_password, payload.new_password)
    user.updated_at = utcnow()
    sessions = await db.scalars(
        select(AuthSession)
        .where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None))
        .with_for_update()
    )
    for previous in sessions:
        previous.revoked_at = user.updated_at
    await db.run_sync(
        lambda sync_db: audit(sync_db, user, user, "updated", before, password_reset=True)
    )
    await db.commit()
    record("auth.password_changed", user_id=user.id)
    return Response(status_code=204)
