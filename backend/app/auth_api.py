"""Authentication and public health endpoints."""

from __future__ import annotations

from datetime import timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .auth import AuthContext, create_session, get_auth_context, verify_password
from .database import get_db
from .models import User, utcnow
from .observability import record
from .schemas import HealthResponse, LoginRequest, LoginResponse, UserResponse
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
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> dict:
    user = db.scalar(select(User).where(User.username == payload.username))
    if (
        user is None
        or not user.active
        or (user.role == "TEAM" and (user.team is None or not user.team.active))
        or not verify_password(payload.password, user.password_hash)
    ):
        raise HTTPException(status_code=401, detail="invalid username or password")
    raw_token, auth_session = create_session(db, user)
    db.commit()
    return {
        "access_token": raw_token,
        "token_type": "bearer",
        "expires_at": auth_session.expires_at.replace(tzinfo=timezone.utc),
        "user": user_dict(user),
    }


@router.get("/auth/me", response_model=UserResponse, tags=["authentication"])
def auth_me(context: AuthContext = Depends(get_auth_context)) -> dict:
    return user_dict(context.user)


@router.post("/auth/logout", status_code=204, tags=["authentication"])
def logout(
    context: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
) -> Response:
    context.session.revoked_at = utcnow()
    db.commit()
    return Response(status_code=204)
