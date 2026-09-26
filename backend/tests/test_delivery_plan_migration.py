import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from app.models import SerialDeliveryPlan
from sqlalchemy import create_engine, text


@pytest.mark.parametrize("existing", [False, True])
def test_delivery_plan_upgrade_preserves_existing_rows_and_is_repeatable(existing):
    path = Path(__file__).parents[1] / "alembic/versions/20260926_0019_delivery_plans.py"
    spec = importlib.util.spec_from_file_location("delivery_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "CREATE TABLE preserved (id INTEGER PRIMARY KEY, value TEXT)"
            )
            connection.exec_driver_sql("INSERT INTO preserved VALUES (1, 'keep')")
            if existing:
                SerialDeliveryPlan.__table__.create(connection)
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
                connection.execute(
                    text(
                        "INSERT INTO serial_delivery_plans VALUES "
                        "('SERIAL-01', '[]', 1, 'admin', '2026-09-26 00:00:00')"
                    )
                )
                before = connection.execute(text("SELECT * FROM serial_delivery_plans")).all()
                migration.upgrade()
                assert (
                    connection.execute(text("SELECT * FROM serial_delivery_plans")).all() == before
                )
            assert connection.execute(text("SELECT * FROM preserved")).all() == [(1, "keep")]
    finally:
        engine.dispose()
