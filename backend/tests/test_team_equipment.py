"""Equipment ownership, immutable work snapshots and required registration fields."""

import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from app.database import Base, SessionLocal
from app.models import TeamSettingEvent
from sqlalchemy import create_engine, select
from test_material_transfers import _team
from test_processing_daily import setup_lot, work
from test_warehouse_classification import base
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

pytestmark = pytest.mark.usefixtures("legacy_stock")


def test_equipment_directory_is_owned_versioned_and_audited(client, warehouse):
    s = warehouse
    setup_lot(client, s)
    url = base(s, True) + "/equipment"
    assert client.post(url, headers=s["headers"], json={"name": "1号炉"}).status_code == 403
    assert client.get(url, headers=s["headers"]).status_code == 403
    assert client.post(url, json={"name": " "}).status_code == 422
    result = client.post(url, headers=s["other_headers"], json={"name": " 1号炉 "})
    assert result.status_code == 201, result.text
    item = result.json()
    assert item["name"] == "1号炉"
    assert client.get(url).json() == [item]
    assert client.post(url, json={"name": "1号炉"}).status_code == 409
    target = f"{url}/{item['id']}"
    assert client.patch(target, json={"name": "2号炉", "expected_version": 9}).status_code == 409
    changed = client.patch(target, json={"name": "2号炉", "active": False, "expected_version": 1})
    assert changed.status_code == 200 and changed.json()["version"] == 2
    with SessionLocal() as db:
        events = list(
            db.scalars(
                select(TeamSettingEvent).where(TeamSettingEvent.action == "equipment_changed")
            )
        )
        assert len(events) == 2
        assert events[-1].changes["before"]["name"] == "1号炉"
        assert events[-1].changes["after"]["active"] is False


@pytest.mark.parametrize("code", ["FACTORY-WAREHOUSE", "FACTORY-PLATE", "FACTORY-QC"])
def test_excluded_teams_cannot_configure_equipment(client, warehouse, code):
    team = warehouse["team"] if code == "FACTORY-WAREHOUSE" else _team(client, code, code)
    url = f"/api/team-materials/{team['id']}/equipment"
    assert client.get(url).status_code == 422
    assert client.post(url, json={"name": "1号"}).status_code == 422


def test_registration_rejects_foreign_disabled_or_missing_equipment_and_preserves_snapshot(
    client, warehouse
):
    s = warehouse
    lot, employee = setup_lot(client, s)
    url = base(s, True)
    equipment = client.post(url + "/equipment", json={"name": "01炉"}).json()
    other = _team(client, "FACTORY-GRIND", "研磨")
    foreign = client.post(
        f"/api/team-materials/{other['id']}/equipment", json={"name": "03机"}
    ).json()
    for extra in (
        {"equipment_id": None},
        {"equipment_id": foreign["id"]},
        {"equipment_id": 999999},
        {"equipment_id": equipment["id"], "reason": " "},
    ):
        response = work(client, s, lot, employee, **extra)
        assert response.status_code == 422, response.text
    assert client.get(url + "/processing-records").json()["total"] == 0
    saved = work(
        client,
        s,
        lot,
        employee,
        equipment_id=equipment["id"],
        furnace_no="伪造编号",
        completed_quantity=6,
        completed_weight=60,
    )
    assert saved.status_code == 201, saved.text
    assert saved.json()["furnace_no"] == "01炉"
    assert saved.json()["equipment_id"] == equipment["id"]
    changed = client.patch(
        f"{url}/equipment/{equipment['id']}",
        json={"name": "更名炉", "active": False, "expected_version": 1},
    )
    assert changed.status_code == 200
    assert client.get(url + "/processing-records").json()["items"][0]["furnace_no"] == "01炉"
    remaining = next(row for row in saved.json()["outputs"] if row["role"] == "remaining")
    assert (
        work(
            client, s, remaining, employee, equipment_id=equipment["id"], idempotency_key="disabled"
        ).status_code
        == 422
    )
    context = client.get(f"{url}/stock/{remaining['id']}/quantity-adjustments").json()
    assert context["quantity"] == 4
    assert client.get(url + "/processing-records").json()["total"] == 1


def test_equipment_migration_preserves_historical_machine_snapshots():
    path = Path(__file__).parents[1] / "alembic/versions/20261115_0073_team_equipment.py"
    spec = importlib.util.spec_from_file_location("equipment_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql("CREATE TABLE teams (id INTEGER PRIMARY KEY)")
            connection.exec_driver_sql(
                "CREATE TABLE material_quantity_adjustments (id INTEGER PRIMARY KEY, machine_no VARCHAR(80))"
            )
            connection.exec_driver_sql(
                "INSERT INTO material_quantity_adjustments VALUES (1, '历史1号机')"
            )
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
                assert connection.exec_driver_sql(
                    "SELECT * FROM material_quantity_adjustments"
                ).one() == (1, "历史1号机", None)
                migration.downgrade()
                assert connection.exec_driver_sql(
                    "SELECT * FROM material_quantity_adjustments"
                ).one() == (1, "历史1号机")
    finally:
        engine.dispose()


def test_processing_migrations_accept_current_metadata_created_by_initial_baseline():
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            Base.metadata.create_all(connection)
            with Operations.context(MigrationContext.configure(connection)):
                for filename in (
                    "20261112_0071_processing_participants.py",
                    "20261112_0072_processing_parameters.py",
                    "20261115_0073_team_equipment.py",
                ):
                    path = Path(__file__).parents[1] / "alembic/versions" / filename
                    spec = importlib.util.spec_from_file_location("baseline_migration", path)
                    migration = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(migration)
                    migration.upgrade()
            assert (
                connection.exec_driver_sql(
                    "SELECT processor_group_key, processing_minutes, machine_no, equipment_id "
                    "FROM material_quantity_adjustments"
                ).all()
                == []
            )
    finally:
        engine.dispose()
