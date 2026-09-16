from datetime import datetime

import pytest
from pydantic import ValidationError

from app.material_analytics import NUMBER_SEARCH_FIELDS, SerialFilters
from test_material_analytics import identify
from test_material_stock import stock_setup, receive_lot, dispatch, loss, endpoint
from test_material_transfers import _create


def search(client, setup, field="all", query="", **params):
    response = client.get(endpoint(setup, "serials"), params={"search_field": field, "query": query, **params})
    assert response.status_code == 200, response.text
    return response.json()


def test_all_serial_text_fields_are_searchable_without_truncating_balances(client, stock_setup):
    s = stock_setup
    a = receive_lot(client, s, quantity=30, weight=3)
    b = receive_lot(client, s, key="second", quantity=20, weight=2)
    identify([a], "MATCH", customer_code="CLIENT-ALPHA", product_code="PART-X", finished_specification="FIN-10", transfer_specification="RAW-20")
    identify([b], "MATCH", customer_code="CLIENT-BETA", product_code="PART-X", finished_specification="FIN-11", transfer_specification="RAW-21")
    other = receive_lot(client, s, key="other", material_name="CLIENT-ALPHA")
    identify([other], "OTHER", customer_code="CLIENT-GAMMA")
    for field, term in {"serial_no": "ATC", "material_name": "铜", "customer_code": "ALPHA", "product_code": "PART-X", "finished_specification": "FIN-10", "transfer_specification": "RAW-20"}.items():
        result = search(client, s, field, term, page_size=1)
        assert result["total"] == 1
        row = result["items"][0]
        assert row["serial_no"] == "MATCH" and row["available_quantity"] == 50
        assert row["customer_code"] is None and row["customer_code_count"] == 2
    assert search(client, s, query="CLIENT-ALPHA")["total"] == 2
    assert search(client, s, query="FIN-10")["total"] == 1
    assert search(client, s, "customer_code", "%")["total"] == 0
    assert search(client, s, "product_code", "_")["total"] == 0
    assert search(client, {**s, "stock_team_id": s["third"]["id"]}, "customer_code", "ALPHA")["total"] == 0


def test_numeric_search_uses_whole_serial_totals_before_pagination(client, stock_setup):
    s = stock_setup
    a = receive_lot(client, s, quantity=100, weight=10)
    b = receive_lot(client, s, key="second", quantity=50, weight=5)
    identify([a, b], "SUM", finished_quantity=500)
    assert dispatch(client, s, [{"source_transfer_id": a["id"], "quantity": 10, "weight": 1}]).status_code == 201
    assert loss(client, s, a).status_code == 201
    assert _create(client, s, serial_no="SUM", quantity=15, weight=1.5, idempotency_key="incoming").status_code == 201
    small = receive_lot(client, s, key="small", quantity=5, weight=.5)
    identify([small], "SMALL", finished_quantity=1)
    expected = dict(available_quantity=138, available_weight=13.8, finished_quantity=500,
                    pending_incoming_quantity=15, pending_incoming_weight=1.5,
                    pending_outgoing_quantity=10, pending_outgoing_weight=1, lost_quantity=2, lost_weight=.2)
    assert set(expected) | {'scrap_quantity', 'scrap_weight'} == set(NUMBER_SEARCH_FIELDS)
    for field, value in expected.items():
        result = search(client, s, field, str(value), page_size=1)
        assert result["total"] == 1 and result["items"][0]["serial_no"] == "SUM"
    assert search(client, s, "available_quantity", "100", search_operator="gte")["total"] == 1
    assert search(client, s, "available_quantity", "5", search_operator="lte")["items"][0]["serial_no"] == "SMALL"
    assert search(client, s, "available_weight", "13.8", search_operator="gte")["total"] == 1
    assert search(client, s, "available_weight", "13.799", search_operator="lte")["total"] == 1
    assert search(client, s, "pending_incoming_quantity", "0")["items"][0]["serial_no"] == "SMALL"
    assert search(client, s, "available_quantity", "100", search_operator="gte", page_size=1, page=2)["items"] == []


def test_status_and_latest_activity_date_use_serial_state_and_factory_timezone(client, stock_setup):
    s = stock_setup
    a = receive_lot(client, s)
    b = receive_lot(client, s, key="next-day")
    identify([a], "URGENT", updated_at=datetime(2026, 9, 15, 16, 0))  # Shanghai 9/16 00:00
    identify([b], "NORMAL", updated_at=datetime(2026, 9, 16, 16, 0))  # Shanghai 9/17 00:00
    response = client.put("/api/serial-urgency", json={"serial_no": "URGENT", "urgent": True, "expected_version": 0})
    assert response.status_code == 200
    assert search(client, s, "urgency", "urgent")["items"][0]["serial_no"] == "URGENT"
    assert search(client, s, "urgency", "normal")["items"][0]["serial_no"] == "NORMAL"
    assert search(client, s, "urgency", "normal", urgent_only=True)["total"] == 0
    assert search(client, s, "last_activity_at", "2026-09-16")["items"][0]["serial_no"] == "URGENT"
    assert search(client, s, "last_activity_at", "2026-09-17")["items"][0]["serial_no"] == "NORMAL"
    for field in ("batch_no", "source_batch_no", "next_team_id", "password_hash"):
        assert client.get(endpoint(s, "serials"), params={"search_field": field, "query": "X"}).status_code == 422


@pytest.mark.parametrize("params", [
    {"search_field": "available_quantity", "query": "1.5"},
    {"search_field": "available_quantity", "query": "-1"},
    {"search_field": "available_weight", "query": "0.0001"},
    {"search_field": "available_weight", "query": "NaN"},
    {"search_field": "available_weight", "query": "Infinity"},
    {"search_field": "available_weight", "query": "1e100"},
    {"search_field": "available_weight", "query": "abc"},
    {"search_field": "urgency", "query": "wrong"},
    {"search_field": "last_activity_at", "query": "2026-02-30"},
    {"search_field": "last_activity_at", "query": "9999-12-31"},
    {"search_field": "last_activity_at", "query": "0001-01-01"},
    {"search_field": "customer_code", "query": "A", "search_operator": "gte"},
])
def test_invalid_typed_search_is_rejected(params):
    with pytest.raises(ValidationError):
        SerialFilters(**params)
