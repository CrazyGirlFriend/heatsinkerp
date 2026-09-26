from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app import monitor_api
from app.access_gate import SiteAccessGate
from app.main import app


@pytest.fixture()
def monitor_token(tmp_path, monkeypatch):
    path = tmp_path / "monitor-token"
    path.write_text("a" * 64)
    monkeypatch.setattr(monitor_api, "settings", replace(monitor_api.settings, monitor_token_file=str(path)))
    return "a" * 64


def test_disabled_by_default_even_for_admin(client):
    assert client.get("/internal/monitor").status_code == 404


def test_monitor_auth_is_separate_and_no_business_privilege(client, monitor_token):
    assert client.get("/internal/monitor").status_code == 401
    auth = {"Authorization": f"Bearer {monitor_token}"}
    assert client.get("/internal/monitor", headers=auth).status_code == 200
    assert client.get("/api/auth/me", headers=auth).status_code == 401
    assert "/internal/monitor" not in app.openapi()["paths"]


def test_locked_site_still_allows_only_authenticated_monitor(client, monitor_token, monkeypatch):
    gate = SiteAccessGate(replace(monitor_api.settings, site_access_password="locked", site_access_secret="s" * 64))
    # Middleware already references the original gate; change its fields for this test.
    monkeypatch.setattr(app.state.site_access_gate, "enabled", gate.enabled)
    assert client.get("/internal/monitor").status_code == 401
    response = client.get("/internal/monitor", headers={"Authorization": f"Bearer {monitor_token}"})
    assert response.status_code == 200
    assert client.get("/api/teams", headers={"Authorization": f"Bearer {monitor_token}"}).status_code == 423


def test_only_status_no_secrets_or_payloads(client, monitor_token):
    service = app.state.notifications
    original = service.tasks
    service.tasks = [Mock(done=lambda: False), Mock(done=lambda: False)]
    try:
        response = client.get("/internal/monitor", headers={"Authorization": f"Bearer {monitor_token}"})
        assert response.json() == {
            "database": "ok", "notifications": {
                "connection": "connected", "tasks_running": True, "pending": 0, "oldest_pending_seconds": 0,
            },
        }
        service.tasks[0] = Mock(done=lambda: True)
        assert not client.get("/internal/monitor", headers={"Authorization": f"Bearer {monitor_token}"}).json()["notifications"]["tasks_running"]
    finally:
        service.tasks = original


def test_database_failure_reported_without_secret(client, monitor_token, monkeypatch):
    def broken():
        raise RuntimeError("mysql://secret-password")
    monkeypatch.setattr(monitor_api, "AsyncSessionLocal", broken)
    response = client.get("/internal/monitor", headers={"Authorization": f"Bearer {monitor_token}"})
    assert response.status_code == 200
    assert response.json()["database"] == "unavailable"
    assert response.json()["notifications"]["pending"] is None
    assert "secret-password" not in response.text


def test_bad_token_file_fails_closed(client, monitor_token, monkeypatch):
    monkeypatch.setattr(monitor_api, "settings", SimpleNamespace(monitor_token_file="/nonexistent/monitor-token"))
    assert client.get("/internal/monitor", headers={"Authorization": f"Bearer {monitor_token}"}).status_code == 503
