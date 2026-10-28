import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text


def test_notice_migration_preserves_business_rows_and_is_repeatable(tmp_path):
    path = Path(__file__).parents[1] / "alembic/versions/20261027_0059_schedule_notices.py"
    spec = importlib.util.spec_from_file_location("notice_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    engine = create_engine("sqlite:///" + str(tmp_path / "notices.sqlite"))
    try:
        with engine.begin() as db:
            for table in ("production_schedules", "users", "teams"):
                db.execute(text(f"CREATE TABLE {table} (id INTEGER PRIMARY KEY)"))
                db.execute(text(f"INSERT INTO {table} VALUES (1)"))
            module.op = Operations(MigrationContext.configure(db))
            module.upgrade()
            module.upgrade()
            assert db.scalar(text("SELECT count(*) FROM production_schedules")) == 1
            assert db.scalar(text("SELECT count(*) FROM schedule_notices")) == 0
            assert {i["name"] for i in inspect(db).get_indexes("schedule_notices")} == {
                "ix_sn_team_id"
            }
            db.execute(
                text(
                    "INSERT INTO schedule_notices (event_key,schedule_id,team_id,kind,message,created_at) VALUES ('test',1,1,'new','新增排期','2026-10-27 08:00:00')"
                )
            )
            with pytest.raises(RuntimeError):
                module.downgrade()
    finally:
        engine.dispose()
