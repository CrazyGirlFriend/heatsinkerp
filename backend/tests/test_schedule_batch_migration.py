import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text


def test_batch_migration_is_repeatable_preserves_old_progress_and_never_invents_start(tmp_path):
    path = Path(__file__).parents[1] / "alembic/versions/20261027_0058_schedule_batches.py"
    spec = importlib.util.spec_from_file_location("batch_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    engine = create_engine("sqlite:///" + str(tmp_path / "batches.sqlite"))
    try:
        with engine.begin() as connection:
            connection.execute(text("CREATE TABLE production_schedules (id INTEGER PRIMARY KEY)"))
            connection.execute(text("CREATE TABLE material_transfers (id INTEGER PRIMARY KEY)"))
            connection.execute(
                text(
                    "CREATE TABLE production_schedule_deliveries (transfer_id INTEGER PRIMARY KEY REFERENCES material_transfers(id), schedule_id INTEGER NOT NULL REFERENCES production_schedules(id))"
                )
            )
            connection.execute(text("INSERT INTO production_schedules VALUES (1)"))
            connection.execute(text("INSERT INTO material_transfers VALUES (9)"))
            connection.execute(text("INSERT INTO production_schedule_deliveries VALUES (9, 1)"))
            module.op = Operations(MigrationContext.configure(connection))
            module.upgrade()
            module.upgrade()
            assert connection.execute(
                text("SELECT * FROM production_schedule_deliveries")
            ).all() == [(9, 1, None)]
            assert connection.scalar(text("SELECT count(*) FROM production_schedule_batches")) == 0
            connection.execute(
                text(
                    "INSERT INTO production_schedule_batches (schedule_id,batch_number,planned_start_at,due_at,target_quantity,upstream_batch_ids) VALUES (1,1,'2026-10-27 08:00:00','2026-10-28 08:00:00',40,'[]')"
                )
            )
            with pytest.raises(RuntimeError):
                module.downgrade()
    finally:
        engine.dispose()


def test_handover_only_migration_retains_history_and_accepts_unknown_start(tmp_path):
    path = Path(__file__).parents[1] / "alembic/versions/20261105_0067_handover_only_plans.py"
    spec = importlib.util.spec_from_file_location("handover_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    engine = create_engine("sqlite:///" + str(tmp_path / "handover.sqlite"))
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    """CREATE TABLE production_schedule_batches (
                        id INTEGER PRIMARY KEY,
                        planned_start_at DATETIME NOT NULL,
                        due_at DATETIME NOT NULL,
                        CONSTRAINT ck_psb_period CHECK (planned_start_at < due_at)
                    )"""
                )
            )
            connection.execute(
                text(
                    "INSERT INTO production_schedule_batches VALUES (1, '2026-11-01 08:00:00', '2026-11-02 08:00:00')"
                )
            )
            connection.execute(
                text(
                    "CREATE TABLE delivery (batch_id INTEGER REFERENCES production_schedule_batches(id))"
                )
            )
            connection.execute(text("INSERT INTO delivery VALUES (1)"))
            module.op = Operations(MigrationContext.configure(connection))
            module.upgrade()
            connection.execute(
                text(
                    "INSERT INTO production_schedule_batches VALUES (2, NULL, '2026-11-03 08:00:00')"
                )
            )
            assert (
                connection.scalar(
                    text("SELECT planned_start_at FROM production_schedule_batches WHERE id=1")
                )
                == "2026-11-01 08:00:00"
            )
            assert connection.scalar(text("SELECT batch_id FROM delivery")) == 1
            assert connection.execute(text("PRAGMA foreign_key_check")).all() == []
            with pytest.raises(RuntimeError):
                module.downgrade()
    finally:
        engine.dispose()
