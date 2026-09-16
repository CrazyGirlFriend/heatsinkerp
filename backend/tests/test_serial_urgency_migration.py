import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text
from app.database import Base


def migration():
    path = Path(__file__).parents[1] / "alembic/versions/20260912_0011_serial_urgency.py"
    spec = importlib.util.spec_from_file_location("urgency_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("metadata_baseline", [False, True])
def test_upgrade_from_old_schema_or_current_metadata_preserves_rows(metadata_baseline):
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            if metadata_baseline:
                Base.metadata.create_all(connection)
            else:
                connection.exec_driver_sql("CREATE TABLE users (id INTEGER PRIMARY KEY)")
            with Operations.context(MigrationContext.configure(connection)):
                migration().upgrade()
                connection.execute(text("INSERT INTO serial_urgencies VALUES ('KEEP-001', 1, '保留原因', 3, '管理员', '2026-09-12 00:00:00')"))
                connection.execute(text("INSERT INTO serial_urgency_events (serial_no, urgent, reason, actor, occurred_at) VALUES ('KEEP-001', 1, '保留原因', '管理员', '2026-09-12 00:00:00')"))
                before = connection.execute(text("SELECT * FROM serial_urgencies")).all()
                events = connection.execute(text("SELECT * FROM serial_urgency_events")).all()
                migration().upgrade()
                assert connection.execute(text("SELECT * FROM serial_urgencies")).all() == before
                assert connection.execute(text("SELECT * FROM serial_urgency_events")).all() == events
            assert {index["name"] for index in inspect(connection).get_indexes("serial_urgencies")} == {"ix_su_urgent_serial"}
            assert {index["name"] for index in inspect(connection).get_indexes("serial_urgency_events")} == {"ix_sue_serial_time"}
    finally:
        engine.dispose()


def test_existing_wrong_index_is_rejected_without_removing_it():
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql("CREATE TABLE users (id INTEGER PRIMARY KEY)")
            with Operations.context(MigrationContext.configure(connection)):
                migration().upgrade()
                connection.exec_driver_sql("DROP INDEX ix_su_urgent_serial")
                connection.exec_driver_sql("CREATE INDEX ix_su_urgent_serial ON serial_urgencies (reason)")
                with pytest.raises(RuntimeError, match="Unexpected existing index"):
                    migration().upgrade()
            assert inspect(connection).get_indexes("serial_urgencies")[0]["column_names"] == ["reason"]
    finally:
        engine.dispose()
