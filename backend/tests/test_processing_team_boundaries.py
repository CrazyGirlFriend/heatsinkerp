"""Only splitting workshops may change the piece count; other teams record work."""

import pytest
from app.database import SessionLocal
from app.models import MaterialQuantityAdjustment, MaterialStockBalance, MaterialTransfer
from sqlalchemy import func, select
from test_quantity_adjustments import change, processing_lot
from test_warehouse_classification import base, confirm, dispatch
from test_warehouse_receipts import intake
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401


@pytest.mark.parametrize(
    "code,allowed",
    [
        ("FACTORY-WAREHOUSE", False),
        ("FACTORY-ANNEAL", False),
        ("FACTORY-GRIND", False),
        ("FACTORY-PLATE", False),
        ("FACTORY-QC", False),
        ("FACTORY-ROLL", True),
        ("FACTORY-WIRE", True),
        ("FACTORY-ENGRAVE", True),
    ],
)
@pytest.mark.parametrize("operation", ["count", "outputs", "dispatch_count"])
def test_processing_capability_covers_all_write_paths(client, warehouse, code, allowed, operation):
    workshop = code != "FACTORY-WAREHOUSE"
    if workshop:
        response = client.patch(f"/api/teams/{warehouse['other']['id']}", json={"code": code})
        assert response.status_code == 200, response.text
        lot = processing_lot(client, warehouse, quantity=1, weight=100)
    else:
        lot = intake(client, warehouse, quantity=1, weight=100).json()
    with SessionLocal() as db:
        transfer_count = db.scalar(select(func.count()).select_from(MaterialTransfer))
    amounts = [{"source_transfer_id": lot["id"], "quantity": 1, "weight": 5}]
    if operation == "dispatch_count":
        response = dispatch(
            client,
            warehouse,
            amounts,
            workshop=workshop,
            quantity_adjustments=[
                {
                    "source_transfer_id": lot["id"],
                    "quantity": 20,
                    "expected_revision": 0,
                    "processor_name": "张师傅",
                }
            ],
        )
    else:
        extra = {}
        if operation == "outputs":
            extra = {
                "processing_status": "complete",
                "outputs": [
                    {
                        "role": "produced",
                        "quantity": 20,
                        "weight": 100,
                        "material_type": "semi_finished",
                    }
                ],
            }
        response = change(client, warehouse, lot, 20, workshop=workshop, **extra)
    assert response.status_code == (201 if allowed else 422), response.text
    if allowed:
        with SessionLocal() as db:
            assert db.scalar(select(func.count()).select_from(MaterialQuantityAdjustment)) == 1
        return
    assert response.json()["detail"] == (
        "本班组按件登记加工，不能修改加工件数或拆分产出"
        if workshop
        else "库房不登记加工，请选择生产班组"
    )
    with SessionLocal() as db:
        balance = db.get(MaterialStockBalance, lot["id"])
        assert (balance.on_hand_quantity, balance.on_hand_weight) == (1, 100)
        assert db.scalar(select(func.count()).select_from(MaterialTransfer)) == transfer_count
        assert db.scalar(select(func.count()).select_from(MaterialQuantityAdjustment)) == 0
    # Read-only history and ordinary transfer/receipt remain available.
    context = client.get(f"{base(warehouse, workshop)}/stock/{lot['id']}/quantity-adjustments")
    assert context.status_code == 200, context.text
    outgoing = dispatch(client, warehouse, amounts, workshop=workshop, idempotency_key="ordinary")
    assert outgoing.status_code == 201, outgoing.text
    assert confirm(client, warehouse, outgoing.json(), workshop=not workshop).status_code == 200


def test_existing_piece_history_remains_readable_after_team_capability_changes(client, warehouse):
    lot = processing_lot(client, warehouse, quantity=1, weight=100)
    response = change(client, warehouse, lot, 20, workshop=True)
    assert response.status_code == 201, response.text
    assert (
        client.patch(
            f"/api/teams/{warehouse['other']['id']}", json={"code": "FACTORY-GRIND"}
        ).status_code
        == 200
    )
    context = client.get(f"{base(warehouse, True)}/stock/{lot['id']}/quantity-adjustments")
    assert context.status_code == 200
    assert context.json()["items"][0]["after_quantity"] == 20
    assert change(client, warehouse, lot, 20, workshop=True, revision=0).json() == response.json()
    assert change(client, warehouse, lot, 30, workshop=True, key="new").status_code == 422
