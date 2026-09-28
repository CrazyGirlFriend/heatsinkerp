"""A demo-only correction must preserve stock, history and non-demo records."""

import pytest
from sqlalchemy import func, select

from app.configure_material_teams import MATERIAL_TEAMS, configure_material_teams
from app.database import SessionLocal
from app.models import MaterialTransfer, MaterialTransferEvent, Team, TeamPurpose
from app.repair_demo_purposes import LEGACY_NAMES, protected_fingerprints, repair_demo_purposes
from test_material_transfers import _leader


@pytest.fixture()
def demo(client):
    with SessionLocal() as db:
        configure_material_teams(db)
        teams = {t.code: t.id for t in db.scalars(select(Team))}
        for _, name, _, _ in MATERIAL_TEAMS:
            team_id = db.scalar(select(Team.id).where(Team.name == name))
            db.add_all(TeamPurpose(team_id=team_id, name=p) for p in LEGACY_NAMES[name])
        db.commit()
        purposes = {
            t: db.scalar(select(TeamPurpose.id).where(TeamPurpose.team_id == t))
            for t in teams.values()
        }
    headers = {}
    for code, _, _, _ in MATERIAL_TEAMS:
        _, headers[code] = _leader(client, code.lower(), teams[code])
    route = [code for code, _, _, _ in MATERIAL_TEAMS]
    warehouse = route[0]
    for index in range(3):
        response = client.post(
            f"/api/team-materials/{teams[warehouse]}/receipts",
            headers=headers[warehouse],
            json={
                "serial_no": "YS-001",
                "material_name": "材料1",
                "material_type": "raw_material",
                "quantity": 100,
                "weight": 10,
                "idempotency_key": f"demo-online-20260928:{index}:intake",
                "notes": "演示数据｜业务分组验收",
            },
        )
        assert response.status_code == 201, response.text
        lot = response.json()
        for source, target in zip(route, route[1:] + [warehouse], strict=True):
            response = client.post(
                f"/api/team-materials/{teams[source]}/dispatches",
                headers=headers[source],
                json={
                    "next_team_id": teams[target],
                    "idempotency_key": f"demo-online-20260928:{index}:{target}",
                    "lines": [
                        {
                            "source_transfer_id": lot["id"],
                            "purpose_id": purposes[teams[target]],
                            "quantity": 100,
                            "weight": 10,
                        }
                    ],
                },
            )
            assert response.status_code == 201, response.text
            lot = response.json()["items"][0]
            response = client.post(
                f"/api/material-transfers/{lot['batch_no']}/confirm",
                headers=headers[target],
                json={"idempotency_key": f"confirm:{index}:{target}"},
            )
            assert response.status_code == 200, response.text
    return teams


def test_repair_has_real_records_for_three_businesses_and_is_idempotent(client, demo):
    with SessionLocal() as db:
        before = protected_fingerprints(db)
        audit_count = db.scalar(select(func.count(MaterialTransferEvent.id)))
        report = repair_demo_purposes(db)
        assert report["changed_records"] == 27
        assert all(
            len(t["businesses"]) == 3 and min(t["businesses"].values()) >= 1
            for t in report["teams"]
        )
        db.rollback()
        assert before == protected_fingerprints(db)
        assert db.scalar(select(func.count(TeamPurpose.id))) == 12
        assert db.scalar(select(func.count(MaterialTransferEvent.id))) == audit_count
        report = repair_demo_purposes(db)
        db.commit()
        assert before == protected_fingerprints(db)
        assert db.scalar(select(func.count(TeamPurpose.id))) == 24
        assert db.scalar(select(func.count(MaterialTransferEvent.id))) == audit_count + 27
        rerun = repair_demo_purposes(db)
        assert rerun["skipped"]
        assert rerun["changed_records"] == report["changed_records"]
        db.commit()
        assert db.scalar(select(func.count(MaterialTransferEvent.id))) == audit_count + 27


@pytest.mark.parametrize("customize", ["record", "purpose"])
def test_repair_refuses_to_overwrite_non_demo_or_custom_configuration(client, demo, customize):
    with SessionLocal() as db:
        if customize == "record":
            row = db.scalar(
                select(MaterialTransfer).where(MaterialTransfer.entry_kind == "transfer")
            )
            row.serial_no = "CUSTOM-001"
        else:
            db.scalar(select(TeamPurpose)).name = "自定义业务"
        db.commit()
        before = protected_fingerprints(db)
        with pytest.raises(RuntimeError, match="未覆盖"):
            repair_demo_purposes(db)
        db.rollback()
        assert before == protected_fingerprints(db)
        assert db.scalar(select(func.count(TeamPurpose.id))) == 12
