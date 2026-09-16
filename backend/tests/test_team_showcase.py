from sqlalchemy import select

from app.database import SessionLocal
from app.models import MaterialTransfer, Team, User, TransferBatchNumberSequence
from app.material_stock import overview, list_stock, list_dispatches, list_losses
from app.reset_business_data import business_counts, reset_business_data
from app.seed_team_material_showcase import seed_team_material_showcase, DEMO_USERS, summary
from app.legacy_models import Product, WorkOrder, Operation, ProductRouteOperation


def test_eight_team_showcase_and_reset_preserve_identity_and_counters(client):
    with SessionLocal() as db:
        admin = db.scalar(select(User).where(User.username == "admin"))
        original_password = admin.password_hash
        product = Product(code="LEGACY-TEST", name="旧演示产品")
        db.add(product)
        db.flush()
        order = WorkOrder(order_no="LEGACY-WO", product_id=product.id, product_name=product.name, planned_quantity=10, created_by="旧演示")
        db.add(order)
        db.flush()
        db.add_all([Operation(work_order_id=order.id, sequence=1, code="OLD", name="旧工序"), ProductRouteOperation(product_id=product.id, sequence=1, code="OLD", name="旧工艺")])
        db.commit()
        result = seed_team_material_showcase(db, "LocalDemoOnly123!")
        assert result["material_transfers"] == 433
        assert result["material_dispatches"] == 376
        assert result["material_losses"] == 192
        for username in DEMO_USERS:
            leader = db.scalar(select(User).where(User.username == username))
            totals = overview(db, leader.team_id)
            assert len(totals["materials"]) == 6
            assert totals["legacy_received_count"] == 0
            assert totals["totals"]["available_quantity"] > 0
            assert totals["pending_incoming"]["count"] >= 20
            stock = list_stock(db, leader.team_id, leader)
            assert len(stock["items"]) == 20
            assert stock["total"] >= 24
            assert len(list_losses(db, leader.team_id)["items"]) == 20
            assert len(list_dispatches(db, leader.team_id, leader)["items"]) == 20
            assert all(row["available_quantity"] >= 0 and row["available_weight"] >= 0 for row in list_stock(db, leader.team_id, leader, page_size=100)["items"])
        confirmed = db.scalars(select(MaterialTransfer).where(MaterialTransfer.status == "received", MaterialTransfer.entry_kind == "transfer")).all()
        assert all(item.source_transfer_id and item.stock_tracked and item.received_by_user_id for item in confirmed)
        before = summary(db)
        rerun = seed_team_material_showcase(db, "")
        assert rerun["skipped"]
        assert summary(db) == before
        users_before = [(u.id, u.username, u.team_id, u.password_hash) for u in db.scalars(select(User).order_by(User.id))]
        teams_before = [(t.id, t.code, t.name) for t in db.scalars(select(Team).order_by(Team.id))]
        counters = list(db.execute(select(TransferBatchNumberSequence.sequence_date, TransferBatchNumberSequence.last_value)))
        db.commit()
        # Foreign-key checks remain enabled while deleting linked child lots.
        db.connection().exec_driver_sql("PRAGMA foreign_keys=ON")
        db.commit()
        deleted = reset_business_data(db)
        assert deleted["work_orders"] == deleted["products"] == deleted["operations"] == deleted["product_route_operations"] == 1
        assert deleted["material_transfers"] == before["material_transfers"]
        assert all(count == 0 for count in business_counts(db).values())
        assert [(u.id, u.username, u.team_id, u.password_hash) for u in db.scalars(select(User).order_by(User.id))] == users_before
        assert [(t.id, t.code, t.name) for t in db.scalars(select(Team).order_by(Team.id))] == teams_before
        assert list(db.execute(select(TransferBatchNumberSequence.sequence_date, TransferBatchNumberSequence.last_value))) == counters
        assert db.scalar(select(User).where(User.username == "admin")).password_hash == original_password
        db.commit()
        db.connection().exec_driver_sql("PRAGMA foreign_keys=OFF")
        db.commit()
