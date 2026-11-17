"""Schema cleanup preserves active records and consolidates every contact."""

import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from app.database import Base
from sqlalchemy import create_engine, inspect


@pytest.fixture
def migration():
    path = Path(__file__).parents[1] / "alembic/versions/20261117_0074_retired_schema.py"
    spec = importlib.util.spec_from_file_location("retired_schema", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def legacy_schema(db, *, named_fk):
    constraint = "CONSTRAINT fk_pst_business_person " if named_fk else ""
    statements = [
        "CREATE TABLE business_people (id INTEGER PRIMARY KEY, name TEXT, active BOOLEAN)",
        "INSERT INTO business_people VALUES (1,'旧业务员',0),(2,'业务员二',1),(3,'业务员三',1)",
        "CREATE TABLE production_schedule_tasks (id INTEGER PRIMARY KEY, serial_no TEXT, "
        "title TEXT, version INTEGER, business_person_id INTEGER, locked_at DATETIME, "
        f"{constraint}FOREIGN KEY (business_person_id) REFERENCES business_people(id) "
        "ON DELETE RESTRICT)",
        "CREATE INDEX ix_pst_serial ON production_schedule_tasks(serial_no,id)",
        "CREATE INDEX ix_pst_business_person ON production_schedule_tasks(business_person_id)",
        "INSERT INTO production_schedule_tasks VALUES "
        "(1,'A','第一批',3,1,'2026-11-01'), (2,'A','第二批',4,2,NULL), "
        "(3,'B','第一批',5,NULL,NULL), (4,'A','第三批',6,1,NULL)",
        "CREATE TABLE production_schedule_task_people ("
        "task_id INTEGER REFERENCES production_schedule_tasks(id) ON DELETE CASCADE, "
        "person_id INTEGER REFERENCES business_people(id) ON DELETE RESTRICT, "
        "PRIMARY KEY (task_id,person_id))",
        "INSERT INTO production_schedule_task_people VALUES (2,2),(2,3),(3,3),(4,2)",
        "CREATE TABLE production_schedules (id INTEGER PRIMARY KEY, "
        "task_id INTEGER REFERENCES production_schedule_tasks(id) ON DELETE RESTRICT, "
        "target_quantity INTEGER, due_at DATETIME)",
        "INSERT INTO production_schedules VALUES (1,1,40,'2026-12-01'),(2,2,60,'2026-12-02')",
        "CREATE TABLE material_transfers (id INTEGER PRIMARY KEY, quantity INTEGER, weight NUMERIC)",
        "INSERT INTO material_transfers VALUES (1,40,4),(2,60,6)",
        "CREATE TABLE production_schedule_deliveries ("
        "transfer_id INTEGER PRIMARY KEY REFERENCES material_transfers(id), "
        "schedule_id INTEGER REFERENCES production_schedules(id))",
        "INSERT INTO production_schedule_deliveries VALUES (1,1),(2,2)",
        "CREATE TABLE material_inspections (id INTEGER PRIMARY KEY, "
        "transfer_id INTEGER REFERENCES material_transfers(id), notes TEXT)",
        "INSERT INTO material_inspections VALUES (1,1,'待处理质量问题')",
        "CREATE TABLE process_routes (id INTEGER PRIMARY KEY, content BLOB)",
        "INSERT INTO process_routes VALUES (1,X'010203')",
        "CREATE TABLE material_transfer_amendments (id INTEGER PRIMARY KEY, "
        "transfer_id INTEGER REFERENCES material_transfers(id), reason TEXT)",
        "INSERT INTO material_transfer_amendments VALUES (1,1,'历史交接更正')",
        "CREATE TABLE notification_outbox (id INTEGER PRIMARY KEY, payload JSON)",
        "INSERT INTO notification_outbox VALUES (1,'{" + '"team_ids":[1]' + "}')",
        "CREATE TABLE users (id INTEGER PRIMARY KEY)",
        "INSERT INTO users VALUES (1)",
        "CREATE TABLE serial_delivery_plans (serial_no TEXT PRIMARY KEY, installments JSON)",
        "INSERT INTO serial_delivery_plans VALUES ('A','[]')",
    ]
    for sql in statements:
        db.exec_driver_sql(sql)
    for prefix, parent in (
        ("schedule", "production_schedules"),
        ("quality", "material_inspections"),
        ("rework", "process_routes"),
        ("transfer_amendment", "material_transfer_amendments"),
    ):
        db.exec_driver_sql(
            f"CREATE TABLE {prefix}_notices (id INTEGER PRIMARY KEY, "
            f"parent_id INTEGER REFERENCES {parent}(id) ON DELETE RESTRICT, message TEXT)"
        )
        db.exec_driver_sql(f"INSERT INTO {prefix}_notices VALUES (1,1,'停用通知')")
        db.exec_driver_sql(
            f"CREATE TABLE {prefix}_notice_reads (user_id INTEGER REFERENCES users(id), "
            f"notice_id INTEGER REFERENCES {prefix}_notices(id) ON DELETE CASCADE, "
            "read_at DATETIME, PRIMARY KEY (user_id,notice_id))"
        )
        db.exec_driver_sql(f"INSERT INTO {prefix}_notice_reads VALUES (1,1,'2026-11-01')")


@pytest.mark.parametrize("named_fk", [False, True])
def test_upgrade_merges_contacts_and_preserves_active_records(migration, named_fk):
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as db:
            legacy_schema(db, named_fk=named_fk)
            assert db.exec_driver_sql("PRAGMA foreign_key_check").all() == []
            kept_tables = (
                set(inspect(db).get_table_names())
                - set(migration.RETIRED_TABLES)
                - {
                    "production_schedule_tasks",
                    "production_schedule_task_people",
                }
            )
            before = {
                t: db.exec_driver_sql(f"SELECT * FROM {t} ORDER BY 1").all() for t in kept_tables
            }
            tasks = db.exec_driver_sql(
                "SELECT id,serial_no,title,version FROM production_schedule_tasks ORDER BY id"
            ).all()
            with Operations.context(MigrationContext.configure(db)):
                migration.upgrade()
                migration.upgrade()
            inspector = inspect(db)
            assert not set(migration.RETIRED_TABLES) & set(inspector.get_table_names())
            assert not {"business_person_id", "locked_at"} & {
                c["name"] for c in inspector.get_columns("production_schedule_tasks")
            }
            assert inspector.get_foreign_keys("production_schedule_tasks") == []
            assert [i["name"] for i in inspector.get_indexes("production_schedule_tasks")] == [
                "ix_pst_serial"
            ]
            assert db.exec_driver_sql(
                "SELECT * FROM production_schedule_task_people ORDER BY task_id,person_id"
            ).all() == [(1, 1), (2, 2), (2, 3), (3, 3), (4, 1), (4, 2)]
            assert (
                db.exec_driver_sql(
                    "SELECT id,serial_no,title,version FROM production_schedule_tasks ORDER BY id"
                ).all()
                == tasks
            )
            for table, original in before.items():
                assert db.exec_driver_sql(f"SELECT * FROM {table} ORDER BY 1").all() == original
            assert db.exec_driver_sql("PRAGMA foreign_key_check").all() == []
            assert db.exec_driver_sql("PRAGMA integrity_check").scalar() == "ok"
            with pytest.raises(RuntimeError, match="完整备份"):
                migration.downgrade()
    finally:
        engine.dispose()


def test_sqlite_foreign_key_guard_prevents_cascade_data_loss(migration):
    engine = create_engine("sqlite://")
    try:
        with engine.connect() as db:
            legacy_schema(db, named_fk=True)
            db.commit()
            db.exec_driver_sql("PRAGMA foreign_keys=ON")
            with Operations.context(MigrationContext.configure(db)):
                with pytest.raises(RuntimeError, match="foreign_keys"):
                    migration.upgrade()
            assert db.exec_driver_sql("SELECT COUNT(*) FROM production_schedules").scalar() == 2
            assert (
                db.exec_driver_sql("SELECT COUNT(*) FROM production_schedule_task_people").scalar()
                == 4
            )
            assert set(migration.RETIRED_TABLES) <= set(inspect(db).get_table_names())
    finally:
        engine.dispose()


def test_current_metadata_is_already_clean_and_accepts_repeat_upgrade(migration):
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as db:
            Base.metadata.create_all(db)
            before = set(inspect(db).get_table_names())
            assert not set(migration.RETIRED_TABLES) & before
            with Operations.context(MigrationContext.configure(db)):
                migration.upgrade()
                migration.upgrade()
            assert set(inspect(db).get_table_names()) == before
    finally:
        engine.dispose()
