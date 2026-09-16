from datetime import datetime, timedelta

import pytest

from app import material_analytics
from app.database import SessionLocal
from app.models import MaterialTransfer
from test_material_stock import stock_setup, receive_lot, dispatch, loss, endpoint
from test_material_transfers import _create


def get(client, setup, suffix):
    result = client.get(endpoint(setup, suffix))
    assert result.status_code == 200, result.text
    return result.json()


def identify(lots, serial, **fields):
    with SessionLocal() as db:
        for lot in lots:
            item = db.get(MaterialTransfer, lot["id"])
            item.serial_no = serial
            for key, value in fields.items():
                setattr(item, key, value)
        db.commit()


def test_serial_aggregates_before_pagination_and_preserves_real_balances(client, stock_setup):
    s = stock_setup
    a = receive_lot(client, s, quantity=60, weight=6)
    b = receive_lot(client, s, key="second", quantity=40, weight=4)
    identify([a, b], "SERIAL-001", finished_quantity=300, transfer_specification="10×20")
    confirmed = dispatch(client, s, [{"source_transfer_id": a["id"], "quantity": 60, "weight": 6}]).json()["items"][0]
    assert client.post(f"/api/material-transfers/{confirmed['batch_no']}/confirm", headers=s["third_headers"], json={"idempotency_key": "confirmed"}).status_code == 200
    assert dispatch(client, s, [{"source_transfer_id": b["id"], "quantity": 10, "weight": 1}], idempotency_key="pending").status_code == 201
    assert loss(client, s, b).status_code == 201
    assert _create(client, s, serial_no="SERIAL-001", idempotency_key="incoming", quantity=15, weight=1.5).status_code == 201
    result = get(client, s, "serials")
    assert result["total"] == 1
    row = result["items"][0]
    assert row["received_quantity"] == 100
    assert row["on_hand_quantity"] == row["available_quantity"] == 28
    assert row["on_hand_weight"] == row["available_weight"] == 2.8
    assert row["in_transit_quantity"] == 10 and row["in_transit_weight"] == 1
    assert row["reserved_quantity"] == 10 and row["lost_quantity"] == 2
    assert row["pending_incoming_quantity"] == 15 and row["pending_outgoing_quantity"] == 10
    assert row["finished_quantity"] == 300  # Document information is not an additive measure.
    other = client.get(f"/api/team-materials/{s['third']['id']}/serials").json()["items"][0]
    assert other["on_hand_quantity"] == 60 and other["lost_quantity"] == 0
    assert get(client, s, "serials?has_loss=true")["total"] == 1


def test_mixed_metadata_never_silently_picks_a_latest_value(client, stock_setup):
    a = receive_lot(client, stock_setup)
    b = receive_lot(client, stock_setup, key="mixed", material_name="钨铜")
    identify([a], "MIXED", transfer_specification="10×20")
    identify([b], "MIXED", transfer_specification="20×30", material_type="finished")
    row = get(client, stock_setup, "serials")["items"][0]
    assert row["material_name"] is None and row["material_name_count"] == 2
    assert row["transfer_specification"] is None and row["transfer_specification_count"] == 2
    assert row["material_type"] is None and row["material_type_count"] == 2
    # Chart filters identify whole serials; their balance remains the complete serial balance.
    filtered = get(client, stock_setup, "serials?material_type=finished")["items"][0]
    assert filtered["on_hand_quantity"] == 200


def test_serial_availability_filters_aggregated_balance_before_pagination(client, stock_setup):
    s = stock_setup
    reserved = receive_lot(client, s, key="reserved", quantity=10, weight=1)
    identify([reserved], "RESERVED")
    assert dispatch(client, s, [{"source_transfer_id": reserved["id"], "quantity": 10, "weight": 1}]).status_code == 201
    weight_only = receive_lot(client, s, key="weight", quantity=10, weight=2)
    identify([weight_only], "WEIGHT-ONLY")
    assert dispatch(client, s, [{"source_transfer_id": weight_only["id"], "quantity": 10, "weight": 1}], idempotency_key="reserve-pieces").status_code == 201
    assert _create(client, s, serial_no="INCOMING-ONLY", idempotency_key="waiting-only", quantity=5, weight=1).status_code == 201
    assert get(client, s, "serials")["total"] == 3
    result = get(client, s, "serials?availability=available&page_size=1")
    assert result["total"] == 1 and len(result["items"]) == 1
    assert result["items"][0]["serial_no"] == "WEIGHT-ONLY"
    assert result["items"][0]["available_quantity"] == 0
    assert result["items"][0]["available_weight"] == 1
    assert get(client, s, "serials?availability=available&page=2&page_size=1")["items"] == []
    assert get(client, s, "serials?availability=available&query=RESERVED")["total"] == 0
    assert client.get(endpoint(s, "serials?availability=invalid")).status_code == 422


def test_pagination_is_for_unique_serials_and_exact_detail_search(client, stock_setup):
    for index in range(22):
        receive_lot(client, stock_setup, key=f"page-{index:02d}")
    first = get(client, stock_setup, "serials")
    second = get(client, stock_setup, "serials?page=2")
    assert first["total"] == 22 and len(first["items"]) == 20 and len(second["items"]) == 2
    assert not ({row["serial_no"] for row in first["items"]} & {row["serial_no"] for row in second["items"]})
    assert len(get(client, stock_setup, "serials?page_size=100")["items"]) == 22
    assert get(client, stock_setup, "serials?serial_no=FLOW-page-01")["total"] == 1
    assert get(client, stock_setup, "stock?serial_no=FLOW-page-01&availability=all")["total"] == 1
    assert get(client, stock_setup, "serials?query=%25")["total"] == 0


def test_stock_age_uses_remaining_original_lots_not_latest_serial_activity(client, stock_setup, monkeypatch):
    now = datetime(2026, 9, 12, 12)
    monkeypatch.setattr(material_analytics, "utcnow", lambda: now)
    old = receive_lot(client, stock_setup, quantity=100, weight=10)
    new = receive_lot(client, stock_setup, key="new", quantity=20, weight=2)
    identify([old], "SAME", received_at=now - timedelta(days=10))
    identify([new], "SAME", received_at=now - timedelta(hours=12))
    item = dispatch(client, stock_setup, [{"source_transfer_id": old["id"], "quantity": 60, "weight": 6}]).json()["items"][0]
    assert client.post(f"/api/material-transfers/{item['batch_no']}/confirm", headers=stock_setup["third_headers"], json={"idempotency_key": "age-out"}).status_code == 200
    report = get(client, stock_setup, "analytics?days=7")
    ages = {row["key"]: row for row in report["stock_age"]}
    assert ages["ge7"]["quantity"] == 40 and ages["lt1"]["quantity"] == 20
    assert get(client, stock_setup, "serials?stock_age=ge7")["items"][0]["on_hand_quantity"] == 60
    assert get(client, stock_setup, "serials?stock_age=3_7")["total"] == 0


def test_trend_uses_confirmation_and_factory_day_waiting_excludes_inventory(client, stock_setup, monkeypatch):
    now = datetime(2026, 9, 12, 12)
    monkeypatch.setattr(material_analytics, "utcnow", lambda: now)
    lot = receive_lot(client, stock_setup, quantity=35, weight=3.5)
    identify([lot], "CONFIRMED", created_at=now - timedelta(days=40), received_at=datetime(2026, 9, 11, 17))
    pending = _create(client, stock_setup, serial_no="WAITING", idempotency_key="wait", quantity=50, weight=5).json()
    identify([pending], "WAITING", created_at=now - timedelta(days=4))
    report = get(client, stock_setup, "analytics?days=7")
    assert len(report["trend"]) == 7
    assert report["trend"][-1]["key"] == "2026-09-12"
    assert report["trend"][-1]["incoming"]["quantity"] == 35
    assert sum(row["incoming"]["quantity"] for row in report["trend"]) == 35
    assert sum(row["quantity"] for row in report["material_types"]) == 35
    assert next(row for row in report["waiting_age"] if row["key"] == "3_7")["incoming"]["quantity"] == 50
    assert get(client, stock_setup, "serials?waiting_direction=incoming&waiting_age=3_7")["items"][0]["serial_no"] == "WAITING"
    assert get(client, stock_setup, "serials?activity_kind=incoming&activity_day=2026-09-12")["items"][0]["serial_no"] == "CONFIRMED"


def test_empty_and_validation_and_authentication(client, stock_setup):
    report = get(client, stock_setup, "analytics")
    assert report["stock_ranking"] == [] and all(row["incoming"]["quantity"] == 0 for row in report["trend"])
    assert get(client, stock_setup, "serials")["total"] == 0
    for suffix in ("analytics?days=99", "analytics?metric=money", "serials?page_size=101", "serials?stock_age=invalid"):
        assert client.get(endpoint(stock_setup, suffix)).status_code == 422
    assert client.get("/api/team-materials/999999/analytics").status_code == 404
    original = client.headers.pop("Authorization")
    try:
        assert client.get(endpoint(stock_setup, "analytics")).status_code == 401
        assert client.get(endpoint(stock_setup, "serials")).status_code == 401
    finally:
        client.headers["Authorization"] = original
