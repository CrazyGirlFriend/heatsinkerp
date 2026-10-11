"""Processing split migration keeps original receipts, balances and audit rows."""

import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect
from sqlalchemy.exc import IntegrityError


def test_processing_outputs_upgrade_preserves_old_data_and_is_repeatable():
    path = Path(__file__).parents[1] / "alembic/versions/20261010_0032_processing_outputs.py"
    spec = importlib.util.spec_from_file_location("processing_outputs_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "CREATE TABLE material_quantity_adjustments (id INTEGER PRIMARY KEY, before_quantity INTEGER, after_quantity INTEGER, weight_snapshot NUMERIC(17, 6))"
            )
            connection.exec_driver_sql(
                "INSERT INTO material_quantity_adjustments VALUES (1, 1, 20, 100)"
            )
            connection.exec_driver_sql("""CREATE TABLE material_stock_balances (
                transfer_id INTEGER PRIMARY KEY, received_weight NUMERIC NOT NULL,
                on_hand_weight NUMERIC NOT NULL, reserved_weight NUMERIC NOT NULL,
                dispatched_weight NUMERIC NOT NULL, lost_weight NUMERIC NOT NULL,
                CONSTRAINT ck_msb_reconcile_weight CHECK (round(received_weight, 6) = round(on_hand_weight + reserved_weight + dispatched_weight + lost_weight, 6)))""")
            connection.exec_driver_sql(
                "INSERT INTO material_stock_balances VALUES (1, 100, 80, 0, 20, 0)"
            )
            source = migration.SOURCE.replace(
                "IN ('serial_reallocation', 'processing_output')", "= 'serial_reallocation'"
            )
            destination = migration.DESTINATION.replace(", 'processing_output'", "")
            connection.exec_driver_sql(f"""CREATE TABLE material_transfers (
                id INTEGER PRIMARY KEY, entry_kind VARCHAR(32), source_team_id INTEGER,
                source_team_code TEXT, source_team_name TEXT, source_transfer_id INTEGER,
                dispatch_id INTEGER, next_team_id INTEGER, next_team_code TEXT, next_team_name TEXT,
                external_destination TEXT, status TEXT, stock_tracked BOOLEAN,
                CONSTRAINT ck_mt_entry_kind_source CHECK ({source}),
                CONSTRAINT ck_mt_entry_destination CHECK ({destination}))""")
            connection.exec_driver_sql(
                "INSERT INTO material_transfers VALUES (1, 'warehouse_receipt', NULL, NULL, NULL, NULL, NULL, 1, 'WAREHOUSE', '库房', NULL, 'received', 1)"
            )
            original = connection.exec_driver_sql("SELECT * FROM material_transfers").all()
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
                migration.upgrade()
            assert connection.exec_driver_sql(
                "SELECT id, before_quantity, after_quantity, weight_snapshot, after_weight, outputs FROM material_quantity_adjustments"
            ).one() == (1, 1, 20, 100, None, None)
            assert connection.exec_driver_sql(
                "SELECT received_weight, on_hand_weight, adjusted_weight, converted_quantity, converted_weight FROM material_stock_balances"
            ).one() == (100, 80, 0, 0, 0)
            assert connection.exec_driver_sql("SELECT * FROM material_transfers").one() == (
                *original[0],
                None,
            )
            connection.exec_driver_sql(
                "UPDATE material_stock_balances SET adjusted_weight = 0.6, on_hand_weight = 80.6"
            )
            with pytest.raises(IntegrityError):
                connection.exec_driver_sql("UPDATE material_stock_balances SET on_hand_weight = 81")
            connection.exec_driver_sql(
                "INSERT INTO material_transfers VALUES (2, 'processing_output', 1, 'ROLL', '轧制', 1, NULL, 1, 'ROLL', '轧制', NULL, 'received', 1, 'produced')"
            )
            for invalid in (
                "status = 'pending'",
                "source_transfer_id = NULL",
                "next_team_id = 2",
                "stock_tracked = 0",
            ):
                with pytest.raises(IntegrityError):
                    connection.exec_driver_sql(
                        f"UPDATE material_transfers SET {invalid} WHERE id = 2"
                    )
            checks = {
                row["name"]: row["sqltext"]
                for row in inspect(connection).get_check_constraints("material_transfers")
            }
            assert all(
                "processing_output" in checks[name]
                for name in ("ck_mt_entry_kind_source", "ck_mt_entry_destination")
            )
    finally:
        engine.dispose()
