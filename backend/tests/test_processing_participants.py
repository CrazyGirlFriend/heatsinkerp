"""Joint work keeps one material fact while retaining every participant."""

import importlib.util
import json
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine
from test_processing_daily import setup_lot, work
from test_warehouse_classification import base
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

pytestmark = pytest.mark.usefixtures("legacy_stock")


def test_joint_work_filters_and_totals_count_the_work_once(client, warehouse):
    s = warehouse
    lot, first = setup_lot(client, s)
    url = base(s, True)
    second = client.post(url + "/employees", json={"name": "共同加工员工"}).json()
    result = work(
        client,
        s,
        lot,
        first,
        processor_employee_ids=[second["id"], first["id"]],
        processing_minutes=95,
        reason="两人共同装炉",
    )
    assert result.status_code == 201, result.text
    record = result.json()
    assert record["processors"] == [{"id": p["id"], "name": p["name"]} for p in [first, second]]
    assert record["processing_minutes"] == 95
    assert record["reason"] == "两人共同装炉"
    for params in [
        {},
        {"processor_id": first["id"]},
        {"processor_id": second["id"]},
        {"query": second["name"]},
    ]:
        records = client.get(url + "/processing-records", params=params).json()
        assert records["total"] == 1
        assert records["items"][0]["processors"] == record["processors"]
        assert records["summary"]["completed_quantity"] == 10
        assert records["summary"]["processing_minutes"] == 95
        assert records["summary"]["duration_record_count"] == 1
        assert records["summary"]["employee_day_count"] == 2
        assert {p["id"] for p in records["processors"]} == {first["id"], second["id"]}
        daily = client.get(url + "/processing-daily", params=params).json()
        assert daily["total"] == 1
        assert daily["items"][0]["processors"] == record["processors"]
        assert daily["items"][0]["completed_quantity"] == 10
        assert daily["items"][0]["processing_minutes"] == 95
    context = client.get(f"{url}/stock/{lot['id']}/quantity-adjustments").json()
    assert context["items"][0]["processors"] == record["processors"]
    replay_body = json.loads(result.request.content)
    replay_body["processor_employee_ids"] = [first["id"], second["id"]]
    replay = client.post(
        url + "/quantity-adjustments", headers=s["other_headers"], json=replay_body
    )
    assert replay.status_code == 201, replay.text
    assert replay.json() == record


def test_distinct_crews_and_unknown_duration_are_not_merged(client, warehouse):
    s = warehouse
    lot, first = setup_lot(client, s)
    url = base(s, True)
    second = client.post(url + "/employees", json={"name": "搭档"}).json()
    joint = work(
        client,
        s,
        lot,
        first,
        processor_employee_ids=[first["id"], second["id"]],
        completed_quantity=6,
        completed_weight=60,
        processing_minutes=45,
    )
    assert joint.status_code == 201, joint.text
    remainder = next(row for row in joint.json()["outputs"] if row["role"] == "remaining")
    single = work(client, s, remainder, first, idempotency_key="solo")
    assert single.status_code == 201, single.text
    assert single.json()["processing_minutes"] is None
    daily = client.get(url + "/processing-daily").json()
    assert daily["total"] == 2
    assert sorted(len(row["processors"]) for row in daily["items"]) == [1, 2]
    assert sorted(row["completed_quantity"] for row in daily["items"]) == [4, 6]
    totals = client.get(url + "/processing-records").json()["summary"]
    assert totals["completed_quantity"] == 10
    assert totals["processing_minutes"] == 45
    assert totals["record_count"] == 2
    assert totals["duration_record_count"] == 1


def test_invalid_crew_and_duration_do_not_change_stock(client, warehouse):
    s = warehouse
    lot, first = setup_lot(client, s)
    foreign = client.get(base(s) + "/employees").json()[0]
    invalid = [
        {"processor_employee_ids": []},
        {"processor_employee_ids": [first["id"], first["id"]]},
        {"processor_employee_ids": [first["id"], foreign["id"]]},
        {"processor_employee_ids": [999999]},
        {"processing_minutes": 0},
        {"processing_minutes": -1},
        {"processing_minutes": 1.5},
        {"processing_minutes": 2147483648},
    ]
    for extra in invalid:
        result = work(client, s, lot, first, **extra)
        assert result.status_code == 422, result.text
    assert client.get(base(s, True) + "/processing-records").json()["total"] == 0
    result = work(client, s, lot, first, processing_minutes=5)
    assert result.status_code == 201, result.text
    assert result.json()["completed_quantity"] == 10


def test_migration_preserves_legacy_names_and_unknown_duration():
    path = Path(__file__).parents[1] / "alembic/versions/20261112_0071_processing_participants.py"
    spec = importlib.util.spec_from_file_location("participants_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as conn:
            conn.exec_driver_sql(
                "CREATE TABLE team_employees (id INTEGER PRIMARY KEY, name VARCHAR(80))"
            )
            conn.exec_driver_sql(
                "CREATE TABLE material_quantity_adjustments (id INTEGER PRIMARY KEY, processor_employee_id INTEGER, processor_name VARCHAR(80))"
            )
            conn.exec_driver_sql("INSERT INTO team_employees VALUES (1, '新姓名')")
            conn.exec_driver_sql(
                "INSERT INTO material_quantity_adjustments VALUES (1, 1, '原姓名'), (2, NULL, '历史未关联')"
            )
            with Operations.context(MigrationContext.configure(conn)):
                migration.upgrade()
                assert conn.exec_driver_sql("SELECT * FROM processing_participants").all() == [
                    (1, 1, "原姓名")
                ]
                assert conn.exec_driver_sql(
                    "SELECT processor_group_key, processing_minutes FROM material_quantity_adjustments ORDER BY id"
                ).all() == [("1", None), (None, None)]
                migration.downgrade()
                migration.upgrade()
                assert (
                    conn.exec_driver_sql("SELECT COUNT(*) FROM processing_participants").scalar()
                    == 1
                )
    finally:
        engine.dispose()


def test_roster_import_reuses_directory_rules_and_is_idempotent(client, warehouse):
    from app.database import SessionLocal
    from app.import_production_directory import import_directory
    from app.models import TeamEmployee, TeamProcessingTask, TeamPurpose, User
    from sqlalchemy import select

    s = warehouse
    _, employee = setup_lot(client, s)
    directory = {
        "FACTORY-ANNEAL": {"employees": [employee["name"], "共同作业人员"], "tasks": ["洗料 摆料"]}
    }
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.role == "ADMIN"))
        preview = import_directory(db, user, directory)
        assert len(preview) == 2
        assert not db.scalar(select(TeamEmployee).where(TeamEmployee.name == "共同作业人员"))
        changes = import_directory(db, user, directory, apply=True)
        assert changes == preview
        assert import_directory(db, user, directory, apply=True) == []
        task = db.scalar(
            select(TeamProcessingTask).where(
                TeamProcessingTask.team_id == s["other"]["id"],
                TeamProcessingTask.name == "洗料 摆料",
            )
        )
        assert db.get(TeamPurpose, task.purpose_id).name == task.name
