"""One directory for handoffs and work, retaining both historical foreign keys."""

import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine
from test_processing_daily import setup_lot, work
from test_warehouse_classification import base
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

pytestmark = pytest.mark.usefixtures("legacy_stock")


def test_either_directory_updates_one_choice_with_shared_versions(client, warehouse):
    s = warehouse
    setup_lot(client, s)
    url = base(s, True)
    task = client.post(url + "/processing-tasks", json={"name": "粗磨"}).json()
    purpose = client.get(url + "/purposes").json()[0]
    assert task["purpose_id"] == purpose["id"] and purpose["name"] == task["name"]
    changed = client.patch(
        url + f"/purposes/{purpose['id']}",
        json={
            "name": "精磨",
            "active": False,
            "expected_version": purpose["version"],
        },
    )
    assert changed.status_code == 200, changed.text
    updated = client.get(url + "/processing-tasks").json()[0]
    assert (updated["name"], updated["active"], updated["version"]) == ("精磨", False, 2)
    assert (
        client.patch(
            url + f"/processing-tasks/{task['id']}",
            json={
                "name": "旧页面修改",
                "expected_version": 1,
            },
        ).status_code
        == 409
    )
    assert client.post(url + "/purposes", json={"name": "精磨"}).status_code == 409
    extra = client.post(url + "/purposes", json={"name": "清洗"}).json()
    choices = client.get(url + "/processing-tasks").json()
    assert next(row for row in choices if row["name"] == "清洗")["purpose_id"] == extra["id"]
    assert (
        client.patch(
            url + f"/processing-tasks/{task['id']}",
            json={
                "name": "清洗",
                "expected_version": 2,
            },
        ).status_code
        == 409
    )
    assert client.get(url + "/purposes").json()[0]["name"] == "精磨"


def test_registration_derives_handoff_task_and_rejects_a_different_choice(client, warehouse):
    s = warehouse
    lot, employee = setup_lot(client, s)
    url = base(s, True)
    first = client.post(url + "/processing-tasks", json={"name": "粗磨"}).json()
    other = client.post(url + "/processing-tasks", json={"name": "精磨"}).json()
    invalid = work(
        client, s, lot, employee, processing_task_id=first["id"], purpose_id=other["purpose_id"]
    )
    assert invalid.status_code == 422 and "同一项" in invalid.text
    result = work(client, s, lot, employee, processing_task_id=first["id"])
    assert result.status_code == 201, result.text
    assert result.json()["purpose_id"] == first["purpose_id"]
    assert result.json()["purpose_name"] == result.json()["processing_task_name"] == "粗磨"
    client.patch(
        url + f"/processing-tasks/{first['id']}",
        json={
            "name": "粗研",
            "active": False,
            "expected_version": 1,
        },
    )
    recorded = client.get(url + "/processing-records").json()["items"][0]
    assert recorded["purpose_name"] == recorded["processing_task_name"] == "粗磨"


def test_migration_unions_names_without_changing_history_or_warehouse_choices():
    path = Path(__file__).parents[1] / "alembic/versions/20261105_0069_unified_team_tasks.py"
    spec = importlib.util.spec_from_file_location("unified_tasks_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as conn:
            conn.exec_driver_sql("CREATE TABLE teams (id INTEGER PRIMARY KEY, code TEXT)")
            for table in ("team_purposes", "team_processing_tasks"):
                conn.exec_driver_sql(
                    f"CREATE TABLE {table} (id INTEGER PRIMARY KEY, team_id INTEGER REFERENCES teams(id), name TEXT, active BOOLEAN, version INTEGER, updated_at DATETIME, UNIQUE(team_id, name))"
                )
            conn.exec_driver_sql(
                "CREATE TABLE history (id INTEGER PRIMARY KEY, purpose_id INTEGER REFERENCES team_purposes(id), task_id INTEGER REFERENCES team_processing_tasks(id), purpose_name TEXT, task_name TEXT)"
            )
            conn.exec_driver_sql(
                "INSERT INTO teams VALUES (1, 'FACTORY-GRIND'), (2, 'FACTORY-WAREHOUSE')"
            )
            conn.exec_driver_sql(
                "INSERT INTO team_purposes VALUES (10, 1, '粗磨', 1, 3, CURRENT_TIMESTAMP), (11, 1, '清洗', 1, 1, CURRENT_TIMESTAMP), (12, 2, '入库', 1, 1, CURRENT_TIMESTAMP)"
            )
            conn.exec_driver_sql(
                "INSERT INTO team_processing_tasks VALUES (20, 1, '粗磨', 0, 2, CURRENT_TIMESTAMP), (21, 1, '精磨', 1, 1, CURRENT_TIMESTAMP)"
            )
            conn.exec_driver_sql("INSERT INTO history VALUES (1, 11, 20, '历史业务', '历史加工')")
            with Operations.context(MigrationContext.configure(conn)):
                migration.upgrade()
            pairs = conn.exec_driver_sql(
                "SELECT t.name, t.active, p.name, p.active FROM team_processing_tasks t JOIN team_purposes p ON p.id=t.purpose_id ORDER BY t.name"
            ).all()
            assert set(pairs) == {
                ("粗磨", 0, "粗磨", 0),
                ("精磨", 1, "精磨", 1),
                ("清洗", 1, "清洗", 1),
            }
            assert conn.exec_driver_sql("SELECT * FROM history").one() == (
                1,
                11,
                20,
                "历史业务",
                "历史加工",
            )
            assert (
                conn.exec_driver_sql(
                    "SELECT COUNT(*) FROM team_processing_tasks WHERE team_id=2"
                ).scalar()
                == 0
            )
            assert conn.exec_driver_sql("PRAGMA foreign_key_check").all() == []
    finally:
        engine.dispose()
