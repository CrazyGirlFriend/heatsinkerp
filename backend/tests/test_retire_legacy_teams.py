import pytest
from app.database import SessionLocal
from app.models import AdminAuditEvent, LegacyRecord, Team, TeamPurpose
from app.retire_legacy_teams import retire_legacy_teams
from sqlalchemy import select


def legacy_teams(client):
    actor = client.get("/api/auth/me").json()["id"]
    with SessionLocal() as db:
        warehouse = Team(code="FACTORY-WAREHOUSE", name="库房", kind="warehouse")
        qc = Team(code="FACTORY-QC", name="检验")
        scrap = Team(code="FACTORY-SCRAP", name="转废", kind="scrap", active=False)
        ship = Team(code="FACTORY-SHIP", name="发货")
        db.add_all([warehouse, qc, scrap, ship])
        db.commit()
        return actor, scrap.id, ship.id


def test_retirement_removes_only_unreferenced_teams_and_audits(client):
    actor, scrap, ship = legacy_teams(client)
    with SessionLocal() as db:
        result = retire_legacy_teams(db, actor)
        db.commit()
        assert [row["historical_rows_reassigned"] for row in result] == [0, 0]
        assert db.get(Team, scrap) is None and db.get(Team, ship) is None
        audits = db.scalars(
            select(AdminAuditEvent).where(AdminAuditEvent.action == "deleted")
        ).all()
        assert len(audits) == 2
        assert retire_legacy_teams(db, actor) == []


@pytest.mark.parametrize("archived", [False, True])
def test_referenced_teams_and_original_history_are_preserved(client, archived):
    actor, scrap, ship = legacy_teams(client)
    original = {"id": 1, "responsible_team_id": ship, "name": "旧发货工序"}
    with SessionLocal() as db:
        if archived:
            db.add(LegacyRecord(source_table="operations", source_id=1, data=original))
        else:
            db.add(TeamPurpose(team_id=ship, name="已有用途", active=True))
        db.commit()
    with SessionLocal() as db:
        with pytest.raises(ValueError, match="references team|Unexpected reference"):
            retire_legacy_teams(db, actor)
        db.rollback()
        assert db.get(Team, scrap) is not None and db.get(Team, ship) is not None
        assert db.scalar(select(AdminAuditEvent).where(AdminAuditEvent.action == "deleted")) is None
        if archived:
            assert db.get(LegacyRecord, ("operations", 1)).data == original


@pytest.mark.parametrize(
    "payload",
    [
        {"code": "SCRAP", "name": "其他", "kind": "scrap"},
        {"code": "FACTORY-SCRAP", "name": "其他"},
        {"code": "FACTORY-SHIP", "name": "其他"},
        {"code": "OTHER", "name": "转废"},
        {"code": "OTHER", "name": "发货"},
    ],
)
def test_obsolete_teams_cannot_be_created_or_reintroduced_by_edit(client, payload):
    assert client.post("/api/teams", json=payload).status_code == 422
    team = client.post("/api/teams", json={"code": "NORMAL", "name": "普通班组"}).json()
    assert client.patch(f"/api/teams/{team['id']}", json=payload).status_code == 422
    assert client.get(f"/api/teams/{team['id']}").json()["name"] == "普通班组"
