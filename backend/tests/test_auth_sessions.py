"""Account session limits, released slots, and simultaneous login requests."""

import asyncio
from datetime import timedelta
from threading import Barrier

import httpx
import pytest
from sqlalchemy import func, select

from app.auth import create_session, token_digest
from app.database import SessionLocal
from app.main import app
from app.models import AuthSession, User, utcnow
from test_material_transfers import _leader, _team


def login(client, username="admin", password="Admin123!"):
    return client.post("/api/auth/login", json={"username": username, "password": password})


def headers(response):
    assert response.status_code == 200, response.text
    return {"Authorization": "Bearer " + response.json()["access_token"]}


def active_count(username="admin"):
    with SessionLocal() as db:
        return db.scalar(
            select(func.count(AuthSession.id))
            .join(User)
            .where(
                User.username == username,
                AuthSession.revoked_at.is_(None),
                AuthSession.expires_at > utcnow(),
            )
        )


@pytest.mark.parametrize("role", ["ADMIN", "TEAM"])
def test_fourth_login_replaces_only_the_oldest_session(client, role):
    username, password = "admin", "Admin123!"
    first = dict(client.headers)
    if role == "TEAM":
        team = _team(client, "SESSION-LIMIT", "会话测试")
        _, first = _leader(client, "session-leader", team["id"])
        username, password = "session-leader", "Leader123!"
    second = headers(login(client, username, password))
    assert login(client, username, "wrong").status_code == 401
    assert client.get("/api/auth/me", headers=first).status_code == 200
    third = headers(login(client, username, password))
    assert active_count(username) == 3
    for session in [first, second, third]:
        assert client.get("/api/auth/me", headers=session).status_code == 200
    fourth = headers(login(client, username, password))
    assert active_count(username) == 3
    assert client.get("/api/auth/me", headers=first).status_code == 401
    for session in [second, third, fourth]:
        assert client.get("/api/auth/me", headers=session).status_code == 200


def test_logout_releases_one_slot_and_old_token_stays_invalid(client):
    second = headers(login(client))
    assert client.post("/api/auth/logout", headers=second).status_code == 204
    assert client.get("/api/auth/me", headers=second).status_code == 401
    headers(login(client))
    assert active_count() == 2
    assert client.get("/api/auth/me").status_code == 200


@pytest.mark.parametrize("released", ["expired", "revoked"])
def test_expired_or_revoked_session_does_not_occupy_a_slot(client, released):
    second = headers(login(client))
    with SessionLocal() as db:
        session = db.scalar(
            select(AuthSession).where(
                AuthSession.token_hash == token_digest(second["Authorization"].split()[1])
            )
        )
        if released == "expired":
            session.expires_at = utcnow() - timedelta(seconds=1)
        else:
            session.revoked_at = utcnow()
        db.commit()
    headers(login(client))
    assert active_count() == 2
    assert client.get("/api/auth/me", headers=second).status_code == 401
    assert client.get("/api/auth/me").status_code == 200


def test_limit_is_per_account_and_profile_reads_do_not_take_slots(client):
    second = headers(login(client))
    team = _team(client, "SEPARATE-SESSION", "独立会话")
    _, other = _leader(client, "independent-leader", team["id"])
    assert client.get("/api/auth/me", headers=other).status_code == 200
    for _ in range(5):
        assert client.get("/api/auth/me").status_code == 200
    headers(login(client))
    assert client.get("/api/auth/me").status_code == 200
    headers(login(client))
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me", headers=second).status_code == 200
    assert client.get("/api/auth/me", headers=other).status_code == 200
    assert active_count() == 3
    assert active_count("independent-leader") == 1


def test_simultaneous_logins_cannot_exceed_three(client, monkeypatch):
    from app import auth_api

    barrier = Barrier(6)
    original = auth_api.verify_password

    def synchronized_verify(*args):
        result = original(*args)
        barrier.wait(timeout=10)
        return result

    monkeypatch.setattr(auth_api, "verify_password", synchronized_verify)

    async def concurrent_logins():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as http:
            return await asyncio.gather(
                *(
                    http.post(
                        "/api/auth/login", json={"username": "admin", "password": "Admin123!"}
                    )
                    for _ in range(6)
                )
            )

    responses = asyncio.run(concurrent_logins())
    assert [response.status_code for response in responses] == [200] * 6
    assert active_count() == 3
    assert client.get("/api/auth/me").status_code == 401
    with SessionLocal() as db:
        sessions = db.scalars(select(AuthSession).order_by(AuthSession.created_at.desc(), AuthSession.id.desc())).all()
        assert all(session.revoked_at is None for session in sessions[:3])
        assert all(session.revoked_at is not None for session in sessions[3:])
        active_tokens = {session.token_hash for session in sessions[:3]}
    for response in responses:
        expected = 200 if token_digest(response.json()["access_token"]) in active_tokens else 401
        assert client.get("/api/auth/me", headers=headers(response)).status_code == expected


@pytest.mark.parametrize("same_time", [False, True])
def test_oldest_is_by_login_time_with_id_as_tiebreaker(client, same_time):
    first = dict(client.headers)
    second = headers(login(client))
    third = headers(login(client))
    with SessionLocal() as db:
        sessions = db.scalars(select(AuthSession).order_by(AuthSession.id)).all()
        sessions[0].created_at = utcnow() - timedelta(minutes=1)
        sessions[1].created_at = sessions[0].created_at - timedelta(minutes=0 if same_time else 1)
        db.commit()
    headers(login(client))
    assert client.get("/api/auth/me", headers=first).status_code == (401 if same_time else 200)
    assert client.get("/api/auth/me", headers=second).status_code == (200 if same_time else 401)
    assert client.get("/api/auth/me", headers=third).status_code == 200


def test_login_reduces_legacy_sessions_to_three(client):
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.username == "admin"))
        now = utcnow()
        for index in range(3):
            db.add(AuthSession(user_id=user.id, token_hash=token_digest(f"legacy-{index}"),
                               created_at=now - timedelta(minutes=index + 1), expires_at=now + timedelta(hours=1)))
        db.commit()
    new = headers(login(client))
    assert active_count() == 3
    assert client.get("/api/auth/me").status_code == 200
    assert client.get("/api/auth/me", headers=new).status_code == 200


def test_failed_login_transaction_does_not_revoke_existing_sessions(client, monkeypatch):
    second = headers(login(client))

    def fail_token(_size):
        raise RuntimeError("test session creation failure")

    monkeypatch.setattr("app.auth.secrets.token_urlsafe", fail_token)
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.username == "admin"))
        with pytest.raises(RuntimeError, match="test session creation failure"):
            create_session(db, user)
        db.rollback()
    assert active_count() == 2
    assert client.get("/api/auth/me").status_code == 200
    assert client.get("/api/auth/me", headers=second).status_code == 200
