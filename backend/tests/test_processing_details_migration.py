import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError
import pytest


def test_processing_migration_retains_old_records_and_accepts_unchanged_registered_counts():
    path = Path(__file__).parents[1] / "alembic/versions/20261010_0031_processing_details.py"
    spec = importlib.util.spec_from_file_location("processing_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql("""CREATE TABLE material_quantity_adjustments (
                id INTEGER PRIMARY KEY, before_quantity INTEGER NOT NULL, after_quantity INTEGER NOT NULL,
                CONSTRAINT ck_mqa_changed CHECK (before_quantity != after_quantity))""")
            connection.exec_driver_sql("INSERT INTO material_quantity_adjustments VALUES (1, 1, 20)")
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
                migration.upgrade()
            assert connection.execute(text("SELECT before_quantity, after_quantity, processing_status FROM material_quantity_adjustments WHERE id=1")).one() == (1, 20, None)
            connection.exec_driver_sql("INSERT INTO material_quantity_adjustments (id, before_quantity, after_quantity, processing_status) VALUES (2, 20, 20, 'partial')")
            connection.exec_driver_sql("INSERT INTO material_quantity_adjustments (id, before_quantity, after_quantity, before_specification, after_specification) VALUES (3, 20, 20, 'old', 'new')")
            with pytest.raises(IntegrityError):
                connection.exec_driver_sql("INSERT INTO material_quantity_adjustments (id, before_quantity, after_quantity) VALUES (4, 20, 20)")
    finally:
        engine.dispose()
