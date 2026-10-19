import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from app.models import InspectionFeedbackEvent, InspectionFeedbackTeam, MaterialInspection
from sqlalchemy import create_engine, inspect


def migration(name):
    path = Path(__file__).parents[1] / "alembic" / "versions" / name
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_upgrade_is_repeatable_preserves_legacy_hold_and_all_schema_columns():
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as conn:
            for name in (
                "teams",
                "team_employees",
                "users",
                "material_quantity_adjustments",
                "material_transfers",
            ):
                conn.exec_driver_sql(f"CREATE TABLE {name} (id INTEGER PRIMARY KEY)")
            with Operations.context(MigrationContext.configure(conn)):
                migration("20261019_0039_inspections.py").upgrade()
            conn.exec_driver_sql("""INSERT INTO material_inspections
                (id,source_transfer_id,team_id,inspection_team_id,inspector_employee_id,inspector_name,
                checked_at,batch_quantity,sample_quantity,failed_quantity,notes,idempotency_key,request_hash,created_by,created_at)
                VALUES (1,1,1,1,1,'旧检验人','2026-10-18',100,10,2,'旧问题','old','hash','QC','2026-10-18')""")
            with Operations.context(MigrationContext.configure(conn)):
                upgrade = migration("20261019_0041_quality_feedback.py")
                upgrade.upgrade()
                upgrade.upgrade()
            schema = inspect(conn)
            for model in (MaterialInspection, InspectionFeedbackTeam, InspectionFeedbackEvent):
                assert {c["name"] for c in schema.get_columns(model.__tablename__)} == set(
                    model.__table__.columns.keys()
                )
            assert conn.exec_driver_sql(
                "SELECT failed_quantity, blocks_outbound, released_at, scope, kind FROM material_inspections"
            ).one() == (2, 1, None, "sample", "patrol")
            assert (
                conn.exec_driver_sql("SELECT COUNT(*) FROM inspection_feedback_teams").scalar() == 0
            )
    finally:
        engine.dispose()
