"""Verify transfer migrations and EXPLAIN plans on an EMPTY disposable MySQL.

Requires --confirm-disposable, DATABASE_URL naming heatsink_index_qa, and a
network-isolated test container. Never pass business database credentials.
Leaves the disposable database for inspection; container cleanup is external.
"""

import argparse
from datetime import datetime, timedelta
import importlib.util
import json
from pathlib import Path

from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
import sqlalchemy as sa

from app.database import Base, engine
from app.material_transfer_query import search_predicate
from app.models import MaterialTransfer, Team


def migration(filename):
    path = Path(__file__).resolve().parents[1] / "backend/alembic/versions" / filename
    spec = importlib.util.spec_from_file_location(filename.removesuffix(".py"), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def nodes(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from nodes(child)
    elif isinstance(value, list):
        for child in value:
            yield from nodes(child)


def explain(connection, statement):
    compiled = statement.compile(dialect=connection.dialect)
    result = json.loads(connection.exec_driver_sql(
        "EXPLAIN FORMAT=JSON " + str(compiled), compiled.params,
    ).scalar_one())
    table = next(node for node in nodes(result) if node.get("table_name") == "material_transfers")
    return {
        "key": table.get("key"), "access_type": table["access_type"],
        "estimated_rows": table.get("rows_examined_per_scan"),
        "filesort": any(node.get("using_filesort") is True for node in nodes(result)),
    }


def run():
    parser = argparse.ArgumentParser()
    parser.add_argument("--confirm-disposable", action="store_true", required=True)
    parser.parse_args()
    if engine.dialect.name != "mysql" or engine.url.database != "heatsink_index_qa":
        raise RuntimeError("Only disposable MySQL database heatsink_index_qa is allowed")
    old = migration("20260906_0004_material_transfers.py")
    document = migration("20260906_0005_transfer_document.py")
    indexes = migration("20260906_0006_transfer_query_indexes.py")
    stock = migration("20260906_0007_team_material_stock.py")
    with engine.connect() as conn:
        if sa.inspect(conn).get_table_names():
            raise RuntimeError("Verification requires an empty disposable database")
        version = conn.exec_driver_sql("SELECT VERSION()").scalar_one()
        Base.metadata.create_all(conn, tables=[
            table for table in Base.metadata.sorted_tables
            if table.name not in {"material_transfers", "material_transfer_events", "material_dispatches", "material_losses"}
        ])
        with Operations.context(MigrationContext.configure(conn)):
            old.upgrade()
        conn.execute(Team.__table__.insert(), [
            {"id": i, "code": f"QA-{i:03d}", "name": f"测试班组-{i:03d}", "active": True}
            for i in range(1, 101)
        ])
        conn.exec_driver_sql("""INSERT INTO material_transfers
            (id,batch_no,serial_no,source_team_id,source_team_code,source_team_name,
             next_team_id,next_team_code,next_team_name,quantity,weight,status,created_by,created_at,updated_at)
            VALUES (1,'TL20260906000000','LEGACY-PRESERVED',1,'QA-001','测试班组-001',
                    2,'QA-002','测试班组-002',12,3.25,'received','测试操作人',
                    '2026-09-06 00:00:00','2026-09-06 00:00:00')""")
        legacy = dict(conn.exec_driver_sql("SELECT * FROM material_transfers WHERE id=1").mappings().one())
        conn.commit()
        with Operations.context(MigrationContext.configure(conn)):
            document.upgrade()
            document.upgrade()
        upgraded = dict(conn.exec_driver_sql("SELECT * FROM material_transfers WHERE id=1").mappings().one())
        assert {key: upgraded[key] for key in legacy} == legacy
        assert upgraded["material_type"] is None and upgraded["version"] == 1
        assert conn.exec_driver_sql("SELECT COUNT(*) FROM material_transfer_events").scalar_one() == 0
        # Current ORM inserts include stock columns. Install their additive
        # migration before comparing the original 0006 query indexes.
        with Operations.context(MigrationContext.configure(conn)):
            stock.upgrade()

        kinds = ("finished", "finished_surplus", "semi_finished_surplus", "defective", "waste", "sludge", "scrap_chips")
        for start in range(0, 12000, 500):
            rows = []
            for i in range(start + 1, start + 501):
                source, target = i % 100 + 1, (i + 37) % 100 + 1
                created = datetime(2026, 9, 1) + timedelta(minutes=i)
                rows.append({
                    "batch_no": f"TL20260906{i:06d}", "serial_no": f"SER-{i % 600:04d}",
                    "source_team_id": source, "source_team_code": f"QA-{source:03d}",
                    "source_team_name": f"测试班组-{source:03d}",
                    "next_team_id": target, "next_team_code": f"QA-{target:03d}",
                    "next_team_name": f"测试班组-{target:03d}", "quantity": 12, "weight": 3.25,
                    "status": ("pending", "received", "voided")[i % 3], "created_by": "测试操作人",
                    "created_at": created, "updated_at": created, "material_type": kinds[i % 7],
                    "source_batch_no": f"RAW-{i:06d}", "customer_code": f"CUS-{i % 500:04d}",
                    "product_code": f"PROD-{i % 1000:04d}", "material_name": f"铜钼-{i % 500:04d}",
                })
            conn.execute(MaterialTransfer.__table__.insert(), rows)
        conn.commit()
        order = (MaterialTransfer.created_at.desc(), MaterialTransfer.id.desc())
        queries = {}
        for label, clauses in (
            ("default_page", ()), ("status", (MaterialTransfer.status == "pending",)),
            ("source", (MaterialTransfer.source_team_id == 10,)),
            ("target", (MaterialTransfer.next_team_id == 10,)),
            ("source_status", (MaterialTransfer.source_team_id == 10, MaterialTransfer.status == "pending")),
            ("target_status", (MaterialTransfer.next_team_id == 10, MaterialTransfer.status == "pending")),
            ("material_type", (MaterialTransfer.material_type == "sludge",)),
        ):
            queries[label] = sa.select(MaterialTransfer).where(*clauses).order_by(*order).limit(20)
        for field, term in (
            ("batch_no", "TL20260906000123"), ("serial_no", "SER-0123"),
            ("source_batch_no", "RAW-000123"), ("customer_code", "CUS-0123"),
            ("product_code", "PROD-0123"), ("material_name", "铜钼-0123"),
        ):
            for mode in ("exact", "prefix"):
                query_term = term if mode == "exact" else term[:-1]
                queries[f"{field}_{mode}"] = sa.select(MaterialTransfer).where(
                    search_predicate(query_term, field, mode)
                ).order_by(*order).limit(20)
        conn.exec_driver_sql("ANALYZE TABLE material_transfers")
        before = {label: explain(conn, query) for label, query in queries.items()}
        conn.commit()
        with Operations.context(MigrationContext.configure(conn)):
            indexes.upgrade()
            indexes.upgrade()
        conn.exec_driver_sql("ANALYZE TABLE material_transfers")
        actual = {row["name"]: tuple(row["column_names"]) for row in sa.inspect(conn).get_indexes("material_transfers")}
        assert all(actual[name] == columns for name, columns in indexes.INDEXES)
        after = {label: explain(conn, query) for label, query in queries.items()}
        for label, plan in after.items():
            assert plan["key"] and plan["access_type"] != "ALL", (label, plan)
            if not label.endswith("_prefix"):
                assert not plan["filesort"], (label, plan)
        count = conn.exec_driver_sql("SELECT COUNT(*) FROM material_transfers").scalar_one()
        assert count == 12001
        final_legacy = dict(conn.exec_driver_sql("SELECT * FROM material_transfers WHERE id=1").mappings().one())
        assert {key: final_legacy[key] for key in legacy} == legacy
        print(json.dumps({
            "mysql_version": version, "rows": count, "verified_indexes": len(indexes.INDEXES),
            "legacy_preserved": True, "before": before, "after": after,
        }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    run()
