import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text


def test_rework_link_migration_preserves_existing_documents_and_is_repeatable(tmp_path):
    path = Path(__file__).parents[1] / "alembic/versions/20261027_0057_rework_original_schedule.py"
    spec = importlib.util.spec_from_file_location("rework_link_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    engine = create_engine("sqlite:///" + str(tmp_path / "migration.sqlite"))
    try:
        with engine.begin() as connection:
            connection.execute(
                text("CREATE TABLE process_routes (id INTEGER PRIMARY KEY, source_file BLOB)")
            )
            connection.execute(text("INSERT INTO process_routes VALUES (1, X'1234')"))
            connection.execute(text("CREATE TABLE production_schedules (id INTEGER PRIMARY KEY)"))
            connection.execute(text("INSERT INTO production_schedules VALUES (1)"))
            module.op = Operations(MigrationContext.configure(connection))
            module.upgrade()
            module.upgrade()
            assert connection.execute(text("SELECT * FROM process_routes")).all() == [
                (1, b"\x12\x34", None)
            ]
            assert (
                inspect(connection).get_foreign_keys("process_routes")[0]["referred_table"]
                == "production_schedules"
            )
            connection.execute(text("UPDATE process_routes SET original_schedule_id=1"))
            with pytest.raises(RuntimeError):
                module.downgrade()
            connection.execute(text("UPDATE process_routes SET original_schedule_id=NULL"))
            module.downgrade()
            assert connection.execute(text("SELECT * FROM process_routes")).all() == [
                (1, b"\x12\x34")
            ]
    finally:
        engine.dispose()
