import importlib.util
from pathlib import Path
from unittest.mock import patch

from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine, text


def test_migration_preserves_shared_history_and_counts_physical_not_owned():
    file = Path(__file__).parents[1] / "alembic/versions/20260928_0024_warehouse_placements.py"
    spec = importlib.util.spec_from_file_location("placement_migration", file)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as db:
            db.execute(
                text(
                    "CREATE TABLE warehouse_locations (id INTEGER PRIMARY KEY, team_id INTEGER, name TEXT)"
                )
            )
            db.execute(
                text(
                    "CREATE TABLE material_transfers (id INTEGER PRIMARY KEY, next_team_id INTEGER, warehouse_location TEXT, status TEXT, quantity INTEGER, weight NUMERIC)"
                )
            )
            db.execute(
                text(
                    "CREATE TABLE material_stock_balances (transfer_id INTEGER PRIMARY KEY, on_hand_quantity INTEGER, on_hand_weight NUMERIC, reserved_quantity INTEGER, reserved_weight NUMERIC, in_transit_quantity INTEGER, in_transit_weight NUMERIC)"
                )
            )
            db.execute(text("INSERT INTO warehouse_locations VALUES (1,1,'A'),(2,1,'B')"))
            db.execute(
                text(
                    "INSERT INTO material_transfers VALUES (1,1,'A','received',100,10), (2,1,'A','received',100,10), (3,1,'B','pending',10,1), (4,1,'A','received',100,10)"
                )
            )
            # Internal pending 30 has left; external pending 20 has not.
            db.execute(
                text(
                    "INSERT INTO material_stock_balances VALUES (1,70,7,30,3,30,3),(2,80,8,20,2,0,0),(4,0,0,100,10,100,10)"
                )
            )
            with patch.object(migration, "op", Operations(MigrationContext.configure(db))):
                migration.upgrade()
                assert db.execute(
                    text(
                        "SELECT transfer_id, quantity, weight FROM warehouse_placements ORDER BY transfer_id"
                    )
                ).all() == [(1, 70, 7), (2, 100, 10), (3, 10, 1)]
                db.execute(text("DELETE FROM warehouse_placements WHERE transfer_id=1"))
                migration.upgrade()
                assert db.execute(text("SELECT count(*) FROM warehouse_placements")).scalar() == 2
                assert (
                    db.execute(
                        text("SELECT warehouse_location FROM material_transfers WHERE id=1")
                    ).scalar()
                    == "A"
                )
    finally:
        engine.dispose()
