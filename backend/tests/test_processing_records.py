"""Processing registration, remaining stock states, and unchanged original receipts."""
from datetime import datetime, timezone

import pytest
from test_material_transfers import _team
from test_quantity_adjustments import change
from test_warehouse_classification import base, confirm, dispatch
from test_warehouse_receipts import intake, warehouse  # noqa: F401


@pytest.fixture(params=[("FACTORY-ROLL", "轧制"), ("FACTORY-WIRE", "线切割"), ("FACTORY-ENGRAVE", "雕刻")],
                ids=["rolling", "cutting", "engraving"])
def processing(client, warehouse, request):  # noqa: F811 - imported shared pytest fixture
    code, name = request.param
    response = client.patch(f"/api/teams/{warehouse['other']['id']}", json={"code": code, "name": name})
    assert response.status_code == 200, response.text
    return {**warehouse, "other": response.json()}


def receive(client, setup, **overrides):
    origin = intake(client, setup, quantity=1, weight=100, **overrides).json()
    sent = dispatch(client, setup, [{"source_transfer_id": origin["id"], "quantity": 1, "weight": 100}],
                    idempotency_key="send-" + origin["batch_no"]).json()
    assert confirm(client, setup, sent, workshop=True).status_code == 200
    return sent["items"][0]


def test_one_to_twenty_then_eight_leaves_twelve_registered_pieces(client, processing):
    s = processing
    lot = receive(client, s)
    url = base(s, True)
    sources = client.get(url + "/processing-stock").json()
    assert sources["total"] == 1 and sources["items"][0]["processing_state"] == "unregistered"
    assert change(client, s, lot, 20, workshop=True).status_code == 201
    context = client.get(f"{url}/stock/{lot['id']}/quantity-adjustments").json()
    assert context["serial_no"] == lot["serial_no"] and context["material_type"] == "semi_finished"
    sent = dispatch(client, s, [{"source_transfer_id": lot["id"], "quantity": 8, "weight": 40}], workshop=True).json()
    group = client.get(url + "/inventory").json()["items"][0]
    assert group["owned_quantity"] == 20  # Pending still belongs to the upstream team.
    assert group["on_hand_quantity"] == 12 and group["in_transit_quantity"] == 8
    assert group["processing_registered_quantity"] == 12
    assert group["processing_registered_weight"] == 60
    assert group["processing_registered_batch_count"] == 1
    assert group["processing_unregistered_batch_count"] == 0
    detail = client.get(f"{url}/inventory/{group['group_id']}/sources").json()["items"][0]
    assert detail["processing_state"] == "registered"
    assert confirm(client, s, sent).status_code == 200
    record = client.get(url + "/processing-records").json()["items"][0]
    assert (record["before_quantity"], record["after_quantity"], record["on_hand_quantity"]) == (1, 20, 12)
    assert record["on_hand_weight"] == 60 and record["in_transit_quantity"] == 0
    assert record["weight"] == 100 and record["processing_state"] == "registered"
    assert client.get("/api/material-transfers/" + lot["batch_no"]).json()["quantity"] == 1


def test_mixed_batches_do_not_mark_all_material_processed(client, processing):
    s = processing
    lot = receive(client, s)
    assert change(client, s, lot, 20, workshop=True).status_code == 201
    other = receive(client, s, idempotency_key="another-intake")
    url = base(s, True)
    group = client.get(url + "/inventory").json()["items"][0]
    assert group["batch_count"] == 2
    assert group["processing_registered_quantity"] == 20 and group["processing_unregistered_quantity"] == 1
    assert group["processing_registered_batch_count"] == group["processing_unregistered_batch_count"] == 1
    sources = client.get(url + "/processing-stock", params={"group_id": group["group_id"]}).json()
    assert sources["total"] == 2
    assert {row["transfer"]["id"]: row["processing_state"] for row in sources["items"]} == {lot["id"]: "registered", other["id"]: "unregistered"}
    sent = dispatch(client, s, [{"source_transfer_id": lot["id"], "quantity": 20, "weight": 100}], workshop=True).json()
    assert client.get(url + "/processing-records").json()["items"][0]["processing_state"] == "pending"
    assert confirm(client, s, sent).status_code == 200
    group = client.get(url + "/inventory").json()["items"][0]
    assert group["processing_registered_batch_count"] == 0
    assert group["processing_unregistered_batch_count"] == 1
    assert client.get(url + "/processing-records").json()["items"][0]["processing_state"] == "cleared"
    assert client.get(url + "/processing-stock").json()["total"] == 1


def test_processing_records_are_filtered_paged_and_sorted_by_registration_time(client, processing, monkeypatch):
    from app import quantity_adjustments

    s = processing
    lot = receive(client, s)
    monkeypatch.setattr(quantity_adjustments, "utcnow", lambda: datetime(2026, 10, 5, 1, tzinfo=timezone.utc))
    assert change(client, s, lot, 20, workshop=True, reason="第一轮加工").status_code == 201
    monkeypatch.setattr(quantity_adjustments, "utcnow", lambda: datetime(2026, 10, 6, 1, tzinfo=timezone.utc))
    assert change(client, s, lot, 21, workshop=True, key="next-count", reason="复核加工件数").status_code == 201
    url = base(s, True) + "/processing-records"
    first = client.get(url, params={"page_size": 1}).json()
    second = client.get(url, params={"page_size": 1, "page": 2}).json()
    assert first["total"] == 2 and first["items"][0]["after_quantity"] == 21
    assert second["items"][0]["after_quantity"] == 20
    group = client.get(base(s, True) + "/inventory").json()["items"][0]
    assert group["processing_registered_quantity"] == 21
    assert group["processing_registered_batch_count"] == 1
    assert client.get(url, params={"query": lot["serial_no"]}).json()["total"] == 2
    assert client.get(url, params={"query": "复核"}).json()["total"] == 1
    assert client.get(url, params={"query": "%"}).json()["total"] == 0
    filtered = client.get(url, params={"date_from": "2026-10-05", "date_to": "2026-10-05"}).json()
    assert filtered["total"] == 1 and filtered["items"][0]["after_quantity"] == 20
    assert client.get(url, params={"date_from": "2026-10-07", "date_to": "2026-10-05"}).status_code == 422


def test_outbound_clearance_is_not_a_processing_record_and_scope_is_checked(client, processing):
    s = processing
    lot = receive(client, s)
    # Piece clearance at final outbound is an accounting operation, not machining.
    assert change(client, s, lot, 2, workshop=True).status_code == 201
    response = dispatch(client, s, [{"source_transfer_id": lot["id"], "quantity": 1, "weight": 100}], workshop=True,
        quantity_clearances=[{"source_transfer_id": lot["id"], "quantity": 1, "reason": "余件清零"}])
    assert response.status_code == 201, response.text
    url = base(s, True)
    records = client.get(url + "/processing-records").json()
    assert records["total"] == 1 and records["items"][0]["after_quantity"] == 2
    history = client.get(f"{url}/stock/{lot['id']}/quantity-adjustments").json()["items"]
    assert [row["operation_kind"] for row in history] == ["outbound_clearance", "processing"]
    assert client.get(base(s) + "/processing-records").status_code == 422
    unsupported = _team(client, "FACTORY-ANNEAL", "退火")
    for suffix in ("processing-stock", "processing-records"):
        assert client.get(f"/api/team-materials/{unsupported['id']}/{suffix}").status_code == 422
    assert client.get(url + "/processing-stock", params={"group_id": 99999}).status_code == 404
    assert client.get(url + "/processing-stock", params={"page_size": 101}).status_code == 422
    assert client.get(url + "/processing-records", headers={"Authorization": ""}).status_code == 401


def test_unchanged_piece_count_can_register_partial_then_complete_processing(client, processing):
    s = processing
    lot = receive(client, s)
    url = base(s, True)
    partial = change(client, s, lot, 1, workshop=True, processing_status="partial", transfer_specification="20 × 10 × 2 mm")
    assert partial.status_code == 201, partial.text
    assert partial.json()["delta_quantity"] == 0 and partial.json()["processing_status"] == "partial"
    assert change(client, s, lot, 1, workshop=True, revision=0, processing_status="partial", transfer_specification="20 × 10 × 2 mm").json() == partial.json()
    context = client.get(f"{url}/stock/{lot['id']}/quantity-adjustments").json()
    assert context["revision"] == 1 and context["weight"] == 100
    assert context["transfer_specification"] == "20 × 10 × 2 mm"
    assert client.get(url + "/processing-stock").json()["items"][0]["processing_state"] == "partial"
    assert change(client, s, lot, 1, workshop=True, revision=0, key="stale-complete", processing_status="complete").status_code == 409
    complete = change(client, s, lot, 1, workshop=True, key="complete", processing_status="complete")
    assert complete.status_code == 201, complete.text
    group = client.get(url + "/inventory").json()["items"][0]
    assert group["processing_partial_batch_count"] == 0 and group["processing_complete_batch_count"] == 1
    detail = client.get(f"{url}/inventory/{group['group_id']}/sources").json()["items"][0]
    assert detail["processing_state"] == "complete" and detail["current_specification"] == "20 × 10 × 2 mm"
    records = client.get(url + "/processing-records").json()["items"]
    assert [row["processing_status"] for row in records] == ["complete", "partial"]
    assert all(row["processing_state"] == "complete" for row in records)
    original = client.get("/api/material-transfers/" + lot["batch_no"]).json()
    assert original["quantity"] == 1 and original["transfer_specification"] is None
    assert any(event["changes"].get("processing_status", {}).get("after") == "complete" for event in original["history"])


def test_dispatch_inherits_processing_dimensions_and_allows_each_split_its_actual_size(client, processing):
    s = processing
    lot = receive(client, s)
    registered = change(client, s, lot, 20, workshop=True, processing_status="complete", transfer_specification="20 × 10 × 2 mm")
    assert registered.status_code == 201, registered.text
    outgoing = dispatch(client, s, [
        {"source_transfer_id": lot["id"], "quantity": 8, "weight": 40},
        {"source_transfer_id": lot["id"], "quantity": 12, "weight": 60, "transfer_specification": " 10 × 10 × 2 mm "},
    ], workshop=True)
    assert outgoing.status_code == 201, outgoing.text
    assert [row["transfer_specification"] for row in outgoing.json()["items"]] == ["20 × 10 × 2 mm", "10 × 10 × 2 mm"]
    assert all(row["source_transfer_id"] == lot["id"] for row in outgoing.json()["items"])
    assert confirm(client, s, outgoing.json()).status_code == 200
    original = client.get("/api/material-transfers/" + lot["batch_no"]).json()
    assert original["quantity"] == 1 and original["transfer_specification"] is None


def test_progress_registration_rejects_unsupported_teams_and_invalid_progress(client, warehouse):
    lot = intake(client, warehouse, quantity=10, weight=100).json()
    assert change(client, warehouse, lot, 10, processing_status="complete").status_code == 422
    assert change(client, warehouse, lot, 10, processing_status="invalid").status_code == 422
