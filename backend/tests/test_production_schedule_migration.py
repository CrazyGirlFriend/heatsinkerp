"""Fresh deployment is rerunnable and database constraints protect assignments."""

import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError


def test_schedule_migration_is_additive_repeatable_and_preserves_audit(tmp_path):
    filename = Path(__file__).parents[1] / "alembic/versions/20261022_0044_production_schedules.py"
    spec = importlib.util.spec_from_file_location("schedule_migration", filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    engine = create_engine("sqlite:///" + str(tmp_path / "migration.sqlite"))
    with engine.begin() as connection:
        for table in ("teams", "users", "material_transfers"):
            connection.execute(text(f"CREATE TABLE {table} (id INTEGER PRIMARY KEY)"))
        module.op = Operations(MigrationContext.configure(connection))
        module.upgrade()
        module.upgrade()
        assert set(inspect(connection).get_table_names()) >= {
            "production_schedules",
            "production_schedule_sources",
            "production_schedule_deliveries",
            "production_schedule_events",
        }
        connection.execute(
            text("""INSERT INTO production_schedules
            (id, serial_no, team_id, next_team_id, sequence_no, due_at, initial_due_at,
             target_quantity, version, created_at, updated_at, idempotency_key, request_hash)
            VALUES (1, 'A', 1, 2, 1, '2026-12-20 08:00:00', '2026-12-20 08:00:00', 10, 1,
                    '2026-10-22 00:00:00', '2026-10-22 00:00:00', 'request', 'hash')""")
        )
        with pytest.raises(IntegrityError):
            connection.execute(
                text("INSERT INTO production_schedule_sources VALUES (1, 1, -1, NULL)")
            )
        connection.execute(text("INSERT INTO production_schedule_deliveries VALUES (1, 1)"))
        with pytest.raises(IntegrityError):
            connection.execute(text("INSERT INTO production_schedule_deliveries VALUES (1, 2)"))
        with pytest.raises(RuntimeError):
            module.downgrade()
    engine.dispose()


def test_task_migration_preserves_old_routes_actuals_and_completion_basis(tmp_path):
    def load(name):
        filename = Path(__file__).parents[1] / "alembic/versions" / name
        spec = importlib.util.spec_from_file_location(name, filename)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    base = load("20261022_0044_production_schedules.py")
    tasks = load("20261022_0045_production_schedule_tasks.py")
    engine = create_engine("sqlite:///" + str(tmp_path / "task-migration.sqlite"))
    with engine.begin() as connection:
        for table in ("teams", "users", "material_transfers"):
            connection.execute(text(f"CREATE TABLE {table} (id INTEGER PRIMARY KEY)"))
            connection.execute(text(f"INSERT INTO {table} VALUES (1), (2)"))
        base.op = Operations(MigrationContext.configure(connection))
        base.upgrade()
        for ident, parent, quantity, weight, serial in (
            (1, None, 1, 100, "A"),
            (2, 1, 20, None, "A"),
            (3, None, None, 80, "A"),
            (4, None, 5, 10, "B"),
        ):
            connection.execute(
                text("""INSERT INTO production_schedules
                (id, serial_no, team_id, next_team_id, predecessor_id, sequence_no, due_at, initial_due_at,
                 target_quantity, target_weight, version, created_at, updated_at, idempotency_key, request_hash)
                VALUES (:id, :serial, 1, 2, :parent, 1, '2026-12-20 08:00:00', '2026-12-20 08:00:00',
                        :quantity, :weight, 3, '2026-10-22 00:00:00', '2026-10-22 01:00:00', :key, 'old-hash')"""),
                {
                    "id": ident,
                    "parent": parent,
                    "quantity": quantity,
                    "weight": weight,
                    "serial": serial,
                    "key": f"old-{ident}",
                },
            )
        connection.execute(text("INSERT INTO production_schedule_sources VALUES (1, 1, 1, 100)"))
        connection.execute(text("INSERT INTO production_schedule_deliveries VALUES (2, 1)"))
        tasks.op = Operations(MigrationContext.configure(connection))
        tasks.upgrade()
        first = list(
            connection.execute(
                text(
                    "SELECT id, task_id, completion_basis, version, request_hash FROM production_schedules ORDER BY id"
                )
            )
        )
        assert first == [
            (1, 1, "both", 3, "old-hash"),
            (2, 1, "quantity", 3, "old-hash"),
            (3, 3, "weight", 3, "old-hash"),
            (4, 4, "both", 3, "old-hash"),
        ]
        assert connection.scalar(text("SELECT count(*) FROM production_schedule_tasks")) == 3
        assert list(connection.execute(text("SELECT * FROM production_schedule_deliveries"))) == [
            (2, 1)
        ]
        assert list(connection.execute(text("SELECT * FROM production_schedule_sources"))) == [
            (1, 1, 1, 100)
        ]
        tasks.upgrade()
        assert (
            list(
                connection.execute(
                    text(
                        "SELECT id, task_id, completion_basis, version, request_hash FROM production_schedules ORDER BY id"
                    )
                )
            )
            == first
        )
        columns = {
            item["name"]: item for item in inspect(connection).get_columns("production_schedules")
        }
        assert columns["task_id"]["nullable"] is False
        assert columns["completion_basis"]["nullable"] is False
        with pytest.raises(IntegrityError):
            connection.execute(
                text("UPDATE production_schedules SET completion_basis='both' WHERE id=2")
            )
        with pytest.raises(RuntimeError):
            tasks.downgrade()
    engine.dispose()


def test_business_people_migration_is_repeatable_and_preserves_unassigned_tasks(tmp_path):
    filename = (
        Path(__file__).parents[1] / "alembic/versions/20261023_0046_schedule_business_people.py"
    )
    spec = importlib.util.spec_from_file_location("people_migration", filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    engine = create_engine("sqlite:///" + str(tmp_path / "people.sqlite"))
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE production_schedule_tasks (id INTEGER PRIMARY KEY, title VARCHAR(160))"
            )
        )
        connection.execute(text("INSERT INTO production_schedule_tasks VALUES (1, '原任务')"))
        module.op = Operations(MigrationContext.configure(connection))
        module.upgrade()
        module.upgrade()
        assert list(
            connection.execute(
                text("SELECT id, title, business_person_id FROM production_schedule_tasks")
            )
        ) == [(1, "原任务", None)]
        assert (
            inspect(connection).get_foreign_keys("production_schedule_tasks")[0]["referred_table"]
            == "business_people"
        )
    engine.dispose()


def test_task_migration_keeps_existing_unnamed_task_foreign_key(tmp_path):
    from app.database import Base

    filename = (
        Path(__file__).parents[1] / "alembic/versions/20261022_0045_production_schedule_tasks.py"
    )
    spec = importlib.util.spec_from_file_location("existing_task_migration", filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    engine = create_engine("sqlite:///" + str(tmp_path / "existing-task.sqlite"))
    # The initial migration uses current metadata for a completely fresh install.
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        module.op = Operations(MigrationContext.configure(connection))
        module.upgrade()
        module.upgrade()
        task_keys = [
            item
            for item in connection.exec_driver_sql("PRAGMA foreign_key_list(production_schedules)")
            if item[3] == "task_id"
        ]
        assert len(task_keys) == 1
        assert task_keys[0][2] == "production_schedule_tasks"
    engine.dispose()
