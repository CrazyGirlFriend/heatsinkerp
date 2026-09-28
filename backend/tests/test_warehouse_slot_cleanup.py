import pytest
from sqlalchemy import select

from app.database import SessionLocal
from app.models import AdminAuditEvent, MaterialStockBalance, MaterialTransfer, WarehousePlacement
from app.warehouse_slot_cleanup import apply_plan, preview
from test_warehouse_receipts import warehouse, intake  # noqa: F401
from test_warehouse_location_locks import create_slot


def legacy(client, warehouse):
    slot = create_slot(client, "旧共用仓位")
    sources = [
        intake(
            client,
            warehouse,
            idempotency_key=f"old-{i}",
            quantity=0 if i == 2 else 10,
            weight=i + 1,
        ).json()
        for i in range(3)
    ]
    with SessionLocal() as db, db.begin():
        for row in sources:
            db.add(
                WarehousePlacement(
                    location_id=slot["id"],
                    transfer_id=row["id"],
                    quantity=row["quantity"],
                    weight=row["weight"],
                )
            )
    return slot, sources


def snapshot(db, model):
    return [
        dict(row)
        for row in db.execute(
            select(model.__table__).order_by(*model.__table__.primary_key.columns)
        ).mappings()
    ]


def test_cleanup_preserves_documents_balances_and_moves_extras_to_unassigned(client, warehouse):
    slot, sources = legacy(client, warehouse)
    with SessionLocal() as db:
        documents = snapshot(db, MaterialTransfer)
        balances = snapshot(db, MaterialStockBalance)
        plan = preview(db)
        assert len(plan["locations"]) == 1
        assert plan["locations"][0]["keep"]["transfer_id"] == sources[0]["id"]
    with SessionLocal() as db, db.begin():
        assert apply_plan(db, plan) == {"locations": 1, "unassigned": 2}
    with SessionLocal() as db:
        assert snapshot(db, MaterialTransfer) == documents
        assert snapshot(db, MaterialStockBalance) == balances
        assert db.scalar(select(WarehousePlacement.transfer_id)) == sources[0]["id"]
        assert (
            db.scalar(select(AdminAuditEvent).where(AdminAuditEvent.action == "unassigned")).changes
            == plan["locations"][0]
        )
        assert preview(db)["locations"] == []
    result = client.get(
        f"/api/team-materials/{warehouse['team']['id']}/stock",
        params={"location_status": "unassigned", "availability": "all"},
    ).json()
    assert {row["transfer"]["id"] for row in result["items"]} == {row["id"] for row in sources[1:]}
    assert (
        client.get("/api/warehouse-locations").json()["items"][0]["version"] == slot["version"] + 1
    )
    # A reviewed empty plan is harmless; an old nonempty plan cannot be replayed.
    with SessionLocal() as db, db.begin():
        assert apply_plan(db, preview(db)) == {"locations": 0, "unassigned": 0}
    with pytest.raises(ValueError), SessionLocal() as db, db.begin():
        apply_plan(db, plan)


def test_changed_assignment_aborts_cleanup_without_partial_changes(client, warehouse):
    slot, sources = legacy(client, warehouse)
    with SessionLocal() as db:
        plan = preview(db)
    with SessionLocal() as db, db.begin():
        db.get(WarehousePlacement, (slot["id"], sources[-1]["id"])).weight = 1
    with pytest.raises(ValueError, match="已变化"), SessionLocal() as db, db.begin():
        apply_plan(db, plan)
    with SessionLocal() as db:
        assert len(db.scalars(select(WarehousePlacement)).all()) == 3


def test_selected_stock_query_is_exact_bounded_and_team_scoped(client, warehouse):
    _, sources = legacy(client, warehouse)
    url = f"/api/team-materials/{warehouse['team']['id']}/stock"
    result = client.get(
        url,
        params={
            "source_ids": f"{sources[0]['id']},{sources[2]['id']}",
            "availability": "dispatchable",
        },
    )
    assert result.status_code == 200, result.text
    assert {row["transfer"]["id"] for row in result.json()["items"]} == {
        sources[0]["id"],
        sources[2]["id"],
    }
    assert (
        client.get(
            f"/api/team-materials/{warehouse['other']['id']}/stock",
            params={"source_ids": str(sources[0]["id"])},
        ).json()["items"]
        == []
    )
    for ids in ("0", "-1", "a", ",".join(str(i + 1) for i in range(101))):
        assert client.get(url, params={"source_ids": ids}).status_code == 422
