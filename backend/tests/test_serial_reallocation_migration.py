"""Upgrade existing ledger rows without changing their values or batch links."""

import importlib.util
import os
import subprocess
import sys
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from app.database import Base
from sqlalchemy import CheckConstraint, MetaData, create_engine, inspect, select
from sqlalchemy.exc import IntegrityError


def test_fresh_database_reaches_reallocation_revision(tmp_path):
    database = tmp_path / "fresh.sqlite"
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=Path(__file__).parents[1],
        env={**os.environ, "DATABASE_URL": f"sqlite:///{database}"},
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
    engine = create_engine(f"sqlite:///{database}")
    try:
        with engine.connect() as connection:
            assert (
                connection.exec_driver_sql("SELECT version_num FROM alembic_version").scalar()
                == "20261009_0028"
            )
    finally:
        engine.dispose()


def test_reallocation_migration_preserves_ledger_and_only_allows_received_same_team_links():
    path = Path(__file__).parents[1] / "alembic/versions/20261009_0028_serial_reallocation.py"
    spec = importlib.util.spec_from_file_location("reallocation_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    metadata = MetaData()
    for table in Base.metadata.sorted_tables:
        table.to_metadata(metadata)
    transfers = metadata.tables["material_transfers"]
    previous = {
        "ck_mt_entry_kind_source": migration.SOURCE.split(
            " OR (entry_kind = 'serial_reallocation'"
        )[0],
        "ck_mt_entry_destination": migration.DESTINATION.replace(", 'serial_reallocation'", ""),
    }
    for constraint in list(transfers.constraints):
        if constraint.name in previous:
            transfers.constraints.remove(constraint)
    for name, condition in previous.items():
        transfers.append_constraint(CheckConstraint(condition, name=name))
    engine = create_engine("sqlite://")
    try:
        metadata.create_all(engine)
        with engine.begin() as connection:
            connection.execute(
                metadata.tables["teams"].insert(),
                {"id": 1, "code": "FACTORY-WAREHOUSE", "name": "库房", "kind": "warehouse"},
            )
            connection.execute(
                transfers.insert(),
                {
                    "id": 1,
                    "batch_no": "INTAKE-A",
                    "serial_no": "000A",
                    "entry_kind": "warehouse_receipt",
                    "next_team_id": 1,
                    "next_team_code": "FACTORY-WAREHOUSE",
                    "next_team_name": "库房",
                    "status": "received",
                    "stock_tracked": True,
                    "quantity": 100,
                    "weight": 20,
                    "created_by": "库房",
                },
            )
            events = metadata.tables["material_transfer_events"]
            connection.execute(
                events.insert(),
                {"transfer_id": 1, "action": "stocked", "actor": "库房", "changes": {}},
            )
            ledger = connection.execute(select(transfers)).all()
            audit = connection.execute(select(events)).all()
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
            assert connection.execute(select(transfers)).all() == ledger
            assert connection.execute(select(events)).all() == audit
            checks = {
                row["name"]
                for row in inspect(connection).get_check_constraints("material_transfers")
            }
            assert set(previous) <= checks
            target = {
                "batch_no": "ALLOC-B",
                "serial_no": "000B",
                "entry_kind": "serial_reallocation",
                "source_transfer_id": 1,
                "source_team_id": 1,
                "source_team_code": "FACTORY-WAREHOUSE",
                "source_team_name": "库房",
                "next_team_id": 1,
                "next_team_code": "FACTORY-WAREHOUSE",
                "next_team_name": "库房",
                "status": "received",
                "stock_tracked": True,
                "quantity": 30,
                "weight": 6,
                "created_by": "库房",
            }
            connection.execute(transfers.insert(), target)
            for invalid in (
                {"source_team_id": None},
                {"source_team_id": 2},
                {"source_transfer_id": None},
                {"status": "pending"},
                {"stock_tracked": False},
            ):
                with pytest.raises(IntegrityError):
                    connection.execute(
                        transfers.insert(), {**target, "batch_no": "INVALID", **invalid}
                    )
    finally:
        engine.dispose()
