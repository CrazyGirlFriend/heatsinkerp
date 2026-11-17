"""Retired records survive consolidation with their exact values and identities."""

import importlib.util
from datetime import datetime
from decimal import Decimal
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from app.history_protection import TEAM_REFERENCE_FIELDS
from migration_support.legacy_schema import create_legacy_tables


@pytest.fixture
def migration():
    path = Path(__file__).parents[1] / "alembic/versions/20261117_0075_legacy_archive.py"
    spec = importlib.util.spec_from_file_location("legacy_archive_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def seed_legacy_rows(connection, names):
    """Also used in the isolated MySQL rehearsal, against the full old schema."""
    metadata = sa.MetaData()
    metadata.reflect(connection, only=list(names))
    originals = {}
    for table in metadata.sorted_tables:
        if table.name not in names:
            continue
        row = {}
        for column in table.columns:
            if isinstance(column.type, sa.Boolean):
                row[column.name] = False
            elif isinstance(column.type, sa.Integer):
                row[column.name] = 1
            elif isinstance(column.type, sa.Numeric):
                row[column.name] = Decimal("1234.567")
            elif isinstance(column.type, sa.DateTime):
                row[column.name] = datetime(2026, 9, 1, 12, 34, 56)
            elif isinstance(column.type, sa.JSON):
                row[column.name] = {"中文": [None, 0, False, {"原值": "123.456"}]}
            else:
                row[column.name] = "原始记录"
        # Nulls, empty strings and False must remain distinct.
        if "notes" in row:
            row["notes"] = None
        if "specification" in row:
            row["specification"] = ""
        connection.execute(table.insert().values(**row))
        originals[(table.name, 1)] = {
            key: value.isoformat()
            if isinstance(value, datetime)
            else str(value)
            if isinstance(value, Decimal)
            else value
            for key, value in row.items()
        }
    return originals


def test_all_thirteen_tables_archive_before_drop_and_retry_is_safe(migration):
    engine = sa.create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql("PRAGMA foreign_keys=ON")
            for name in ("teams", "users"):
                connection.exec_driver_sql(f"CREATE TABLE {name} (id INTEGER PRIMARY KEY)")
                connection.exec_driver_sql(f"INSERT INTO {name} VALUES (1)")
            connection.exec_driver_sql("CREATE TABLE current_business (id INTEGER, value BLOB)")
            connection.exec_driver_sql("INSERT INTO current_business VALUES (1,X'1234')")
            create_legacy_tables(connection)
            original_team_fields = {
                column
                for name in migration.LEGACY_TABLES
                for fk in sa.inspect(connection).get_foreign_keys(name)
                if fk["referred_table"] == "teams"
                for column in fk["constrained_columns"]
            }
            assert set(TEAM_REFERENCE_FIELDS) == original_team_fields
            originals = seed_legacy_rows(connection, migration.LEGACY_TABLES)
            # More than one copy batch; the same ID in different tables is independent.
            metadata = sa.MetaData()
            order = sa.Table("work_orders", metadata, autoload_with=connection)
            first = dict(connection.execute(sa.select(order)).mappings().one())
            for key in range(2, 503):
                row = {**first, "id": key, "order_no": f"OLD-{key}", "serial_no": f"S-{key}"}
                connection.execute(order.insert().values(**row))
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
                migration.upgrade()
            names = set(sa.inspect(connection).get_table_names())
            assert not names.intersection(migration.LEGACY_TABLES)
            assert names == {"teams", "users", "current_business", "legacy_records"}
            archive = sa.Table("legacy_records", sa.MetaData(), autoload_with=connection)
            archived = {
                (row.source_table, row.source_id): row.data
                for row in connection.execute(sa.select(archive))
            }
            assert len(archived) == 514
            for key, data in originals.items():
                assert archived[key] == data
            assert archived[("work_orders", 502)]["order_no"] == "OLD-502"
            assert connection.exec_driver_sql("SELECT * FROM current_business").one() == (
                1,
                b"\x124",
            )
            assert connection.exec_driver_sql("PRAGMA foreign_key_check").all() == []
            assert connection.exec_driver_sql("PRAGMA integrity_check").scalar() == "ok"
            with pytest.raises(RuntimeError, match="完整备份"):
                migration.downgrade()
    finally:
        engine.dispose()


@pytest.mark.parametrize("failure", ["archive_conflict", "active_reference"])
def test_failed_preflight_never_drops_sources(migration, failure):
    engine = sa.create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "CREATE TABLE work_orders (id INTEGER PRIMARY KEY, name TEXT)"
            )
            connection.exec_driver_sql("INSERT INTO work_orders VALUES (1,'旧工单')")
            if failure == "archive_conflict":
                connection.exec_driver_sql(
                    "CREATE TABLE legacy_records (source_table TEXT, source_id INTEGER, data JSON, "
                    "PRIMARY KEY (source_table,source_id))"
                )
                archive = sa.Table("legacy_records", sa.MetaData(), autoload_with=connection)
                connection.execute(
                    archive.insert().values(
                        source_table="work_orders", source_id=1, data={"name": "不可覆盖的归档"}
                    )
                )
            else:
                connection.exec_driver_sql(
                    "CREATE TABLE current_business (id INTEGER, order_id INTEGER REFERENCES work_orders(id))"
                )
            with Operations.context(MigrationContext.configure(connection)):
                with pytest.raises(RuntimeError, match="differs from source|still references"):
                    migration.upgrade()
            assert connection.exec_driver_sql("SELECT * FROM work_orders").one() == (1, "旧工单")
    finally:
        engine.dispose()
