import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect
from sqlalchemy.exc import IntegrityError


def test_signed_stock_migration_preserves_rows_retries_and_reconciliation():
    path = Path(__file__).parents[1] / "alembic/versions/20261008_0026_signed_stock.py"
    spec = importlib.util.spec_from_file_location("signed_stock_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql("""CREATE TABLE material_stock_balances (
                id INTEGER PRIMARY KEY, received_quantity INTEGER NOT NULL,
                received_weight NUMERIC NOT NULL, on_hand_quantity INTEGER NOT NULL,
                on_hand_weight NUMERIC NOT NULL, dispatched_quantity INTEGER NOT NULL,
                dispatched_weight NUMERIC NOT NULL,
                CONSTRAINT ck_msb_on_hand_quantity CHECK (on_hand_quantity >= 0),
                CONSTRAINT ck_msb_on_hand_weight CHECK (on_hand_weight >= 0),
                CONSTRAINT ck_msb_dispatched_quantity CHECK (dispatched_quantity >= 0),
                CONSTRAINT ck_msb_reconcile_quantity CHECK (received_quantity = on_hand_quantity + dispatched_quantity),
                CONSTRAINT ck_msb_reconcile_weight CHECK (received_weight = on_hand_weight + dispatched_weight)
                )""")
            connection.exec_driver_sql("""CREATE TABLE material_quantity_adjustments (
                id INTEGER PRIMARY KEY, before_quantity INTEGER NOT NULL, after_quantity INTEGER NOT NULL,
                weight_snapshot NUMERIC NOT NULL,
                CONSTRAINT ck_mqa_quantities CHECK (before_quantity >= 0 AND after_quantity >= 0),
                CONSTRAINT ck_mqa_weight CHECK (weight_snapshot >= 0)
                )""")
            connection.exec_driver_sql(
                "INSERT INTO material_stock_balances VALUES (1,100,10,100,10,0,0)"
            )
            connection.exec_driver_sql(
                "INSERT INTO material_quantity_adjustments VALUES (1,120,100,10)"
            )
            before = connection.exec_driver_sql("SELECT * FROM material_stock_balances").all()
            adjustments = connection.exec_driver_sql(
                "SELECT * FROM material_quantity_adjustments"
            ).all()
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
                migration.upgrade()
            assert (
                connection.exec_driver_sql("SELECT * FROM material_stock_balances").all() == before
            )
            assert (
                connection.exec_driver_sql("SELECT * FROM material_quantity_adjustments").all()
                == adjustments
            )
            checks = {
                c["name"]
                for c in inspect(connection).get_check_constraints("material_stock_balances")
            }
            assert {
                "ck_msb_reconcile_quantity",
                "ck_msb_reconcile_weight",
                "ck_msb_dispatched_quantity",
            } <= checks
            assert "ck_msb_on_hand_quantity" not in checks and "ck_msb_on_hand_weight" not in checks
            connection.exec_driver_sql(
                "UPDATE material_stock_balances SET on_hand_quantity=-20, on_hand_weight=-2, dispatched_quantity=120, dispatched_weight=12"
            )
            connection.exec_driver_sql(
                "INSERT INTO material_quantity_adjustments VALUES (2,-20,0,-2)"
            )
            with pytest.raises(IntegrityError):
                connection.exec_driver_sql(
                    "UPDATE material_stock_balances SET on_hand_quantity=-21"
                )
            with pytest.raises(IntegrityError):
                connection.exec_driver_sql(
                    "INSERT INTO material_quantity_adjustments VALUES (3,0,-1,0)"
                )
    finally:
        engine.dispose()
