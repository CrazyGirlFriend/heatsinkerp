"""Serial reassignments preserve stock, provenance, permissions and accounting."""

import pytest
from app.database import SessionLocal
from app.models import MaterialStockBalance, MaterialTransfer
from test_material_transfers import _leader
from test_shared_warehouse_locations import reserve
from test_warehouse_location_locks import state
from test_warehouse_locations import location
from test_warehouse_receipts import intake
from test_warehouse_receipts import warehouse as warehouse


def reallocate(client, setup, lot, **values):
    return client.post(
        f"/api/team-materials/{setup['team']['id']}/serial-reallocations",
        headers=setup["headers"],
        json={
            "source_transfer_id": lot["id"],
            "serial_no": "000B",
            "quantity": 30,
            "weight": "6.000",
            "reason": "转投另一订单",
            "idempotency_key": "reallocate-1",
            **values,
        },
    )


def test_partial_reallocation_is_atomic_stock_with_original_batch_and_separate_metrics(
    client, warehouse
):
    lot = intake(
        client,
        warehouse,
        serial_no="000A",
        quantity=100,
        weight="20.000",
        delivery_date="2026-11-01",
        delivery_quantity=100,
    ).json()
    result = reallocate(client, warehouse, lot)
    assert result.status_code == 201, result.text
    target = result.json()
    assert target["serial_no"] == "000B" and target["source_serial_no"] == "000A"
    assert (
        target["source_transfer_id"] == lot["id"]
        and target["source_transfer_batch_no"] == lot["batch_no"]
    )
    assert target["batch_no"] != lot["batch_no"] and target["entry_kind"] == "serial_reallocation"
    assert target["source_team_id"] == target["next_team_id"] == warehouse["team"]["id"]
    assert target["status"] == "received" and target["stock_tracked"] and target["locked"]
    assert (
        target["allowed_actions"] == []
        and target["delivery_date"] is None
        and target["delivery_origin_batch_no"] != lot["batch_no"]
    )
    assert (
        target["material_name"] == lot["material_name"]
        and target["material_type"] == lot["material_type"]
    )
    assert target["history"][0]["action"] == "reallocated"
    assert target["history"][0]["changes"]["stock_weight"]["after"] == 14
    assert reallocate(client, warehouse, lot).json() == target
    assert reallocate(client, warehouse, lot, quantity=31).status_code == 409
    with SessionLocal() as db:
        original = db.get(MaterialTransfer, lot["id"])
        assert original.serial_no == "000A" and original.quantity == 100
        a, b = db.get(MaterialStockBalance, lot["id"]), db.get(MaterialStockBalance, target["id"])
        assert (a.on_hand_quantity, float(a.on_hand_weight)) == (70, 14)
        assert (b.on_hand_quantity, float(b.on_hand_weight)) == (30, 6)
    for serial in ("000A", "000B"):
        trace = client.get("/api/material-trace", params={"serial_no": serial}).json()
        assert trace["reallocations"][0]["source_serial_no"] == "000A"
        assert trace["reallocations"][0]["serial_no"] == "000B"
        assert (
            trace["totals"]["dispatched"] == trace["totals"]["lost"] == {"quantity": 0, "weight": 0}
        )
        history = client.get(
            f"/api/team-materials/{warehouse['team']['id']}/serial-history",
            params={"serial_no": serial},
        ).json()
        assert history["untracked_count"] == 0
        assert history["groups"][0]["on_hand_quantity"] == (70 if serial == "000A" else 30)
        assert history["lots"][0]["closing_quantity"] == (70 if serial == "000A" else 30)
    dashboard = client.get("/api/factory-dashboard").json()
    assert dashboard["stock"]["total"] == {"quantity": 100, "weight": 20}
    rates = {
        row["serial_no"]: row for row in client.get("/api/factory-dashboard/yields").json()["items"]
    }
    assert rates["000A"]["input_weight"] == 14 and rates["000B"]["input_weight"] == 6
    assert rates["000A"]["reallocated_out_weight"] == rates["000B"]["reallocated_in_weight"] == 6
    assert all(row["output_weight"] == 0 for row in rates.values())
    assert client.get(f"/api/material-transfers/{target['batch_no']}").json() == target
    assert (
        client.get(f"/api/team-materials/{warehouse['team']['id']}/dispatches").json()["total"] == 0
    )
    assert (
        client.get(f"/api/team-materials/{warehouse['team']['id']}/outbound-batches").json()[
            "total"
        ]
        == 0
    )
    analytics = client.get(f"/api/team-materials/{warehouse['team']['id']}/analytics").json()
    assert sum(row["incoming"]["quantity"] for row in analytics["trend"]) == 100
    assert sum(row["incoming"]["weight"] for row in analytics["trend"]) == 20
    assert sum(row["outgoing"]["quantity"] for row in analytics["trend"]) == 0


@pytest.mark.parametrize(
    "code,kind",
    [
        ("FACTORY-WAREHOUSE", "warehouse"),
        ("FACTORY-QC", "production"),
        ("FACTORY-PLATE", "production"),
    ],
)
def test_only_designated_own_team_can_reallocate_and_new_submissions_accumulate(client, code, kind):
    team = client.post(
        "/api/teams",
        json={"code": code, "name": "库房" if kind == "warehouse" else code, "kind": kind},
    ).json()
    _, headers = _leader(client, "allowed-leader", team["id"])
    setup = {"team": team, "headers": headers}
    client.put(
        f"/api/team-materials/{team['id']}/opening-stock/authorization", json={"enabled": True}
    )
    response = client.post(
        f"/api/team-materials/{team['id']}/opening-stock",
        headers=headers,
        json={
            "idempotency_key": "opening",
            "lines": [
                {
                    "serial_no": "000A",
                    "material_name": "材料1",
                    "material_type": "semi_finished",
                    "quantity": 100,
                    "weight": 20,
                }
            ],
        },
    )
    assert response.status_code == 201, response.text
    lot = response.json()["items"][0]
    for index in range(2):
        result = reallocate(client, setup, lot, idempotency_key=f"allocation-{index}")
        assert result.status_code == 201, result.text
    overview = client.get(f"/api/team-materials/{team['id']}/overview").json()
    assert overview["totals"]["owned_quantity"] == 100 and overview["totals"]["owned_weight"] == 20
    assert overview["pending_incoming"]["count"] == 0
    rates = client.get("/api/factory-dashboard/yields").json()["items"]
    assert all(row["status"] == "needs_review" for row in rates)
    with SessionLocal() as db:
        assert db.get(MaterialStockBalance, lot["id"]).on_hand_quantity == 40


def test_permissions_invalid_targets_and_signed_amount_policy(client, warehouse):
    lot = intake(client, warehouse).json()
    url = f"/api/team-materials/{warehouse['team']['id']}/serial-reallocations"
    body = {
        "source_transfer_id": lot["id"],
        "serial_no": "B",
        "quantity": 30,
        "weight": 6,
        "reason": "转投",
        "idempotency_key": "permission",
    }
    for headers in ({}, warehouse["other_headers"], dict(client.headers)):
        assert client.post(url, headers=headers, json=body).status_code == 403
    other_url = f"/api/team-materials/{warehouse['other']['id']}/serial-reallocations"
    assert client.post(other_url, headers=warehouse["other_headers"], json=body).status_code == 403
    for invalid in (
        {"serial_no": lot["serial_no"]},
        {"serial_no": "   "},
        {"quantity": -1},
        {"quantity": 0, "weight": 0},
        {"reason": " "},
        {"material_type": "finished"},
    ):
        assert reallocate(client, warehouse, lot, **invalid).status_code == 422
    # The customer's existing no-cap policy also applies here, retaining signed stock.
    result = reallocate(client, warehouse, lot, quantity=101, weight=11)
    assert result.status_code == 201, result.text
    with SessionLocal() as db:
        assert db.get(MaterialStockBalance, lot["id"]).on_hand_quantity == -1


def test_reallocated_finished_shipments_use_target_serial_input_without_inflating_purchase(
    client, warehouse
):
    lot = intake(client, warehouse, serial_no="A", material_type="finished", weight=20).json()
    target = reallocate(client, warehouse, lot).json()
    sent = client.post(
        f"/api/team-materials/{warehouse['team']['id']}/dispatches",
        headers=warehouse["headers"],
        json={
            "entry_kind": "warehouse_outbound",
            "external_destination": "客户",
            "idempotency_key": "ship-B",
            "lines": [{"source_transfer_id": target["id"], "quantity": 30, "weight": 6}],
        },
    )
    assert sent.status_code == 201, sent.text
    rates = {
        row["serial_no"]: row for row in client.get("/api/factory-dashboard/yields").json()["items"]
    }
    assert rates["000B"]["rate"] == 100 and rates["000B"]["output_weight"] == 6
    detail = client.get("/api/factory-dashboard/team-yields", params={"serial_no": "000B"}).json()[
        "items"
    ][0]
    assert detail["input_weight"] == detail["output_weight"] == 6 and detail["rate"] == 100
    detail_a = client.get("/api/factory-dashboard/team-yields", params={"serial_no": "A"}).json()[
        "items"
    ][0]
    assert detail_a["input_weight"] == 14 and detail_a["output_weight"] == 0


def test_sludge_retains_ratio_and_failed_location_does_not_deduct_stock(client, warehouse):
    lot = intake(
        client,
        warehouse,
        material_type="sludge",
        quantity=0,
        weight=2,
        sludge_gross_weight=10,
        sludge_content_percent=20,
    ).json()
    assert reallocate(client, warehouse, lot, quantity=0, weight=1).status_code == 422
    result = reallocate(
        client,
        warehouse,
        lot,
        quantity=0,
        weight=1,
        sludge_gross_weight=5,
        sludge_content_percent=20,
        warehouse_location="missing",
        warehouse_location_reservation_key="missing",
    )
    assert result.status_code == 422
    result = reallocate(
        client,
        warehouse,
        lot,
        quantity=0,
        weight=1,
        sludge_gross_weight=5,
        sludge_content_percent=20,
    )
    assert result.status_code == 201, result.text
    assert (
        result.json()["sludge_content_percent"] == 20 and result.json()["sludge_gross_weight"] == 5
    )
    with SessionLocal() as db:
        assert float(db.get(MaterialStockBalance, lot["id"]).on_hand_weight) == 1


def test_warehouse_reallocation_uses_target_identity_and_preserves_both_slot_balances(
    client, warehouse
):
    selected_a = location(client, warehouse, "A-01")
    original = intake(client, warehouse, serial_no="000A", weight=20, **selected_a).json()
    selected_b = location(client, warehouse, "B-01")
    existing_b = intake(
        client,
        warehouse,
        serial_no="000B",
        quantity=10,
        weight=2,
        idempotency_key="existing-B",
        **selected_b,
    ).json()
    slots = client.get("/api/warehouse-locations").json()["items"]
    a_slot = next(row for row in slots if row["name"] == "A-01")
    b_slot = next(row for row in slots if row["name"] == "B-01")
    source_lease = reserve(
        client,
        warehouse,
        a_slot,
        {
            "serial_no": "000A",
            "material_name": original["material_name"],
            "material_type": original["material_type"],
        },
    )
    failed = reallocate(client, warehouse, original, **source_lease)
    assert failed.status_code == 409, failed.text
    assert state(client, a_slot)["batches"][0]["quantity"] == 100
    target_lease = reserve(
        client,
        warehouse,
        b_slot,
        {
            "serial_no": "000B",
            "material_name": original["material_name"],
            "material_type": original["material_type"],
        },
    )
    result = reallocate(client, warehouse, original, **target_lease)
    assert result.status_code == 201, result.text
    assert result.json()["warehouse_location"] == "B-01"
    assert state(client, a_slot)["batches"][0]["quantity"] == 70
    assert state(client, a_slot)["batches"][0]["weight"] == 14
    assert {row["batch_no"] for row in state(client, b_slot)["batches"]} == {
        existing_b["batch_no"],
        result.json()["batch_no"],
    }
    assert sum(row["weight"] for row in state(client, b_slot)["batches"]) == 8


def test_reallocation_chains_remain_traceable_and_do_not_make_a_shortage_origin_measurable(
    client, warehouse
):
    original = intake(client, warehouse, serial_no="000A", quantity=100, weight=20).json()
    b = reallocate(client, warehouse, original, quantity=110, weight=22).json()
    c = reallocate(
        client, warehouse, b, serial_no="000C", quantity=30, weight=6, idempotency_key="B-C"
    ).json()
    assert c["source_serial_no"] == "000B" and c["source_transfer_batch_no"] == b["batch_no"]
    trace_b = client.get("/api/material-trace", params={"serial_no": "000B"}).json()
    assert {row["batch_no"] for row in trace_b["reallocations"]} == {b["batch_no"], c["batch_no"]}
    rates = client.get("/api/factory-dashboard/yields").json()["items"]
    assert {row["serial_no"] for row in rates} == {"000A", "000B", "000C"}
    assert all(row["status"] == "needs_review" and row["rate"] is None for row in rates)
