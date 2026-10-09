"""Self-service password changes verify credentials and revoke every session."""

import asyncio
import json
from threading import Event

import httpx
import pytest
from app.auth import verify_password
from app.database import SessionLocal
from app.main import app
from app.models import AdminAuditEvent, AuthSession, User
from sqlalchemy import event, select
from test_auth_sessions import headers, login
from test_material_transfers import _leader, _team


@pytest.mark.parametrize("role", ["ADMIN", "TEAM"])
def test_change_own_password_revokes_all_sessions_and_preserves_identity(client, role):
    username, password = "admin", "Admin123!"
    first = dict(client.headers)
    if role == "TEAM":
        team = _team(client, "PASSWORD", "密码测试")
        _, first = _leader(client, "password-leader", team["id"])
        username, password = "password-leader", "Leader123!"
    before = client.get("/api/auth/me", headers=first).json()
    second = headers(login(client, username, password))
    third = headers(login(client, username, password))
    response = client.post(
        "/api/auth/change-password",
        headers=first,
        json={"old_password": password, "new_password": "New password 123! "},
    )
    assert response.status_code == 204, response.text
    assert response.content == b""
    for session in [first, second, third]:
        assert client.get("/api/auth/me", headers=session).status_code == 401
    assert login(client, username, password).status_code == 401
    current = headers(login(client, username, "New password 123! "))
    after = client.get("/api/auth/me", headers=current).json()
    for field in ["id", "username", "display_name", "avatar_key", "role", "team_id", "active"]:
        assert after[field] == before[field]
    with SessionLocal() as db:
        user = db.get(User, before["id"])
        assert verify_password("New password 123! ", user.password_hash)
        audit = db.scalar(
            select(AdminAuditEvent)
            .where(AdminAuditEvent.target_id == user.id)
            .order_by(AdminAuditEvent.id.desc())
        )
        assert audit.actor_user_id == user.id and audit.changes["password_reset"]
        stored = json.dumps(audit.changes)
        assert password not in stored and "New password 123! " not in stored
        assert user.password_hash not in stored


@pytest.mark.parametrize(
    "body",
    [
        {"old_password": "incorrect", "new_password": "Changed123!"},
        {"old_password": "Admin123!", "new_password": "Admin123!"},
        {"old_password": "Admin123!", "new_password": "short"},
        {"old_password": "", "new_password": "Changed123!"},
        {"old_password": "Admin123!", "new_password": "x" * 201},
        {"new_password": "Changed123!"},
        {"old_password": "Admin123!", "new_password": "Changed123!", "user_id": 999},
    ],
)
def test_invalid_password_change_keeps_credentials_and_sessions(client, body):
    before = client.get("/api/auth/me").json()
    with SessionLocal() as db:
        old_hash = db.get(User, before["id"]).password_hash
        audit_count = len(db.scalars(select(AdminAuditEvent)).all())
    response = client.post("/api/auth/change-password", json=body)
    assert response.status_code == 422
    detail = response.json()["detail"]
    if isinstance(detail, list):
        assert all("input" not in error for error in detail)
    else:
        for field in ["old_password", "new_password"]:
            if body.get(field):
                assert body[field] not in detail
    assert client.get("/api/auth/me").status_code == 200
    with SessionLocal() as db:
        assert db.get(User, before["id"]).password_hash == old_hash
        assert len(db.scalars(select(AdminAuditEvent)).all()) == audit_count


def test_password_change_requires_login_and_cannot_use_revoked_session(client):
    first = dict(client.headers)
    client.headers.pop("Authorization")
    payload = {"old_password": "Admin123!", "new_password": "Changed123!"}
    assert client.post("/api/auth/change-password", json=payload).status_code == 401
    assert client.post("/api/auth/logout", headers=first).status_code == 204
    assert client.post("/api/auth/change-password", headers=first, json=payload).status_code == 401


def test_failed_audit_rolls_back_password_and_session_changes(client):
    def fail(*_):
        raise RuntimeError("audit unavailable")

    event.listen(AdminAuditEvent, "before_insert", fail)
    try:
        assert (
            client.post(
                "/api/auth/change-password",
                json={"old_password": "Admin123!", "new_password": "Changed123!"},
            ).status_code
            == 500
        )
    finally:
        event.remove(AdminAuditEvent, "before_insert", fail)
    assert client.get("/api/auth/me").status_code == 200
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.username == "admin"))
        assert verify_password("Admin123!", user.password_hash)
        assert all(s.revoked_at is None for s in db.scalars(select(AuthSession)).all())


def test_login_verified_before_password_change_cannot_issue_a_new_session(client, monkeypatch):
    from app import auth_api

    verified, resume = Event(), Event()
    original = auth_api.verify_password
    calls = 0

    def delayed_verify(*args):
        nonlocal calls
        calls += 1
        first = calls == 1
        result = original(*args)
        if first:
            verified.set()
            assert resume.wait(10)
        return result

    monkeypatch.setattr(auth_api, "verify_password", delayed_verify)

    async def run():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as http:
            pending = asyncio.create_task(
                http.post("/api/auth/login", json={"username": "admin", "password": "Admin123!"})
            )
            try:
                assert await asyncio.to_thread(verified.wait, 10)
                changed = await http.post(
                    "/api/auth/change-password",
                    headers=dict(client.headers),
                    json={"old_password": "Admin123!", "new_password": "Changed123!"},
                )
                assert changed.status_code == 204
            finally:
                resume.set()
            assert (await pending).status_code == 401

    asyncio.run(run())
    assert login(client, "admin", "Changed123!").status_code == 200


def test_two_simultaneous_changes_cannot_reuse_a_revoked_session(client):
    async def run():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as http:
            return await asyncio.gather(
                *[
                    http.post(
                        "/api/auth/change-password",
                        headers=dict(client.headers),
                        json={"old_password": "Admin123!", "new_password": new_password},
                    )
                    for new_password in ["Changed123!", "Other123!"]
                ]
            )

    responses = asyncio.run(run())
    assert sorted(response.status_code for response in responses) == [204, 401]
    assert client.get("/api/auth/me").status_code == 401
    new_password = ["Changed123!", "Other123!"][
        next(index for index, response in enumerate(responses) if response.status_code == 204)
    ]
    assert login(client, "admin", new_password).status_code == 200
