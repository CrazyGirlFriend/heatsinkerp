import importlib.util
from pathlib import Path

from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine, inspect, select
from sqlalchemy.dialects import mysql

from app.material_transfer_query import search_predicate
from app.models import MaterialTransfer


def load_migration():
    path = Path(__file__).parents[1] / "alembic/versions/20260906_0006_transfer_query_indexes.py"
    spec = importlib.util.spec_from_file_location("query_index_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_index_migration_preserves_rows_is_repeatable_and_matches_models(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'index-migration.sqlite'}")
    migration = load_migration()
    with engine.begin() as conn:
        conn.exec_driver_sql("""CREATE TABLE material_transfers (
            id INTEGER PRIMARY KEY, created_at DATETIME, status VARCHAR(16),
            source_team_id INTEGER, next_team_id INTEGER, source_batch_no VARCHAR(80),
            customer_code VARCHAR(80), product_code VARCHAR(80), material_name VARCHAR(160),
            material_type VARCHAR(32))""")
        conn.exec_driver_sql("""INSERT INTO material_transfers VALUES
            (1, '2026-09-06 00:00:00', 'pending', 1, 2, 'RAW-1', 'C-1', 'P-1', '铜钼', 'finished')""")
        before = conn.exec_driver_sql("SELECT * FROM material_transfers").fetchall()
        with Operations.context(MigrationContext.configure(conn)):
            migration.upgrade()
            migration.upgrade()
        assert conn.exec_driver_sql("SELECT * FROM material_transfers").fetchall() == before
        actual = {row["name"]: tuple(row["column_names"]) for row in inspect(conn).get_indexes("material_transfers")}
        model = {index.name: tuple(column.name for column in index.columns) for index in MaterialTransfer.__table__.indexes}
        for name, columns in migration.INDEXES:
            assert actual[name] == model[name] == columns
        for where, index_name in (
            ("", "ix_mt_created"),
            ("WHERE status='pending'", "ix_mt_status_created"),
            ("WHERE source_team_id=1", "ix_mt_source_created"),
            ("WHERE next_team_id=2", "ix_mt_next_created"),
            ("WHERE source_team_id=1 AND status='pending'", "ix_mt_source_status_created"),
            ("WHERE next_team_id=2 AND status='pending'", "ix_mt_next_status_created"),
            ("WHERE source_batch_no='RAW-1'", "ix_mt_source_batch_created"),
            ("WHERE customer_code='C-1'", "ix_mt_customer_created"),
            ("WHERE product_code='P-1'", "ix_mt_product_created"),
            ("WHERE material_name='铜钼'", "ix_mt_material_created"),
            ("WHERE material_type='finished'", "ix_mt_type_created"),
        ):
            plan = conn.exec_driver_sql(
                f"EXPLAIN QUERY PLAN SELECT * FROM material_transfers {where} ORDER BY created_at DESC, id DESC LIMIT 20"
            ).fetchall()
            details = " ".join(row[3] for row in plan)
            assert index_name in details, details
            assert "TEMP B-TREE" not in details, details
    engine.dispose()


def test_mysql_search_compiles_bound_indexable_predicates_and_literal_wildcards():
    for mode, expected in (("exact", "ID%_!001"), ("prefix", "ID!%!_!!001%"), ("contains", "%ID!%!_!!001%")):
        statement = select(MaterialTransfer.id).where(search_predicate("ID%_!001", "serial_no", mode))
        compiled = statement.compile(dialect=mysql.dialect())
        assert expected in compiled.params.values()
        assert "ID%" not in str(compiled)  # the input is bound, never SQL text
        assert "lower(" not in str(compiled)
        if mode != "exact":
            assert "ESCAPE '!'" in str(compiled)
        else:
            assert " LIKE " not in str(compiled)
