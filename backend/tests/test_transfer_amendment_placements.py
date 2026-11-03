"""Approved handoff corrections keep physical warehouse positions consistent."""

import pytest
from receipt_helpers import receipt_post
from test_warehouse_location_locks import create_slot, state
from test_warehouse_locations import dispatch, location
from test_warehouse_placements import place, stock
from test_warehouse_receipts import intake
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

pytestmark = pytest.mark.usefixtures("legacy_stock")


def receive(client, transfer, headers, key, **fields):
    response = receipt_post(
        client,
        f"/api/material-transfers/{transfer['batch_no']}/confirm",
        headers=headers,
        json={"idempotency_key": key, **fields},
    )
    assert response.status_code == 200, response.text
    return response.json()


def request(client, transfer, headers, quantity, weight):
    response = client.post(
        f"/api/material-transfers/{transfer['batch_no']}/amendments",
        headers=headers,
        json={
            "expected_version": transfer["version"],
            "quantity": quantity,
            "weight": weight,
            "notes": transfer["notes"],
            "reason": "双方复核库存",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def approve(client, amendment, headers):
    response = client.post(
        f"/api/transfer-amendments/{amendment['id']}/approve", headers=headers, json={}
    )
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize("manual_placement", [False, True])
def test_received_correction_reduces_positions_and_increase_stays_unassigned(
    client, warehouse, manual_placement
):
    origin = intake(client, warehouse, weight=10).json()
    sent = dispatch(client, warehouse, origin, "outgoing")
    sent = receive(client, sent, warehouse["other_headers"], "receive-production")
    returning = dispatch(
        client, warehouse, {**sent, "quantity": 60, "weight": 6}, "return", returning=True
    )
    fields = {} if manual_placement else location(client, warehouse, "RETURN")
    returning = receive(client, returning, warehouse["headers"], "receive-return", **fields)
    if manual_placement:
        assert returning["warehouse_location"] is None
        slot = create_slot(client, "RETURN")
        placed = place(client, warehouse, slot, returning, 60, 6)
        assert placed.status_code == 200, placed.text
    proposed = request(client, returning, warehouse["other_headers"], 50, 5)
    before = stock(client, warehouse, returning)
    assert (before["on_hand_quantity"], before["warehouse_positions"][0]["quantity"]) == (60, 60)
    approve(client, proposed, warehouse["headers"])
    reduced = stock(client, warehouse, returning)
    assert (reduced["on_hand_quantity"], reduced["on_hand_weight"]) == (50, 5)
    assert reduced["warehouse_positions"][0]["quantity"] == 50
    assert reduced["warehouse_positions"][0]["weight"] == 5
    assert reduced["unassigned_quantity"] == reduced["unassigned_weight"] == 0
    # Approval replay must not subtract the correction from the slot twice.
    approve(client, proposed, warehouse["headers"])
    assert (
        stock(client, warehouse, returning)["warehouse_positions"] == reduced["warehouse_positions"]
    )

    current = client.get(f"/api/material-transfers/{returning['batch_no']}").json()
    added = request(client, current, warehouse["headers"], 55, 5.5)
    approve(client, added, warehouse["other_headers"])
    increased = stock(client, warehouse, returning)
    assert (increased["on_hand_quantity"], increased["on_hand_weight"]) == (55, 5.5)
    assert increased["warehouse_positions"] == reduced["warehouse_positions"]
    assert (increased["unassigned_quantity"], increased["unassigned_weight"]) == (5, 0.5)


def test_source_warehouse_correction_does_not_reoccupy_reused_slot(client, warehouse):
    source = intake(client, warehouse, weight=10, **location(client, warehouse, "SOURCE")).json()
    sent = dispatch(client, warehouse, source, "outgoing")
    sent = receive(client, sent, warehouse["other_headers"], "receive-production")
    replacement = intake(
        client,
        warehouse,
        serial_no="OTHER-MATERIAL",
        idempotency_key="replacement",
        **location(client, warehouse, "SOURCE"),
    ).json()
    slot = next(
        item
        for item in client.get("/api/warehouse-locations").json()["items"]
        if item["name"] == "SOURCE"
    )
    proposed = request(client, sent, warehouse["headers"], 90, 9)
    approve(client, proposed, warehouse["other_headers"])
    restored = stock(client, warehouse, source)
    assert (restored["on_hand_quantity"], restored["on_hand_weight"]) == (10, 1)
    assert (restored["unassigned_quantity"], restored["unassigned_weight"]) == (10, 1)
    assert restored["warehouse_positions"] == []
    assert [row["id"] for row in state(client, slot)["batches"]] == [replacement["id"]]
