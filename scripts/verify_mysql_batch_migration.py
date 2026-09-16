"""Exercise the batch migration on a disposable real MySQL 8.4 database.

The legacy mode expects the OLD release to have run revision 0001 and seed_demo.
It snapshots every pre-existing business column, runs the current Alembic CLI,
and proves the old rows/FKs survive before testing the new 1:N constraints.
The fresh mode expects an empty database. This script refuses normal DB names.

Run inside a backend image with the current backend mounted at /app, for example:
  python /verification/verify_mysql_batch_migration.py legacy --confirm-test-database
No production credentials or production databases should ever be used here.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess

from alembic.migration import MigrationContext
from alembic.operations import Operations
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError


def quoted(name: str) -> str:
    return "`" + name.replace("`", "``") + "`"


def fk_set(connection, table):
    return {
        (
            tuple(fk["constrained_columns"]), fk["referred_table"],
            tuple(fk["referred_columns"]), fk["options"].get("ondelete"),
        )
        for fk in sa.inspect(connection).get_foreign_keys(table)
    }


def assert_no_orphans(connection):
    checked = 0
    for table in sa.inspect(connection).get_table_names():
        for fk in sa.inspect(connection).get_foreign_keys(table):
            columns = fk["constrained_columns"]
            referred = fk["referred_columns"]
            join = " AND ".join(
                f"c.{quoted(c)} = p.{quoted(p)}" for c, p in zip(columns, referred)
            )
            not_null = " AND ".join(f"c.{quoted(c)} IS NOT NULL" for c in columns)
            query = (
                f"SELECT COUNT(*) FROM {quoted(table)} c LEFT JOIN "
                f"{quoted(fk['referred_table'])} p ON {join} "
                f"WHERE {not_null} AND p.{quoted(referred[0])} IS NULL"
            )
            assert connection.exec_driver_sql(query).scalar_one() == 0, (table, fk)
            checked += 1
    return checked


def assert_new_cardinality(connection):
    inspector = sa.inspect(connection)
    reports = inspector.get_unique_constraints("operation_reports")
    receipts = inspector.get_unique_constraints("operation_receipts")
    assert not any(c["column_names"] == ["operation_id"] for c in reports)
    assert not any(c["column_names"] == ["report_id"] for c in receipts)
    assert any(c["column_names"] == ["operation_id", "idempotency_key"] for c in reports)
    assert any(c["column_names"] == ["idempotency_key"] for c in receipts)


def rerun_migration(connection, backend: Path):
    path = backend / "alembic/versions/20260903_0002_batch_flow.py"
    spec = importlib.util.spec_from_file_location("mysql_batch_migration_verify", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    with Operations.context(MigrationContext.configure(connection)):
        migration.upgrade()


def run_constraint_probes(engine):
    """Probe INSERT constraints in one transaction and roll every probe back."""
    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            metadata = sa.MetaData()
            reports = sa.Table("operation_reports", metadata, autoload_with=connection)
            receipts = sa.Table("operation_receipts", metadata, autoload_with=connection)
            exceptions = sa.Table("operation_exceptions", metadata, autoload_with=connection)
            old_report = dict(connection.execute(sa.select(reports).order_by(reports.c.id)).mappings().first())
            old_receipt = dict(connection.execute(sa.select(receipts).order_by(receipts.c.id)).mappings().first())
            new_report = {**old_report, "id": 900001, "idempotency_key": "mysql-probe-report", "request_hash": "a" * 64}
            connection.execute(reports.insert().values(**new_report))
            connection.execute(reports.insert().values(**{**old_report, "id": 900002}))
            new_receipt = {**old_receipt, "id": 900001, "idempotency_key": "mysql-probe-receipt"}
            connection.execute(receipts.insert().values(**new_receipt))
            assert connection.execute(sa.select(sa.func.count()).select_from(reports).where(reports.c.operation_id == old_report["operation_id"])).scalar_one() == 3
            assert connection.execute(sa.select(sa.func.count()).select_from(receipts).where(receipts.c.report_id == old_receipt["report_id"])).scalar_one() == 2

            rejected = []
            for name, statement in (
                ("duplicate report idempotency key", reports.insert().values(**{**new_report, "id": 900003})),
                ("duplicate receipt idempotency key", receipts.insert().values(**{**new_receipt, "id": 900003})),
                ("invalid report operation FK", reports.insert().values(**{**new_report, "id": 900004, "operation_id": 999999, "idempotency_key": "invalid-fk"})),
                ("invalid receipt report FK", receipts.insert().values(**{**new_receipt, "id": 900004, "report_id": 999999, "idempotency_key": "invalid-fk"})),
            ):
                try:
                    with connection.begin_nested():
                        connection.execute(statement)
                except IntegrityError:
                    rejected.append(name)
                else:
                    raise AssertionError(f"Constraint unexpectedly allowed {name}")

            operation = connection.exec_driver_sql(
                "SELECT work_order_id FROM operations WHERE id=%s", (old_report["operation_id"],)
            ).scalar_one()
            exception = {
                "id": 900001, "work_order_id": operation,
                "operation_id": old_report["operation_id"], "report_id": old_report["id"],
                "kind": "loss", "quantity": "0.125", "reason": "真实 MySQL 迁移后的丢料原因验证",
                "operator": "临时迁移测试", "idempotency_key": "mysql-probe-exception",
                "request_hash": "b" * 64, "created_at": old_report["reported_at"],
            }
            connection.execute(exceptions.insert().values(**exception))
            stored = connection.execute(sa.select(exceptions).where(exceptions.c.id == 900001)).mappings().one()
            assert stored["reason"] == exception["reason"]
            assert str(stored["quantity"]) == "0.125"
            assert_no_orphans(connection)
            return {"reports_per_operation": 3, "receipts_per_report": 2, "constraint_rejections": rejected, "chinese_reason_and_decimal_preserved": True, "probe_rows_rolled_back": True}
        finally:
            transaction.rollback()


def legacy(engine, backend: Path):
    with engine.connect() as connection:
        assert connection.exec_driver_sql("SELECT version_num FROM alembic_version").scalar_one() == "20260901_0001"
        inspector = sa.inspect(connection)
        tables = [t for t in inspector.get_table_names() if t != "alembic_version"]
        columns = {table: [c["name"] for c in inspector.get_columns(table)] for table in tables}
        assert "sort_order" not in columns["teams"]
        assert "lost_quantity" not in columns["operation_reports"]
        assert "operation_exceptions" not in tables
        assert any(c["column_names"] == ["operation_id"] for c in inspector.get_unique_constraints("operation_reports"))
        assert any(c["column_names"] == ["report_id"] for c in inspector.get_unique_constraints("operation_receipts"))

        def snapshot(conn):
            return {
                table: [tuple(row) for row in conn.exec_driver_sql(
                    "SELECT " + ",".join(quoted(c) for c in columns[table])
                    + " FROM " + quoted(table) + " ORDER BY id"
                ).fetchall()]
                for table in tables
            }

        before = snapshot(connection)
        original_fks = {table: fk_set(connection, table) for table in tables}
        before_fk_count = assert_no_orphans(connection)
        old_collation = connection.exec_driver_sql(
            "SELECT COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='work_orders' AND COLUMN_NAME='order_no'"
        ).scalar_one()
    subprocess.run(["alembic", "upgrade", "head"], cwd=backend, check=True)
    with engine.connect() as connection:
        assert connection.exec_driver_sql("SELECT version_num FROM alembic_version").scalar_one() == "20260903_0002"
        assert snapshot(connection) == before, "Migration changed existing business rows"
        for table in tables:
            assert original_fks[table] <= fk_set(connection, table), table
        assert connection.exec_driver_sql("SELECT COUNT(*) FROM teams WHERE sort_order<>0 OR kind<>'production'").scalar_one() == 0
        assert connection.exec_driver_sql("SELECT COUNT(*) FROM operation_reports WHERE lost_quantity<>0").scalar_one() == 0
        assert connection.exec_driver_sql("SELECT COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='work_orders' AND COLUMN_NAME='order_no'").scalar_one() == old_collation
        assert_new_cardinality(connection)
        rerun_migration(connection, backend)
        assert snapshot(connection) == before
        new_fk_count = assert_no_orphans(connection)
    result = run_constraint_probes(engine)
    with engine.connect() as connection:
        assert snapshot(connection) == before, "Constraint probes did not roll back"
        assert connection.exec_driver_sql("SELECT COUNT(*) FROM operation_exceptions").scalar_one() == 0
    return {
        "scenario": "legacy_0001_to_0002", "old_rows_equal_after_upgrade_and_probes": True,
        "row_counts": {table: len(rows) for table, rows in before.items()},
        "business_snapshot_sha256": hashlib.sha256(json.dumps(before, ensure_ascii=False, default=str, sort_keys=True).encode()).hexdigest(),
        "foreign_keys_before": before_fk_count, "foreign_keys_after": new_fk_count,
        "foreign_key_orphans": 0, "work_order_number_collation_preserved": old_collation,
        "migration_repeat_is_safe": True, **result,
    }


def fresh(engine, backend: Path):
    with engine.connect() as connection:
        assert sa.inspect(connection).get_table_names() == [], "Fresh scenario requires an empty disposable DB"
    subprocess.run(["alembic", "upgrade", "head"], cwd=backend, check=True)
    with engine.connect() as connection:
        assert connection.exec_driver_sql("SELECT version_num FROM alembic_version").scalar_one() == "20260903_0002"
        assert_new_cardinality(connection)
        assert "operation_exceptions" in sa.inspect(connection).get_table_names()
        rerun_migration(connection, backend)
        foreign_keys = assert_no_orphans(connection)
        return {"scenario": "empty_database_to_head", "table_count": len(sa.inspect(connection).get_table_names()), "foreign_key_count": foreign_keys, "foreign_key_orphans": 0, "migration_repeat_is_safe": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scenario", choices=("legacy", "fresh"))
    parser.add_argument("--confirm-test-database", action="store_true", required=True)
    parser.add_argument("--backend-dir", type=Path, default=Path("/app"))
    args = parser.parse_args()
    url = sa.engine.make_url(os.environ["DATABASE_URL"])
    if (
        url.get_backend_name() != "mysql"
        or url.host not in {"127.0.0.1", "localhost", "::1"}
        or url.database not in {"heatsink_migration_legacy", "heatsink_migration_fresh"}
    ):
        parser.error("Only explicitly named disposable MySQL migration databases on loopback are allowed")
    engine = sa.create_engine(url)
    with engine.connect() as connection:
        version = connection.exec_driver_sql("SELECT VERSION()").scalar_one()
        assert version.startswith("8.4."), version
    result = (legacy if args.scenario == "legacy" else fresh)(engine, args.backend_dir)
    print(json.dumps({"mysql_version": version, "passed": True, **result}, ensure_ascii=False, indent=2))
    engine.dispose()


if __name__ == "__main__":
    main()
