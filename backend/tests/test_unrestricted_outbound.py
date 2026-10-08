"""Outbound records actual amounts; a signed book deficit must never be hidden."""

from decimal import Decimal

from sqlalchemy import select

from app.database import SessionLocal
from app.models import MaterialStockBalance, MaterialTransfer
from test_material_stock import dispatch, endpoint, loss, receive_lot, stock_setup, totals  # noqa: F401


def test_excess_split_receipt_replay_and_factory_conservation(client, stock_setup):
    s = stock_setup
    lot = receive_lot(client, s)
    lines = [
        {"source_transfer_id": lot["id"], "quantity": 80, "weight": 8},
        {"source_transfer_id": lot["id"], "quantity": 40, "weight": 4},
    ]
    result = dispatch(client, s, lines)
    assert result.status_code == 201, result.text
    assert dispatch(client, s, lines).json() == result.json()
    balance = totals(client, s)
    assert (balance["on_hand_quantity"], balance["on_hand_weight"]) == (-20, -2)
    assert (balance["shortage_quantity"], balance["shortage_weight"]) == (20, 2)
    trace = client.get(
        "/api/material-trace", params={"serial_no": lot["serial_no"]}
    ).json()
    assert trace["shortage"] == {"quantity": 20, "weight": 2}
    # Internal pending is still owned upstream, without inventing extra receipt.
    assert (balance["owned_quantity"], balance["owned_weight"]) == (100, 10)
    assert (
        client.get(endpoint(s, "stock"), params={"availability": "dispatchable"}).json()["total"]
        == 1
    )
    for item in result.json()["items"]:
        detail = client.get(f"/api/material-transfers/{item['batch_no']}").json()
        assert detail["history"][0]["changes"]["shortage_weight"]["after"] == 2
        assert (
            client.post(
                f"/api/material-transfers/{item['batch_no']}/confirm",
                headers=s["third_headers"],
                json={"idempotency_key": f"sign-{item['id']}"},
            ).status_code
            == 200
        )
    assert (totals(client, s)["owned_quantity"], totals(client, s)["owned_weight"]) == (-20, -2)
    downstream = client.get(f"/api/team-materials/{s['third']['id']}/overview").json()["totals"]
    assert (downstream["on_hand_quantity"], downstream["on_hand_weight"]) == (120, 12)
    factory = client.get("/api/factory-dashboard").json()
    assert (factory["stock"]["total"]["quantity"], factory["stock"]["total"]["weight"]) == (100, 10)
    with SessionLocal() as db:
        b = db.get(MaterialStockBalance, lot["id"])
        assert (
            b.received_weight
            == b.on_hand_weight + b.reserved_weight + b.dispatched_weight + b.lost_weight
        )


def test_excess_edit_void_and_exhausted_source_selection(client, stock_setup):
    s = stock_setup
    lot = receive_lot(client, s)
    item = dispatch(
        client, s, [{"source_transfer_id": lot["id"], "quantity": 100, "weight": 10}]
    ).json()["items"][0]
    assert (
        client.get(endpoint(s, "stock"), params={"availability": "dispatchable"}).json()["total"]
        == 1
    )
    url = f"/api/material-transfers/{item['batch_no']}"
    changed = client.patch(
        url,
        headers=s["stock_headers"],
        json={"quantity": 130, "weight": 14, "expected_version": item["version"]},
    )
    assert changed.status_code == 200, changed.text
    assert (totals(client, s)["on_hand_quantity"], totals(client, s)["on_hand_weight"]) == (-30, -4)
    assert (
        client.patch(
            url,
            headers=s["stock_headers"],
            json={"quantity": 140, "expected_version": item["version"]},
        ).status_code
        == 409
    )
    assert client.delete(url, headers=s["stock_headers"]).status_code == 204
    assert (totals(client, s)["on_hand_quantity"], totals(client, s)["on_hand_weight"]) == (100, 10)
    assert totals(client, s)["shortage_weight"] == 0
    final = dispatch(
        client,
        s,
        [{"source_transfer_id": lot["id"], "quantity": 101, "weight": 11}],
        idempotency_key="after-void",
    )
    assert final.status_code == 201, final.text
    # No change to validity, source ownership or loss restrictions.
    assert loss(client, s, lot).status_code == 409
    assert (
        dispatch(
            client,
            s,
            [{"source_transfer_id": lot["id"], "quantity": -1, "weight": 1}],
            idempotency_key="invalid",
        ).status_code
        == 422
    )
    other = {**s, "stock_team_id": s["third"]["id"], "stock_headers": s["third_headers"]}
    assert (
        dispatch(
            client,
            other,
            [{"source_transfer_id": lot["id"], "quantity": 1, "weight": 1}],
            idempotency_key="foreign",
        ).status_code
        == 403
    )


def test_gap_is_not_cancelled_by_another_positive_lot_and_piece_correction_is_audited(
    client, stock_setup
):
    s = stock_setup
    lot = receive_lot(client, s)
    receive_lot(client, s, key="positive", quantity=20, weight=2)
    result = dispatch(client, s, [{"source_transfer_id": lot["id"], "quantity": 120, "weight": 12}])
    assert result.status_code == 201, result.text
    balance = totals(client, s)
    assert balance["on_hand_quantity"] == balance["on_hand_weight"] == 0
    assert balance["shortage_quantity"] == 20 and balance["shortage_weight"] == 2
    material = client.get(endpoint(s, "overview")).json()["materials"][0]
    assert material["shortage_weight"] == 2
    context = client.get(endpoint(s, f"stock/{lot['id']}/quantity-adjustments")).json()
    # Use the public adjustment route, including its optimistic revision guard.
    with SessionLocal() as db:
        revision = db.get(MaterialStockBalance, lot["id"]).revision
    correction = client.post(
        endpoint(s, "quantity-adjustments"),
        headers=s["stock_headers"],
        json={
            "source_transfer_id": lot["id"],
            "quantity": 0,
            "expected_revision": revision,
            "reason": "清点后修正负数件数",
            "idempotency_key": "piece-gap-correction",
        },
    )
    assert correction.status_code == 201, (context, correction.text)
    assert correction.json()["before_quantity"] == -20 and correction.json()["weight"] == -2
    assert totals(client, s)["shortage_quantity"] == 0 and totals(client, s)["shortage_weight"] == 2
    with SessionLocal() as db:
        assert db.get(MaterialTransfer, lot["id"]).quantity == 100
        assert db.get(MaterialStockBalance, lot["id"]).on_hand_weight == Decimal("-2")
