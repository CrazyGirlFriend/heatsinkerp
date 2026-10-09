"""Own-profile editing, administrator maintenance and preset persistence."""

import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from app.database import SessionLocal
from app.models import AdminAuditEvent, TeamSettingEvent
from sqlalchemy import create_engine, event, select, text
from test_material_transfers import _leader, _team


@pytest.mark.parametrize("role", ["ADMIN", "TEAM"])
def test_own_profile_persists_without_changing_login_or_permissions(client, role):
    headers = dict(client.headers)
    if role == "TEAM":
        team = _team(client, "PROFILE", "个人资料测试")
        _, headers = _leader(client, "profile-leader", team["id"])
    before = client.get("/api/auth/me", headers=headers).json()
    updated = client.patch(
        "/api/auth/me",
        headers=headers,
        json={"display_name": " 张师傅 ", "avatar_key": "portrait-3"},
    )
    assert updated.status_code == 200, updated.text
    user = updated.json()
    assert user["display_name"] == "张师傅" and user["avatar_key"] == "portrait-3"
    for field in ("id", "username", "role", "team_id", "active"):
        assert user[field] == before[field]
    assert client.get("/api/auth/me", headers=headers).json() == user
    with SessionLocal() as db:
        history = db.scalars(select(AdminAuditEvent).order_by(AdminAuditEvent.id)).all()
        assert history[-1].actor_user_id == before["id"]
        assert history[-1].changes["before"]["avatar_key"] == ""
        assert history[-1].changes["after"]["avatar_key"] == "portrait-3"


@pytest.mark.parametrize(
    "body",
    [
        {"role": "ADMIN"},
        {"team_id": 100},
        {"active": False},
        {"id": 99},
        {"username": "other"},
        {"password": "Other123!"},
        {"display_name": "  "},
        {"display_name": None},
        {"avatar_key": None},
        {"avatar_key": "portrait-9"},
        {"avatar_key": "https://external.example/avatar.svg"},
    ],
)
def test_self_endpoint_rejects_permission_fields_and_invalid_profiles(client, body):
    before = client.get("/api/auth/me").json()
    assert client.patch("/api/auth/me", json=body).status_code == 422
    assert client.get("/api/auth/me").json() == before


def test_team_leader_cannot_edit_other_accounts_or_team_metadata(client):
    team = _team(client, "PROFILE-A", "甲班组")
    _, headers = _leader(client, "profile-a", team["id"])
    assert (
        client.patch(
            "/api/accounts/1", headers=headers, json={"avatar_key": "portrait-1"}
        ).status_code
        == 403
    )
    assert (
        client.patch(f"/api/teams/{team['id']}", headers=headers, json={"name": "改名"}).status_code
        == 403
    )
    client.headers.pop("Authorization")
    assert client.patch("/api/auth/me", json={"display_name": "未登录"}).status_code == 401


def test_admin_edits_other_profile_and_business_but_cannot_operate_its_stock(client):
    team = _team(client, "PROFILE-B", "乙班组")
    leader, own_headers = _leader(client, "profile-b", team["id"])
    response = client.patch(
        f"/api/accounts/{leader['id']}", json={"display_name": "李师傅", "avatar_key": "portrait-8"}
    )
    assert response.status_code == 200, response.text
    assert client.get("/api/auth/me", headers=own_headers).json()["avatar_key"] == "portrait-8"
    assert (
        client.patch(
            f"/api/teams/{team['id']}", json={"name": "乙生产班组", "description": "负责整理物料"}
        ).status_code
        == 200
    )
    root = f"/api/team-materials/{team['id']}"
    created = client.post(root + "/purposes", json={"name": "业务 1"})
    assert created.status_code == 201, created.text
    purpose = created.json()
    assert (
        client.patch(
            root + f"/purposes/{purpose['id']}", json={"name": "业务 2", "expected_version": 1}
        ).status_code
        == 200
    )
    assert (
        client.patch(
            root + f"/purposes/{purpose['id']}", json={"name": "旧版本", "expected_version": 1}
        ).status_code
        == 409
    )
    assert (
        client.post(
            root + "/opening-stock",
            json={
                "idempotency_key": "admin-stock",
                "lines": [
                    {
                        "serial_no": "S",
                        "material_name": "M",
                        "material_type": "raw_material",
                        "quantity": 1,
                        "weight": 1,
                    }
                ],
            },
        ).status_code
        == 403
    )
    assert (
        client.post("/api/team-materials/999999/purposes", json={"name": "业务"}).status_code == 404
    )
    with SessionLocal() as db:
        events = db.scalars(
            select(TeamSettingEvent).where(TeamSettingEvent.team_id == team["id"])
        ).all()
        assert len(events) == 2


def test_failed_profile_audit_rolls_back_update(client):
    before = client.get("/api/auth/me").json()

    def fail(*_):
        raise RuntimeError("audit unavailable")

    event.listen(AdminAuditEvent, "before_insert", fail)
    try:
        assert (
            client.patch(
                "/api/auth/me", json={"display_name": "不能保存", "avatar_key": "portrait-1"}
            ).status_code
            == 500
        )
    finally:
        event.remove(AdminAuditEvent, "before_insert", fail)
    assert client.get("/api/auth/me").json() == before


def test_avatar_migration_preserves_existing_profiles_and_supports_rollback():
    path = Path(__file__).parents[1] / "alembic/versions/20261009_0029_user_avatar.py"
    spec = importlib.util.spec_from_file_location("user_avatar_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "CREATE TABLE users (id INTEGER PRIMARY KEY, display_name VARCHAR(80) NOT NULL)"
                )
            )
            connection.execute(text("INSERT INTO users VALUES (1, '原姓名')"))
            with Operations.context(MigrationContext.configure(connection)):
                module.upgrade()
                assert connection.execute(
                    text("SELECT display_name, avatar_key FROM users")
                ).one() == ("原姓名", "")
                connection.execute(text("UPDATE users SET avatar_key='portrait-2'"))
                module.upgrade()
                assert (
                    connection.execute(text("SELECT avatar_key FROM users")).scalar()
                    == "portrait-2"
                )
                module.downgrade()
            assert connection.execute(text("SELECT display_name FROM users")).scalar() == "原姓名"
    finally:
        engine.dispose()
