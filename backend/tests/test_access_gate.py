from dataclasses import replace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import access_gate
from app.access_gate import (
    ACCESS_COOKIE_NAME,
    ACCESS_TTL_SECONDS,
    SiteAccessGate,
    SiteAccessMiddleware,
    UnlockRateLimiter,
    create_access_router,
)
from app.api import public_router, router
from app.config import get_settings, settings
from app.main import app as production_app


TEST_PASSWORD = "local-test-password"
TEST_SECRET = "test-only-signing-secret-with-at-least-32-bytes"


def make_gate(*, password=TEST_PASSWORD, secret=TEST_SECRET, secure=False):
    return SiteAccessGate(
        replace(
            settings,
            site_access_password=password,
            site_access_secret=secret,
            site_access_secure_cookie=secure,
        )
    )


def make_app(gate):
    app = FastAPI()
    app.add_middleware(SiteAccessMiddleware, gate=gate)
    app.include_router(create_access_router(gate))
    app.include_router(public_router)
    app.include_router(router)

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.get("/private")
    def private():
        return {"protected": True}

    return app


@pytest.fixture()
def gated_client():
    gate = make_gate()
    with TestClient(make_app(gate)) as client:
        yield client, gate


def unlock(client):
    return client.post("/api/access/unlock", json={"password": TEST_PASSWORD})


def test_gate_is_installed_on_production_app():
    assert any(item.cls is SiteAccessMiddleware for item in production_app.user_middleware)
    assert {"/api/access/status", "/api/access/unlock", "/api/access/lock"}.issubset(
        production_app.openapi()["paths"]
    )


def test_wrong_and_correct_password_cookie_and_lock(gated_client):
    client, _ = gated_client
    status = client.get("/api/access/status")
    assert status.json() == {"enabled": True, "unlocked": False}
    assert status.headers["cache-control"] == "no-store"

    wrong = client.post("/api/access/unlock", json={"password": "never-echo-this-password"})
    assert wrong.status_code == 401
    assert wrong.json() == {"detail": "访问口令不正确"}
    assert "never-echo-this-password" not in wrong.text
    assert "set-cookie" not in wrong.headers

    result = unlock(client)
    assert result.status_code == 200
    assert result.json() == {"enabled": True, "unlocked": True}
    assert TEST_PASSWORD not in result.text
    cookie = result.headers["set-cookie"]
    assert "HttpOnly" in cookie
    assert "SameSite=lax" in cookie
    assert "Path=/" in cookie
    assert f"Max-Age={ACCESS_TTL_SECONDS}" in cookie
    assert "Secure" not in cookie
    assert client.get("/api/access/status").json()["unlocked"] is True
    assert client.get("/private").status_code == 200

    locked = client.post("/api/access/lock")
    assert locked.json() == {"enabled": True, "unlocked": False}
    assert "Max-Age=0" in locked.headers["set-cookie"]
    assert client.get("/private").status_code == 423


@pytest.mark.parametrize(
    "path",
    [
        "/api/auth/login",
        "/api/material-transfers",
        "/api/factory-overview/stream",
        "/docs",
        "/redoc",
        "/openapi.json",
        "/docs/oauth2-redirect",
        "/api/access/status/extra",
        "/api/access/unlock/",
        "/api/access/lock/extra",
        "/health/private",
        "/api/health/private",
    ],
)
def test_entire_backend_is_locked_with_exact_not_prefix_exemptions(gated_client, path):
    client, _ = gated_client
    response = client.get(path)
    assert response.status_code == 423
    assert response.json() == {
        "code": "site_access_required",
        "detail": "请先输入访问口令",
    }
    assert response.headers["cache-control"] == "no-store"


def test_health_and_options_are_exempt(gated_client):
    client, _ = gated_client
    assert client.get("/health").status_code == 200
    assert client.get("/api/health").status_code == 200
    assert client.options("/api/material-transfers").status_code != 423


def test_existing_bearer_cannot_bypass_gate_and_unlock_does_not_replace_login(client):
    with TestClient(make_app(make_gate())) as locked:
        locked.headers.update(client.headers)
        assert locked.get("/api/material-transfers").status_code == 423
        assert locked.post(
            "/api/auth/login", json={"username": "admin", "password": "Admin123!"}
        ).status_code == 423
        assert unlock(locked).status_code == 200
        assert locked.get("/api/material-transfers").status_code == 200
        locked.headers.pop("Authorization")
        assert locked.get("/api/material-transfers").status_code == 401
        assert locked.post(
            "/api/auth/login", json={"username": "admin", "password": "Admin123!"}
        ).status_code == 200


def test_disabled_gate_is_backward_compatible(client):
    with TestClient(make_app(make_gate(password="", secret=""))) as unlocked:
        assert unlocked.get("/api/access/status").json() == {
            "enabled": False,
            "unlocked": True,
        }
        assert unlocked.get("/private").status_code == 200
        assert unlocked.get("/docs").status_code == 200
        assert unlocked.get("/api/material-transfers").status_code == 401
        result = unlocked.post("/api/access/unlock", json={"password": "anything"})
        assert result.status_code == 200
        assert "set-cookie" not in result.headers
        assert unlocked.post(
            "/api/auth/login", json={"username": "admin", "password": "Admin123!"}
        ).status_code == 200


@pytest.mark.parametrize("tamper", ["signature", "expiry", "malformed", "oversized"])
def test_tampered_or_malformed_cookie_does_not_unlock(gated_client, tamper):
    client, gate = gated_client
    token = gate.issue_cookie()
    if tamper == "signature":
        prefix, signature = token.rsplit(".", 1)
        token = prefix + "." + ("A" if signature[0] != "A" else "B") + signature[1:]
    elif tamper == "expiry":
        parts = token.split(".")
        parts[2] = str(int(parts[2]) + 1)
        token = ".".join(parts)
    elif tamper == "malformed":
        token = "not-a-real-cookie"
    else:
        token = "x" * 513
    client.cookies.set(ACCESS_COOKIE_NAME, token)
    assert client.get("/api/access/status").json()["unlocked"] is False
    assert client.get("/private").status_code == 423


def test_cookie_expiry_and_future_issue_are_enforced(gated_client, monkeypatch):
    client, _ = gated_client
    issued_at = 2_000_000_000
    monkeypatch.setattr(access_gate.time, "time", lambda: issued_at)
    assert unlock(client).status_code == 200
    token = client.cookies.get(ACCESS_COOKIE_NAME)
    client.cookies.clear()
    client.headers["Cookie"] = f"{ACCESS_COOKIE_NAME}={token}"
    monkeypatch.setattr(access_gate.time, "time", lambda: issued_at + ACCESS_TTL_SECONDS - 1)
    assert client.get("/private").status_code == 200
    monkeypatch.setattr(access_gate.time, "time", lambda: issued_at + ACCESS_TTL_SECONDS)
    assert client.get("/private").status_code == 423
    monkeypatch.setattr(access_gate.time, "time", lambda: issued_at - 1)
    assert client.get("/private").status_code == 423


@pytest.mark.parametrize(
    "new_config",
    [
        {"password": "rotated-test-password"},
        {"secret": "different-signing-secret-with-at-least-32-bytes"},
    ],
)
def test_config_rotation_invalidates_previous_cookies(new_config):
    token = make_gate().issue_cookie()
    with TestClient(make_app(make_gate(**new_config))) as client:
        client.cookies.set(ACCESS_COOKIE_NAME, token)
        assert client.get("/api/access/status").json()["unlocked"] is False
        assert client.get("/private").status_code == 423


def test_secure_cookie_configuration():
    with TestClient(make_app(make_gate(secure=True)), base_url="https://testserver") as client:
        response = unlock(client)
        assert "Secure" in response.headers["set-cookie"]
        assert client.get("/private").status_code == 200


def test_rate_limit_and_forwarded_header_cannot_reset_it(gated_client, monkeypatch):
    client, gate = gated_client
    monotonic = 1_000.0
    monkeypatch.setattr(access_gate.time, "monotonic", lambda: monotonic)
    for number in range(gate.limiter.attempts_per_client):
        wrong = client.post(
            "/api/access/unlock",
            json={"password": "wrong"},
            headers={"X-Forwarded-For": f"203.0.113.{number}"},
        )
        assert wrong.status_code == 401
    limited = unlock(client)
    assert limited.status_code == 429
    assert limited.headers["retry-after"] == str(gate.limiter.window_seconds)
    assert client.get("/api/access/status").status_code == 200
    monotonic += gate.limiter.window_seconds
    assert unlock(client).status_code == 200


def test_success_resets_client_failures_but_global_limit_still_applies(gated_client):
    client, gate = gated_client
    gate.limiter = UnlockRateLimiter(attempts_per_client=3, global_attempts=5)
    for _ in range(2):
        assert client.post("/api/access/unlock", json={"password": "wrong"}).status_code == 401
    assert unlock(client).status_code == 200
    assert client.post("/api/access/unlock", json={"password": "wrong"}).status_code == 401
    assert unlock(client).status_code == 200
    assert unlock(client).status_code == 429


def test_rate_limiter_memory_is_bounded_and_expired_entries_are_removed(monkeypatch):
    now = 1_000.0
    monkeypatch.setattr(access_gate.time, "monotonic", lambda: now)
    limiter = UnlockRateLimiter(max_clients=2, global_attempts=100)
    assert limiter.reserve("one") is None
    assert limiter.reserve("two") is None
    assert limiter.reserve("three") == 300
    assert len(limiter._clients) == 2
    now += 300
    assert limiter.reserve("three") is None
    assert list(limiter._clients) == ["three"]


@pytest.mark.parametrize(
    "body", ['{"password":{"private":"must-not-echo"}}', '"must-not-echo"', "invalid"]
)
def test_invalid_unlock_body_never_echoes_sensitive_input(gated_client, body):
    client, _ = gated_client
    response = client.post("/api/access/unlock", content=body)
    assert response.status_code == 401
    assert "must-not-echo" not in response.text
    assert "input" not in response.json()


def test_unlock_body_is_bounded(gated_client):
    client, _ = gated_client
    response = client.post("/api/access/unlock", json={"password": "x" * 4096})
    assert response.status_code == 400
    assert response.json() == {"detail": "请输入有效的访问口令"}


def test_enabled_configuration_requires_signing_secret(monkeypatch):
    monkeypatch.setenv("SITE_ACCESS_PASSWORD", TEST_PASSWORD)
    monkeypatch.delenv("SITE_ACCESS_SECRET", raising=False)
    with pytest.raises(ValueError, match="SITE_ACCESS_SECRET"):
        get_settings()
    monkeypatch.setenv("SITE_ACCESS_SECRET", "too-short")
    with pytest.raises(ValueError, match="SITE_ACCESS_SECRET"):
        get_settings()
    monkeypatch.setenv("SITE_ACCESS_SECRET", TEST_SECRET)
    assert get_settings().site_access_password == TEST_PASSWORD
    monkeypatch.setenv("SITE_ACCESS_SECURE_COOKIE", "true")
    assert get_settings().site_access_secure_cookie is True
