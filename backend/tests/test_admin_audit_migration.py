import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from app.database import Base
from sqlalchemy import create_engine, inspect


@pytest.mark.parametrize("current_metadata", [False, True])
def test_audit_upgrade_is_additive_and_repeatable(current_metadata):
    path = Path(__file__).parents[1] / "alembic/versions/20260920_0016_admin_audit.py"
    spec = importlib.util.spec_from_file_location("audit_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            if current_metadata:
                Base.metadata.create_all(connection)
            else:
                connection.exec_driver_sql("CREATE TABLE users (id INTEGER PRIMARY KEY)")
                connection.exec_driver_sql("INSERT INTO users VALUES (1)")
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
                connection.exec_driver_sql(
                    "INSERT INTO admin_audit_events (actor_user_id, actor, target_type, target_id, action, changes, created_at) VALUES (1, 'admin', 'user', 42, 'deleted', '{}', '2026-09-20 00:00:00')"
                )
                before = connection.exec_driver_sql("SELECT * FROM admin_audit_events").all()
                connection.exec_driver_sql("DROP INDEX ix_admin_audit_target")
                migration.upgrade()
                assert (
                    connection.exec_driver_sql("SELECT * FROM admin_audit_events").all() == before
                )
            connection.exec_driver_sql("DELETE FROM users")
            assert connection.exec_driver_sql("SELECT * FROM admin_audit_events").all() == before
            assert inspect(connection).get_indexes("admin_audit_events")[0]["column_names"] == [
                "target_type",
                "target_id",
                "id",
            ]
            with Operations.context(MigrationContext.configure(connection)):
                connection.exec_driver_sql("DROP INDEX ix_admin_audit_target")
                connection.exec_driver_sql(
                    "CREATE INDEX ix_admin_audit_target ON admin_audit_events (action)"
                )
                with pytest.raises(RuntimeError, match="Unexpected administrative audit index"):
                    migration.upgrade()
            assert connection.exec_driver_sql("SELECT * FROM admin_audit_events").all() == before
    finally:
        engine.dispose()
