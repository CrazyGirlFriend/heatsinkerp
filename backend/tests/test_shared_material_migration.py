"""The shared origin upgrade does not assign old stock to imaginary orders."""

import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine


def test_upgrade_keeps_stock_and_existing_links_and_repeats_safely():
    path = Path(__file__).parents[1] / "alembic/versions/20261012_0033_shared_material.py"
    spec = importlib.util.spec_from_file_location("shared_material_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "CREATE TABLE material_transfers (id INTEGER PRIMARY KEY, batch_no TEXT, serial_no TEXT, source_transfer_id INTEGER, quantity INTEGER, weight NUMERIC)"
            )
            connection.exec_driver_sql(
                "INSERT INTO material_transfers VALUES (1, 'TL1', 'OLD', NULL, 1, 100), (2, 'TL2', 'OLD', 1, 20, 90)"
            )
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
                migration.upgrade()
            assert connection.exec_driver_sql(
                "SELECT id, batch_no, serial_no, source_transfer_id, quantity, weight, shared_group_id, shared_unallocated FROM material_transfers ORDER BY id"
            ).all() == [
                (1, "TL1", "OLD", None, 1, 100, None, 0),
                (2, "TL2", "OLD", 1, 20, 90, None, 0),
            ]
            assert (
                connection.exec_driver_sql("SELECT count(*) FROM shared_material_groups").scalar()
                == 0
            )
            assert (
                connection.exec_driver_sql("SELECT count(*) FROM shared_material_members").scalar()
                == 0
            )
    finally:
        engine.dispose()
