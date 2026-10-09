"""A processing recount and its outbound rows form one audited transaction."""
from decimal import Decimal

from sqlalchemy import func, select

from app.database import SessionLocal
from app.models import MaterialQuantityAdjustment, MaterialStockBalance, MaterialTransfer
from test_warehouse_receipts import warehouse, intake  # noqa: F401
from test_warehouse_classification import base, confirm, dispatch


def workshop_lot(client, setup):
    origin = intake(client, setup, quantity=1, weight=1).json()
    sent = dispatch(client, setup, [{"source_transfer_id": origin["id"], "quantity": 1, "weight": 1}]).json()
    assert confirm(client, setup, sent, workshop=True).status_code == 200
    return sent["items"][0]


def test_recount_partial_dispatch_replay_and_stale_revision(client, warehouse):
    lot = workshop_lot(client, warehouse)
    amounts = [{"source_transfer_id": lot["id"], "quantity": 8, "weight": "0.4"}]
    adjustments = [{"source_transfer_id": lot["id"], "quantity": 20, "expected_revision": 0}]
    first = dispatch(client, warehouse, amounts, workshop=True, quantity_adjustments=adjustments)
    assert first.status_code == 201, first.text
    assert dispatch(client, warehouse, amounts, workshop=True, quantity_adjustments=adjustments).json() == first.json()
    with SessionLocal() as db:
        balance = db.get(MaterialStockBalance, lot["id"])
        assert (balance.on_hand_quantity, balance.on_hand_weight) == (12, Decimal("0.6"))
        assert balance.adjusted_quantity == 19
        assert db.get(MaterialTransfer, lot["id"]).quantity == 1
        assert db.scalar(select(func.count()).select_from(MaterialQuantityAdjustment)) == 1
    raced = dispatch(client, warehouse, amounts, workshop=True, quantity_adjustments=adjustments, idempotency_key="stale")
    assert raced.status_code == 409
    history = client.get(base(warehouse, True) + "/serial-history", params={"serial_no": lot["serial_no"]}).json()
    assert history["lots"][0]["closing_quantity"] == 12


def test_invalid_outbound_rolls_back_recount_and_duplicate_or_foreign_sources_rejected(client, warehouse):
    lot = workshop_lot(client, warehouse)
    update = {"source_transfer_id": lot["id"], "quantity": 20, "expected_revision": 0}
    amounts = [{"source_transfer_id": lot["id"], "quantity": 8, "weight": ".4", "purpose_id": 999999}]
    bad = dispatch(client, warehouse, amounts, workshop=True, quantity_adjustments=[update])
    assert bad.status_code in (404, 422), bad.text
    with SessionLocal() as db:
        assert db.get(MaterialStockBalance, lot["id"]).on_hand_quantity == 1
        assert db.scalar(select(func.count()).select_from(MaterialQuantityAdjustment)) == 0
    for updates in ([update, update], [{**update, "source_transfer_id": 999999}]):
        bad = dispatch(client, warehouse, amounts, workshop=True, quantity_adjustments=updates)
        assert bad.status_code == 422, bad.text


def test_light_material_weight_survives_receipt_dispatch_confirmation_and_loss(client, warehouse):
    lot = intake(client, warehouse, quantity=1, weight="0.000123").json()
    assert lot["weight"] == .000123
    out = dispatch(client, warehouse, [{"source_transfer_id": lot["id"], "quantity": 1, "weight": "0.000125"}])
    assert out.status_code == 201, out.text
    assert confirm(client, warehouse, out.json(), workshop=True).status_code == 200
    totals = client.get(base(warehouse) + "/overview").json()["totals"]
    assert totals["on_hand_weight"] == -.000002
    assert totals["lost_weight"] == 0  # A measurement discrepancy never creates loss.
    target = out.json()["items"][0]
    lost = client.post(base(warehouse, True) + "/losses", headers=warehouse["other_headers"], json={
        "source_transfer_id": target["id"], "quantity": 0, "weight": "0.000001", "idempotency_key": "mg-loss"})
    assert lost.status_code == 201, lost.text
    with SessionLocal() as db:
        assert db.get(MaterialStockBalance, target["id"]).on_hand_weight == Decimal(".000124")
