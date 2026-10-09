import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def test_upgrade_retains_old_values_is_repeatable_and_checks_milligrams():
    path = Path(__file__).parents[1] / "alembic/versions/20261009_0030_material_weight_precision.py"
    spec = importlib.util.spec_from_file_location("mass_precision", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = sa.create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            before = {}
            for table, names in migration.MASS_COLUMNS.items():
                columns = ", ".join(f"{name} NUMERIC(14,3) NOT NULL" for name in names)
                check = ", CONSTRAINT ck_msb_reconcile_weight CHECK (round(received_weight, 3) = round(on_hand_weight + reserved_weight + in_transit_weight * 0 + dispatched_weight + lost_weight, 3))" if table == "material_stock_balances" else ""
                connection.exec_driver_sql(f"CREATE TABLE {table} (id INTEGER PRIMARY KEY, {columns}{check})")
                values = ["1.005" if name in ("weight", "sludge_gross_weight", "weight_snapshot", "received_weight", "on_hand_weight") else "0" for name in names]
                connection.exec_driver_sql(f"INSERT INTO {table} VALUES (1, {', '.join(values)})")
                before[table] = connection.exec_driver_sql(f"SELECT * FROM {table}").all()
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
                migration.upgrade()
            for table, names in migration.MASS_COLUMNS.items():
                assert connection.exec_driver_sql(f"SELECT * FROM {table}").all() == before[table]
                columns = {col["name"]: col for col in sa.inspect(connection).get_columns(table)}
                assert all((columns[name]["type"].precision, columns[name]["type"].scale) == (17, 6) for name in names)
            connection.exec_driver_sql("UPDATE material_stock_balances SET received_weight = .000123, on_hand_weight = .000123")
            with pytest.raises(sa.exc.IntegrityError):
                connection.exec_driver_sql("UPDATE material_stock_balances SET on_hand_weight = .000124")
    finally:
        engine.dispose()
