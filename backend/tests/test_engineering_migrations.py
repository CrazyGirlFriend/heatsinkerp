"""Engineering migrations support both the current baseline and pre-rework databases."""

import importlib.util
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text

BACKEND = Path(__file__).parents[1]


def test_fresh_database_upgrades_to_head_and_can_run_again(tmp_path):
    database = tmp_path / "fresh.sqlite"
    for _ in range(2):
        result = subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=BACKEND,
            env={**os.environ, "DATABASE_URL": f"sqlite:///{database}"},
            capture_output=True,
            text=True,
            timeout=120,
        )
        assert result.returncode == 0, result.stdout + result.stderr
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT version_num FROM alembic_version").fetchone() == (
            "20261027_0057",
        )
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)


def test_pre_rework_upgrade_preserves_originals_and_does_not_reset_delivery_deadline(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'old.sqlite'}")
    try:
        with engine.begin() as connection:
            for sql in (
                "CREATE TABLE teams (id INTEGER PRIMARY KEY)",
                "INSERT INTO teams VALUES (1)",
                """CREATE TABLE process_routes (
                    id INTEGER PRIMARY KEY, parent_id INTEGER, serial_nos JSON,
                    source_file BLOB, updated_at DATETIME)""",
                """INSERT INTO process_routes VALUES
                    (1, NULL, '["S-1"]', X'1234', '2026-10-23 00:00:00')""",
                """CREATE TABLE material_transfers (
                    id INTEGER PRIMARY KEY, entry_kind TEXT, source_team_id INTEGER,
                    source_team_code TEXT, source_team_name TEXT, next_team_id INTEGER,
                    next_team_code TEXT, next_team_name TEXT, external_destination TEXT,
                    source_transfer_id INTEGER, dispatch_id INTEGER, status TEXT,
                    stock_tracked INTEGER,
                    CONSTRAINT ck_mt_entry_kind_source CHECK (1=1),
                    CONSTRAINT ck_mt_entry_destination CHECK (1=1))""",
                """INSERT INTO material_transfers (id, entry_kind, next_team_id,
                    next_team_code, next_team_name, status, stock_tracked)
                    VALUES (1, 'warehouse_receipt', 1, 'WAREHOUSE', '库房', 'received', 1)""",
                "CREATE TABLE material_quantity_adjustments (id INTEGER PRIMARY KEY)",
                "CREATE TABLE material_inspections (id INTEGER PRIMARY KEY)",
                "CREATE TABLE production_schedule_tasks (id INTEGER PRIMARY KEY)",
                "INSERT INTO production_schedule_tasks VALUES (1)",
                """CREATE TABLE production_schedules (id INTEGER PRIMARY KEY,
                    task_id INTEGER, due_at DATETIME, cancelled_at DATETIME, sequence_no INTEGER)""",
                """INSERT INTO production_schedules VALUES
                    (1, 1, '2026-10-28 15:00:00', NULL, 1)""",
                "CREATE TABLE process_route_policy (id INTEGER PRIMARY KEY, enforced_after DATETIME)",
            ):
                connection.exec_driver_sql(sql)
            migrations = []
            for filename in (
                "20261024_0052_rework_routes.py",
                "20261025_0053_process_route_serials.py",
                "20261025_0054_process_route_archives.py",
                "20261026_0055_rework_notices.py",
                "20261026_0056_processing_schedules.py",
                "20261027_0057_rework_original_schedule.py",
            ):
                path = BACKEND / "alembic" / "versions" / filename
                spec = importlib.util.spec_from_file_location(filename, path)
                migration = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(migration)
                migration.op = Operations(MigrationContext.configure(connection))
                migration.upgrade()
                migrations.append(migration)
            assert connection.scalar(text("SELECT source_file FROM process_routes")) == b"\x12\x34"
            assert connection.execute(
                text(
                    "SELECT route_kind, rework_source_transfer_id, original_schedule_id FROM process_routes"
                )
            ).one() == ("normal", None, None)
            assert connection.scalar(
                text("SELECT final_due_at FROM production_schedule_tasks")
            ) == ("2026-10-28 15:00:00")
            connection.execute(
                text("UPDATE production_schedule_tasks SET final_due_at='2026-10-27 15:00:00'")
            )
            for migration in migrations:
                migration.upgrade()
            assert connection.scalar(
                text("SELECT final_due_at FROM production_schedule_tasks")
            ) == ("2026-10-27 15:00:00")
            assert connection.scalar(text("SELECT source_file FROM process_routes")) == b"\x12\x34"
            assert {
                fk["referred_table"]
                for fk in inspect(connection).get_foreign_keys("process_routes")
            } >= {
                "material_transfers",
                "material_quantity_adjustments",
                "material_inspections",
                "production_schedules",
                "teams",
                "process_routes",
            }
            assert connection.exec_driver_sql("PRAGMA foreign_key_check").all() == []
    finally:
        engine.dispose()
