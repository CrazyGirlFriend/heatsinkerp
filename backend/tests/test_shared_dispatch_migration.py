"""Joint transfer bindings add nullable metadata without rewriting legacy stock."""

import importlib.util
from pathlib import Path

from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine, inspect, text


def test_shared_dispatch_migration_preserves_legacy_members(tmp_path):
    path = Path(__file__).parents[1] / "alembic/versions/20261104_0066_shared_dispatch_routes.py"
    spec = importlib.util.spec_from_file_location("shared_dispatch_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite:///" + str(tmp_path / "legacy.sqlite"))
    try:
        with engine.begin() as connection:
            connection.execute(text("CREATE TABLE process_routes (id INTEGER PRIMARY KEY)"))
            connection.execute(
                text("CREATE TABLE shared_material_groups (id INTEGER PRIMARY KEY, batch_no TEXT)")
            )
            connection.execute(
                text(
                    "CREATE TABLE shared_material_members (id INTEGER PRIMARY KEY, group_id INTEGER, serial_no TEXT)"
                )
            )
            connection.execute(text("INSERT INTO shared_material_groups VALUES (1, 'LEGACY')"))
            connection.execute(text("INSERT INTO shared_material_members VALUES (1, 1, 'ORDER-A')"))
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
            assert connection.execute(
                text(
                    "SELECT serial_no, process_route_id, process_route_version FROM shared_material_members"
                )
            ).one() == ("ORDER-A", None, None)
            assert (
                connection.scalar(text("SELECT split_step_index FROM shared_material_groups"))
                is None
            )
            assert (
                inspect(connection).get_foreign_keys("shared_material_members")[0]["referred_table"]
                == "process_routes"
            )
            with Operations.context(MigrationContext.configure(connection)):
                migration.downgrade()
            assert (
                connection.scalar(text("SELECT serial_no FROM shared_material_members"))
                == "ORDER-A"
            )
    finally:
        engine.dispose()
