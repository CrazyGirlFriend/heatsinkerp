from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.database import SessionLocal
from app.models import MaterialQuantityAdjustment, MaterialStockBalance, MaterialTransfer, NotificationOutbox
from test_material_stock import stock_setup, receive_lot, dispatch, totals  # noqa: F401
from test_external_outbound import outbound, dispatch as external_dispatch  # noqa: F401
from test_warehouse_receipts import warehouse, intake  # noqa: F401
from test_warehouse_locations import location


def clearance(lot, quantity=20, reason="加工后实际件数减少，最后一批重量已全部转出"):
    return {"source_transfer_id": lot["id"], "quantity": quantity, "reason": reason}


def adjustments():
    with SessionLocal() as db:
        return db.scalar(select(func.count()).select_from(MaterialQuantityAdjustment))


def test_last_weight_clearance_is_optional_and_changes_only_on_hand_count(client, stock_setup):
    s = stock_setup
    lot = receive_lot(client, s)
    lines = [{"source_transfer_id": lot["id"], "quantity": 80, "weight": 10}]
    uncorrected = dispatch(client, s, lines, idempotency_key="without-clearance")
    assert uncorrected.status_code == 201
    assert totals(client, s)["on_hand_quantity"] == 20
    assert client.delete(f"/api/material-transfers/{uncorrected.json()['items'][0]['batch_no']}", headers=s["stock_headers"]).status_code == 204
    assert totals(client, s)["on_hand_quantity"] == 100
    assert adjustments() == 0
    assert dispatch(client, s, lines, quantity_clearances=[clearance(lot, reason="  ")]).status_code == 422
    created = dispatch(client, s, lines, quantity_clearances=[clearance(lot)])
    assert created.status_code == 201, created.text
    assert dispatch(client, s, lines, quantity_clearances=[clearance(lot)]).json() == created.json()
    t = totals(client, s)
    assert (t["on_hand_quantity"], t["on_hand_weight"], t["owned_quantity"], t["owned_weight"]) == (0, 0, 80, 10)
    assert t["lost_quantity"] == 0 and t["reserved_quantity"] == 80
    outgoing = created.json()["items"][0]
    with SessionLocal() as db:
        record = db.scalar(select(MaterialQuantityAdjustment))
        assert (record.before_quantity, record.after_quantity, record.weight_snapshot) == (20, 0, 0)
        assert record.reason == clearance(lot)["reason"] and record.created_by_user_id is not None
        assert db.get(MaterialTransfer, lot["id"]).quantity == 100
        assert db.get(MaterialStockBalance, lot["id"]).adjusted_quantity == -20
        event = db.get(MaterialTransfer, lot["id"]).history[-1]
        assert event.changes["outbound_batches"]["after"] == [outgoing["batch_no"]]
        assert db.scalar(select(func.count()).select_from(NotificationOutbox)) > 0
    assert adjustments() == 1
    history = client.get(f"/api/team-materials/{s['stock_team_id']}/serial-history", params={"serial_no": lot["serial_no"]})
    assert history.status_code == 200, history.text
    assert history.json()["lots"][0]["closing_quantity"] == 0
    assert history.json()["lots"][0]["closing_weight"] == 0
    changes = [event for group in history.json()["groups"] for event in group["events"] if event["kind"] == "quantity_changed"]
    assert len(changes) == 1 and changes[0]["delta_quantity"] == -20 and changes[0]["delta_weight"] == 0
    signed = client.post(f"/api/material-transfers/{outgoing['batch_no']}/confirm", headers=s["third_headers"], json={"idempotency_key": "signed-clearance"})
    assert signed.status_code == 200
    assert totals(client, s)["owned_quantity"] == 0
    downstream = client.get(f"/api/team-materials/{s['third']['id']}/overview").json()["totals"]
    assert (downstream["on_hand_quantity"], downstream["on_hand_weight"]) == (80, 10)


@pytest.mark.parametrize("quantity,weight", [(0, 10), (80, 0), (100, 10)])
def test_weight_only_and_count_only_remain_supported(client, stock_setup, quantity, weight):
    lot = receive_lot(client, stock_setup, quantity=quantity, weight=weight)
    response = dispatch(client, stock_setup, [{"source_transfer_id": lot["id"], "quantity": quantity, "weight": weight}])
    assert response.status_code == 201, response.text
    assert adjustments() == 0


def test_split_lines_clear_once_per_source_and_atomic_failures(client, stock_setup):
    s = stock_setup
    lot = receive_lot(client, s)
    lines = [{"source_transfer_id": lot["id"], "quantity": 30, "weight": 4}, {"source_transfer_id": lot["id"], "quantity": 50, "weight": 6}]
    for data in ([clearance(lot, 19)], [clearance(lot), clearance(lot)], [{**clearance(lot), "source_transfer_id": lot["id"] + 999}]):
        assert dispatch(client, s, lines, quantity_clearances=data).status_code in (409, 422)
        assert totals(client, s)["on_hand_quantity"] == 100 and adjustments() == 0
    other = receive_lot(client, s, key="second-clearance")
    invalid = lines + [{"source_transfer_id": other["id"] + 9999, "quantity": 101, "weight": 1}]
    assert dispatch(client, s, invalid, quantity_clearances=[clearance(lot)]).status_code == 404
    assert adjustments() == 0
    response = dispatch(client, s, lines, quantity_clearances=[clearance(lot)])
    assert response.status_code == 201, response.text
    assert len(response.json()["items"]) == 2 and adjustments() == 1


def test_pending_other_batch_survives_and_void_restores_only_real_shipment(client, stock_setup):
    s = stock_setup
    lot = receive_lot(client, s)
    earlier = dispatch(client, s, [{"source_transfer_id": lot["id"], "quantity": 30, "weight": 3}]).json()["items"][0]
    final = dispatch(client, s, [{"source_transfer_id": lot["id"], "quantity": 50, "weight": 7}], idempotency_key="final",
                     quantity_clearances=[clearance(lot)]).json()["items"][0]
    assert totals(client, s)["reserved_quantity"] == 80
    assert client.delete(f"/api/material-transfers/{final['batch_no']}", headers=s["stock_headers"]).status_code == 204
    t = totals(client, s)
    assert (t["on_hand_quantity"], t["on_hand_weight"], t["reserved_quantity"]) == (50, 7, 30)
    assert client.get(f"/api/material-transfers/{earlier['batch_no']}").json()["status"] == "pending"
    assert adjustments() == 1


def test_edit_final_weight_requires_reason_and_rechecks_expected_remainder(client, stock_setup):
    s = stock_setup
    lot = receive_lot(client, s)
    sent = dispatch(client, s, [{"source_transfer_id": lot["id"], "quantity": 80, "weight": 8}]).json()["items"][0]
    url = f"/api/material-transfers/{sent['batch_no']}"
    body = {"weight": 10, "expected_version": sent["version"]}
    assert client.patch(url, headers=s["stock_headers"], json={**body, "quantity_clearance": clearance(lot, 10)}).status_code == 409
    changed = client.patch(url, headers=s["stock_headers"], json={**body, "quantity_clearance": clearance(lot)})
    assert changed.status_code == 200, changed.text
    assert totals(client, s)["on_hand_quantity"] == 0 and adjustments() == 1
    assert client.patch(url, headers=s["stock_headers"], json={**body, "quantity_clearance": clearance(lot)}).status_code == 409
    # Editing the quantity again does not leave a fresh zero-weight count behind.
    body = {"quantity": 70, "expected_version": changed.json()["version"]}
    again = client.patch(url, headers=s["stock_headers"], json={**body, "quantity_clearance": clearance(lot, 10)})
    assert again.status_code == 200, again.text
    assert totals(client, s)["reserved_quantity"] == 70 and adjustments() == 2


def test_clearance_not_a_standalone_or_partial_weight_cleanup(client, stock_setup):
    s = stock_setup
    lot = receive_lot(client, s)
    response = dispatch(client, s, [{"source_transfer_id": lot["id"], "quantity": 80, "weight": 8}], quantity_clearances=[clearance(lot)])
    assert response.status_code == 409 and adjustments() == 0
    row = dispatch(client, s, [{"source_transfer_id": lot["id"], "quantity": 80, "weight": 8}]).json()["items"][0]
    response = client.patch(f"/api/material-transfers/{row['batch_no']}", headers=s["stock_headers"],
                            json={"quantity_clearance": clearance(lot), "expected_version": row["version"]})
    assert response.status_code == 422 and adjustments() == 0


def test_decimal_weight_and_source_permission(client, stock_setup):
    s = stock_setup
    lot = receive_lot(client, s, quantity=10, weight="1.005")
    lines = [{"source_transfer_id": lot["id"], "quantity": 8, "weight": "1.005"}]
    assert dispatch(client, {**s, "stock_headers": s["third_headers"]}, lines, quantity_clearances=[clearance(lot, 2)]).status_code == 403
    sent = dispatch(client, s, lines, quantity_clearances=[clearance(lot, 2)])
    assert sent.status_code == 201
    with SessionLocal() as db:
        balance = db.get(MaterialStockBalance, lot["id"])
        assert balance.on_hand_weight == Decimal(0) and balance.on_hand_quantity == 0


def test_external_final_shipment_clears_pieces_without_touching_other_lots(client, outbound):
    lot = outbound["lots"][0]
    response = external_dispatch(client, outbound,
        lines=[{"source_transfer_id": lot["id"], "quantity": 80, "weight": 10}],
        quantity_clearances=[clearance(lot)])
    assert response.status_code == 201, response.text
    sent = response.json()["items"][0]
    assert (sent["quantity"], sent["weight"], sent["status"]) == (80, 10, "dispatched")
    assert external_dispatch(client, outbound,
        lines=[{"source_transfer_id": lot["id"], "quantity": 80, "weight": 10}],
        quantity_clearances=[clearance(lot)]).json() == response.json()
    with SessionLocal() as db:
        balance = db.get(MaterialStockBalance, lot["id"])
        assert (balance.on_hand_quantity, balance.on_hand_weight, balance.reserved_quantity) == (0, 0, 0)
        other = db.get(MaterialStockBalance, outbound["lots"][1]["id"])
        assert (other.on_hand_quantity, other.on_hand_weight) == (100, 10)
    assert adjustments() == 1


def test_final_weight_and_piece_clearance_frees_warehouse_slot(client, warehouse):
    lot = intake(client, warehouse, weight=10, **location(client, warehouse, "CLEAR-01")).json()
    response = client.post(f"/api/team-materials/{warehouse['team']['id']}/outbound-batches",
        headers=warehouse["headers"], json={"next_team_id": warehouse["other"]["id"],
            "idempotency_key": "clear-and-release", "quantity_clearances": [clearance(lot)],
            "lines": [{"source_transfer_id": lot["id"], "quantity": 80, "weight": 10}]})
    assert response.status_code == 201, response.text
    with SessionLocal() as db:
        from app.models import WarehousePlacement
        assert db.scalar(select(func.count()).select_from(WarehousePlacement)) == 0
        balance = db.get(MaterialStockBalance, lot["id"])
        assert (balance.on_hand_quantity, balance.on_hand_weight, balance.reserved_quantity) == (0, 0, 80)
    # A new batch can immediately claim the vacated slot, before downstream signs.
    assert intake(client, warehouse, idempotency_key="reuse-clear-slot", serial_no="NEW",
                  **location(client, warehouse, "CLEAR-01")).status_code == 201


def test_failure_after_recording_clearance_rolls_back_entire_submission(client, stock_setup, monkeypatch):
    from app import quantity_adjustments
    s = stock_setup
    lot = receive_lot(client, s)
    original = quantity_adjustments.record_outbound_clearance
    with SessionLocal() as db:
        notification_count = db.scalar(select(func.count()).select_from(NotificationOutbox))

    def fail_after_flush(*args, **kwargs):
        original(*args, **kwargs)
        args[0].flush()
        raise HTTPException(409, "模拟提交失败")

    with monkeypatch.context() as patch:
        patch.setattr(quantity_adjustments, "record_outbound_clearance", fail_after_flush)
        result = dispatch(client, s, [{"source_transfer_id": lot["id"], "quantity": 80, "weight": 10}],
                          quantity_clearances=[clearance(lot)])
        assert result.status_code == 409
    assert adjustments() == 0
    t = totals(client, s)
    assert (t["on_hand_quantity"], t["on_hand_weight"], t["reserved_quantity"]) == (100, 10, 0)
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(MaterialTransfer).where(MaterialTransfer.source_transfer_id == lot["id"])) == 0
        assert db.scalar(select(func.count()).select_from(NotificationOutbox)) == notification_count
    assert dispatch(client, s, [{"source_transfer_id": lot["id"], "quantity": 80, "weight": 10}],
                    quantity_clearances=[clearance(lot)]).status_code == 201
