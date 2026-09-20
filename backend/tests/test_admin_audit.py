import json

from app.database import SessionLocal
from app.models import AdminAuditEvent, Team
from sqlalchemy import event, select


def events():
    with SessionLocal() as db:
        return db.scalars(select(AdminAuditEvent).order_by(AdminAuditEvent.id)).all()


def test_admin_mutations_preserve_history_without_credentials(client):
    team = client.post("/api/teams", json={"code": "AUDIT", "name": "审计班组"}).json()
    user_response = client.post(
        "/api/accounts",
        json={
            "username": "audited",
            "display_name": "班长",
            "password": "NeverLogMe123!",
            "role": "TEAM",
            "team_id": team["id"],
        },
    )
    assert user_response.status_code == 201
    user = user_response.json()
    assert (
        client.patch(
            f"/api/accounts/{user['id']}",
            json={
                "active": False,
                "password": "AnotherSecret123!",
            },
        ).status_code
        == 200
    )
    assert client.patch(f"/api/teams/{team['id']}", json={"name": "修改名称"}).status_code == 200
    assert client.delete(f"/api/accounts/{user['id']}").status_code == 204
    assert client.delete(f"/api/teams/{team['id']}").status_code == 204
    history = events()
    assert [row.action for row in history] == [
        "created",
        "created",
        "updated",
        "updated",
        "deleted",
        "deleted",
    ]
    assert all(
        row.actor == "系统管理员" or row.actor == "管理员" or row.actor == "admin"
        for row in history
    )
    assert all(row.actor_user_id and len(row.request_id) == 32 for row in history)
    assert history[1].request_id == user_response.headers["x-request-id"]
    assert history[1].changes["after"]["team_id"] == team["id"]
    assert history[2].changes["password_reset"] is True
    assert history[2].changes["before"]["active"] is True
    assert history[2].changes["after"]["active"] is False
    assert history[-1].changes["before"]["name"] == "修改名称"
    serialized = json.dumps([row.changes for row in history])
    assert "NeverLogMe" not in serialized and "AnotherSecret" not in serialized
    assert "password_hash" not in serialized


def test_failed_or_unauthorized_mutation_does_not_create_audit(client):
    assert client.post("/api/teams", json={"code": "DUP", "name": "重复"}).status_code == 201
    assert client.post("/api/teams", json={"code": "DUP", "name": "重复"}).status_code == 409
    client.headers.pop("Authorization")
    assert client.post("/api/teams", json={"code": "NO", "name": "无权限"}).status_code == 401
    assert len(events()) == 1


def test_audit_failure_rolls_back_business_write(client):
    def fail(mapper, connection, target):
        raise RuntimeError("audit storage failed")

    event.listen(AdminAuditEvent, "before_insert", fail)
    try:
        response = client.post("/api/teams", json={"code": "ROLLBACK", "name": "应回滚"})
        assert response.status_code == 500
    finally:
        event.remove(AdminAuditEvent, "before_insert", fail)
    with SessionLocal() as db:
        assert db.scalar(select(Team).where(Team.code == "ROLLBACK")) is None
    assert events() == []


def test_password_only_reset_is_audited_and_team_rebinding_uses_new_id(client):
    first = client.post("/api/teams", json={"code": "ONE", "name": "一班"}).json()
    second = client.post("/api/teams", json={"code": "TWO", "name": "二班"}).json()
    account = client.post(
        "/api/users",
        json={
            "username": "leader",
            "display_name": "班长",
            "password": "Original123!",
            "role": "TEAM",
            "team_id": first["id"],
        },
    ).json()
    assert (
        client.patch(f"/api/users/{account['id']}", json={"team_id": second["id"]}).status_code
        == 200
    )
    assert events()[-1].changes["after"]["team_id"] == second["id"]
    assert (
        client.patch(f"/api/users/{account['id']}", json={"password": "Replaced123!"}).status_code
        == 200
    )
    last = events()[-1]
    assert last.changes["before"] == last.changes["after"]
    assert last.changes["password_reset"] is True
