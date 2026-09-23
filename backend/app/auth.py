from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import timedelta

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .database import get_db
from .models import AuthSession, User, utcnow


PBKDF2_ITERATIONS = 310_000
bearer_scheme = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS
    )
    return "$".join(
        (
            "pbkdf2_sha256",
            str(PBKDF2_ITERATIONS),
            base64.urlsafe_b64encode(salt).decode("ascii"),
            base64.urlsafe_b64encode(digest).decode("ascii"),
        )
    )


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations, salt_value, expected_value = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = base64.urlsafe_b64decode(salt_value.encode("ascii"))
        expected = base64.urlsafe_b64decode(expected_value.encode("ascii"))
        actual = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt, int(iterations)
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(db: Session, user: User) -> tuple[str, AuthSession]:
    raw_token = secrets.token_urlsafe(32)
    auth_session = AuthSession(
        user=user,
        token_hash=token_digest(raw_token),
        expires_at=utcnow() + timedelta(hours=settings.session_ttl_hours),
    )
    db.add(auth_session)
    db.flush()
    return raw_token, auth_session


@dataclass(frozen=True, slots=True)
class AuthContext:
    user: User
    session: AuthSession


def read_auth_context(credentials, db: Session) -> AuthContext:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="invalid or expired access token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise unauthorized
    auth_session = db.scalar(
        select(AuthSession).where(
            AuthSession.token_hash == token_digest(credentials.credentials)
        )
    )
    if (
        auth_session is None
        or auth_session.revoked_at is not None
        or auth_session.expires_at <= utcnow()
        or not auth_session.user.active
        or (
            auth_session.user.role == "TEAM"
            and (
                auth_session.user.team is None
                or not auth_session.user.team.active
            )
        )
    ):
        raise unauthorized
    # Authentication shares the request-scoped SQLAlchemy session with the
    # endpoint. End this read transaction so write endpoints can start their
    # explicit row-locking transaction; objects remain usable because the
    # session factory has expire_on_commit=False.
    db.commit()
    return AuthContext(user=auth_session.user, session=auth_session)


async def get_auth_context(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> AuthContext:
    return await db.run_sync(lambda session: read_auth_context(credentials, session))


async def get_current_user(context: AuthContext = Depends(get_auth_context)) -> User:
    return context.user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "ADMIN":
        raise HTTPException(status_code=403, detail="administrator role required")
    return user


def actor_name(user: User) -> str:
    return user.display_name or user.username


def ensure_initial_admin(db: Session) -> None:
    if db.scalar(
        select(User.id).where(User.role == "ADMIN", User.active.is_(True)).limit(1)
    ) is not None:
        return
    user = db.scalar(
        select(User).where(User.username == settings.seed_admin_username)
    )
    if user is not None:
        if user.role != "ADMIN":
            raise RuntimeError(
                "SEED_ADMIN_USERNAME belongs to a non-administrator account"
            )
        user.active = True
        user.password_hash = hash_password(settings.seed_admin_password)
    else:
        user = User(
            username=settings.seed_admin_username,
            display_name=settings.seed_admin_display_name,
            password_hash=hash_password(settings.seed_admin_password),
            role="ADMIN",
            team_id=None,
            active=True,
        )
        db.add(user)
    db.commit()
