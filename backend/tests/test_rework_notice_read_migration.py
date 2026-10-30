import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text


def test_personal_receipts_migrate_without_guessing_legacy_readers(tmp_path):
    path = Path(__file__).parents[1] / "alembic/versions/20261029_0061_rework_notice_reads.py"
    spec = importlib.util.spec_from_file_location("receipt_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    engine = create_engine("sqlite:///" + str(tmp_path / "receipts.sqlite"))
    try:
        with engine.begin() as db:
            db.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY)"))
            db.execute(text("INSERT INTO users VALUES (1)"))
            db.execute(
                text("CREATE TABLE rework_notices (id INTEGER PRIMARY KEY, read_at DATETIME)")
            )
            db.execute(text("INSERT INTO rework_notices VALUES (1, '2026-10-28 08:00:00')"))
            module.op = Operations(MigrationContext.configure(db))
            module.upgrade()
            module.upgrade()
            assert db.scalar(text("SELECT count(*) FROM rework_notice_reads")) == 0
            assert db.scalar(text("SELECT read_at FROM rework_notices")) == "2026-10-28 08:00:00"
            db.execute(text("INSERT INTO rework_notice_reads VALUES (1, 1, '2026-10-29 08:00:00')"))
            with pytest.raises(RuntimeError):
                module.downgrade()
    finally:
        engine.dispose()
