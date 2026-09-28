"""Account session limits, released slots, and simultaneous login requests."""

import asyncio
from datetime import timedelta
from threading import Barrier

import httpx
import pytest
from sqlalchemy import func, select

from app.auth import token_digest
from app.database import SessionLocal
from app.main import app
from app.models import AuthSession, User, utcnow
from test_material_transfers import _leader, _team

LIMIT_MESSAGE = "该账号已在 3 个会话中登录，请先在其他浏览器或设备退出后再登录"


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
def test_fourth_login_is_rejected_without_displacing_existing_sessions(client, role):
    username, password = "admin", "Admin123!"
    first = dict(client.headers)
    if role == "TEAM":
        team = _team(client, "SESSION-LIMIT", "会话测试")
        _, first = _leader(client, "session-leader", team["id"])
        username, password = "session-leader", "Leader123!"
    sessions = [
        first,
        headers(login(client, username, password)),
        headers(login(client, username, password)),
    ]
    rejected = login(client, username, password)
    assert rejected.status_code == 409
    assert rejected.json() == {"detail": LIMIT_MESSAGE}
    assert active_count(username) == 3
    for session in sessions:
        assert client.get("/api/auth/me", headers=session).status_code == 200
    assert login(client, username, "wrong").status_code == 401


def test_logout_releases_one_slot_and_old_token_stays_invalid(client):
    second = headers(login(client))
    headers(login(client))
    assert login(client).status_code == 409
    assert client.post("/api/auth/logout", headers=second).status_code == 204
    assert client.get("/api/auth/me", headers=second).status_code == 401
    headers(login(client))
    assert active_count() == 3
    assert login(client).status_code == 409


@pytest.mark.parametrize("released", ["expired", "revoked"])
def test_expired_or_revoked_session_does_not_occupy_a_slot(client, released):
    second = headers(login(client))
    headers(login(client))
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
    assert active_count() == 3
    assert client.get("/api/auth/me", headers=second).status_code == 401


def test_limit_is_per_account_and_profile_reads_do_not_take_slots(client):
    headers(login(client))
    headers(login(client))
    team = _team(client, "SEPARATE-SESSION", "独立会话")
    _, other = _leader(client, "independent-leader", team["id"])
    assert client.get("/api/auth/me", headers=other).status_code == 200
    for _ in range(5):
        assert client.get("/api/auth/me").status_code == 200
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
    assert sorted(response.status_code for response in responses) == [200, 200, 409, 409, 409, 409]
    assert active_count() == 3
    for response in responses:
        if response.status_code == 200:
            assert client.get("/api/auth/me", headers=headers(response)).status_code == 200
