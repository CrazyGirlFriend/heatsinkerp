import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError
import pytest


def test_migration_preserves_existing_balance_and_can_run_twice():
    path = Path(__file__).parents[1] / "alembic/versions/20260927_0020_quantity_adjustments.py"
    spec = importlib.util.spec_from_file_location("quantity_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            for table in ("material_transfers", "teams", "users"):
                connection.exec_driver_sql(f"CREATE TABLE {table} (id INTEGER PRIMARY KEY)")
            connection.exec_driver_sql("""CREATE TABLE material_stock_balances (
                transfer_id INTEGER PRIMARY KEY, received_quantity INTEGER NOT NULL,
                on_hand_quantity INTEGER NOT NULL, reserved_quantity INTEGER NOT NULL,
                dispatched_quantity INTEGER NOT NULL, lost_quantity INTEGER NOT NULL,
                CONSTRAINT ck_msb_reconcile_quantity CHECK (
                    received_quantity = on_hand_quantity + reserved_quantity + dispatched_quantity + lost_quantity))""")
            connection.exec_driver_sql("INSERT INTO material_stock_balances VALUES (1, 10, 6, 4, 0, 0)")
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
                migration.upgrade()
            assert connection.execute(text("SELECT received_quantity, on_hand_quantity, adjusted_quantity, revision FROM material_stock_balances")).one() == (10, 6, 0, 0)
            assert "material_quantity_adjustments" in inspect(connection).get_table_names()
            connection.exec_driver_sql("UPDATE material_stock_balances SET on_hand_quantity = 60, adjusted_quantity = 54")
            with pytest.raises(IntegrityError):
                connection.exec_driver_sql("UPDATE material_stock_balances SET on_hand_quantity = 61")
    finally:
        engine.dispose()
