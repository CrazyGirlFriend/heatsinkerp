import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text


def test_dispatch_migration_preserves_dates_and_contacts(tmp_path):
    path = Path(__file__).parents[1] / "alembic/versions/20261030_0062_dispatch_planning.py"
    spec = importlib.util.spec_from_file_location("dispatch_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    engine = create_engine("sqlite:///" + str(tmp_path / "dispatch.sqlite"))
    try:
        with engine.begin() as db:
            for sql in [
                "CREATE TABLE teams (id INTEGER PRIMARY KEY, code TEXT UNIQUE, name TEXT UNIQUE, kind TEXT, active BOOLEAN, sort_order INTEGER, opening_stock_enabled BOOLEAN, created_at DATETIME, updated_at DATETIME)",
                "CREATE TABLE business_people (id INTEGER PRIMARY KEY, name TEXT)",
                "CREATE TABLE production_schedule_tasks (id INTEGER PRIMARY KEY, business_person_id INTEGER, final_due_at DATETIME)",
                "CREATE TABLE production_schedules (id INTEGER PRIMARY KEY, due_at DATETIME)",
                "INSERT INTO business_people VALUES (9, '业务张')",
                "INSERT INTO production_schedule_tasks VALUES (1, 9, '2026-12-31 08:00:00')",
                "INSERT INTO production_schedules VALUES (2, '2026-12-30 08:00:00')",
            ]:
                db.execute(text(sql))
            module.op = Operations(MigrationContext.configure(db))
            module.upgrade()
            assert db.execute(text("SELECT * FROM production_schedule_task_people")).all() == [
                (1, 9)
            ]
            assert db.execute(
                text("SELECT due_at, planning_state, pending_batches FROM production_schedules")
            ).one() == ("2026-12-30 08:00:00", "confirmed", None)
            assert db.execute(
                text("SELECT final_due_at, locked_at FROM production_schedule_tasks")
            ).one() == ("2026-12-31 08:00:00", None)
            assert set(db.execute(text("SELECT code, kind FROM teams")).all()) == {
                ("FACTORY-DISPATCH", "dispatch"),
                ("FACTORY-BUSINESS", "business"),
            }
    finally:
        engine.dispose()
