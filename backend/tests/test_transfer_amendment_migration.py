import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from app.database import Base
from sqlalchemy import CheckConstraint, MetaData, create_engine, inspect, text
from sqlalchemy.dialects import mysql
from sqlalchemy.exc import IntegrityError
from sqlalchemy.schema import CreateTable


def migration():
    path = Path(__file__).parents[1] / "alembic/versions/20261103_0064_transfer_amendments.py"
    spec = importlib.util.spec_from_file_location("transfer_amendments_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_preserves_existing_data_is_repeatable_and_keeps_nonempty_boundary(tmp_path):
    metadata = MetaData()
    for table in Base.metadata.sorted_tables:
        table.to_metadata(metadata)
    original = metadata.tables["material_transfers"]
    prior = next(c for c in original.constraints if c.name == "ck_material_transfers_nonempty")
    original.constraints.remove(prior)
    original.append_constraint(
        CheckConstraint("quantity > 0 OR weight > 0", name="ck_material_transfers_nonempty")
    )
    engine = create_engine(f"sqlite:///{tmp_path / 'migration.sqlite'}")
    old_tables = [
        table
        for name, table in metadata.tables.items()
        if name
        not in (
            "material_transfer_amendments",
            "transfer_amendment_notices",
            "transfer_amendment_notice_reads",
        )
    ]
    metadata.create_all(engine, tables=old_tables)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO teams(id, code, name, active, sort_order, kind, opening_stock_enabled, created_at, updated_at) VALUES (1,'SOURCE','上序',1,0,'production',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),(2,'TARGET','下序',1,0,'production',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO material_transfers (id,batch_no,serial_no,entry_kind,source_team_id,source_team_code,source_team_name,next_team_id,next_team_code,next_team_name,quantity,weight,status,stock_tracked,created_by,created_at,updated_at) VALUES (1,'TL-OLD','OLD','transfer',1,'SOURCE','上序',2,'TARGET','下序',100,10,'received',1,'原签收人',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"
            )
        )
        module = migration()
        with Operations.context(MigrationContext.configure(connection)):
            module.upgrade()
            module.upgrade()
        assert connection.execute(
            text("SELECT quantity,weight,created_by FROM material_transfers WHERE id=1")
        ).one() == (100, 10, "原签收人")
        connection.execute(
            text(
                "INSERT INTO material_transfers (id,batch_no,serial_no,entry_kind,processing_role,source_transfer_id,source_team_id,source_team_code,source_team_name,next_team_id,next_team_code,next_team_name,quantity,weight,status,stock_tracked,created_by,created_at,updated_at) VALUES (2,'TL-REMAINDER','OLD','processing_output','remaining',1,2,'TARGET','下序',2,'TARGET','下序',0,0,'received',1,'修改确认',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"
            )
        )
        with pytest.raises(IntegrityError):
            connection.execute(text("UPDATE material_transfers SET quantity=0,weight=0 WHERE id=1"))
        with pytest.raises(IntegrityError):
            connection.execute(
                text("UPDATE material_transfers SET processing_role='produced' WHERE id=2")
            )
        assert connection.exec_driver_sql("PRAGMA foreign_key_check").all() == []
        assert {
            "material_transfer_amendments",
            "transfer_amendment_notices",
            "transfer_amendment_notice_reads",
        } <= set(inspect(connection).get_table_names())
    engine.dispose()


def test_amendment_schema_compiles_for_mysql():
    for name in (
        "material_transfer_amendments",
        "transfer_amendment_notices",
        "transfer_amendment_notice_reads",
    ):
        table = Base.metadata.tables[name]
        statement = str(CreateTable(table).compile(dialect=mysql.dialect()))
        assert "FOREIGN KEY" in statement
        assert all(len(c.name) <= 64 for c in table.constraints if c.name)
