"""Shared slots keep independent batch balances and exclusive form ownership."""

from uuid import uuid4

import pytest
from app.database import SessionLocal
from app.models import WarehouseLocation
from sqlalchemy import select
from test_warehouse_location_locks import create_slot, production_source, return_rows, state
from test_warehouse_locations import dispatch, location
from test_warehouse_receipts import intake
from test_warehouse_receipts import warehouse as warehouse

MATERIAL = {"serial_no": "WAREHOUSE-001", "material_name": "铜钼", "material_type": "semi_finished"}


def reserve(client, setup, slot, material=MATERIAL):
    key = uuid4().hex
    result = client.post(
        f"/api/warehouse-locations/{slot['id']}/reservation",
        headers=setup["headers"],
        json={"key": key, **material},
    )
    assert result.status_code == 200, result.text
    return {"warehouse_location": slot["name"], "warehouse_location_reservation_key": key}


def test_same_material_arrivals_share_inventory_without_merging_batches(client, warehouse):
    chosen = location(client, warehouse, "Z-同类")
    first = intake(client, warehouse, **chosen).json()
    slot = state(client, {"id": 1})
    empty = create_slot(client, "A-空仓")
    choices = client.get(
        f"/api/team-materials/{warehouse['team']['id']}/warehouse-locations", params=MATERIAL
    ).json()["items"]
    assert [item["id"] for item in choices] == [slot["id"], empty["id"]]
    second = intake(
        client,
        warehouse,
        idempotency_key="second",
        quantity=40,
        weight=4,
        **reserve(client, warehouse, slot),
    )
    assert second.status_code == 201, second.text
    batches = state(client, slot)["batches"]
    assert {batch["batch_no"] for batch in batches} == {
        first["batch_no"],
        second.json()["batch_no"],
    }
    assert sum(batch["quantity"] for batch in batches) == 140
    assert sum(batch["weight"] for batch in batches) == 14.125
    assert all(
        batch["material_name"] == "铜钼" and batch["material_type"] == "semi_finished"
        for batch in batches
    )
    dispatch(client, warehouse, first, "out-first")
    assert state(client, slot)["status"] == "occupied"
    assert [batch["batch_no"] for batch in state(client, slot)["batches"]] == [
        second.json()["batch_no"]
    ]
    dispatch(client, warehouse, second.json(), "out-second")
    assert state(client, slot)["status"] == "available"


@pytest.mark.parametrize(
    "change", [{"serial_no": "OTHER"}, {"material_name": "材料2"}, {"material_type": "finished"}]
)
def test_each_material_dimension_must_match_at_selection_and_submission(client, warehouse, change):
    chosen = location(client, warehouse, "A-同类")
    assert intake(client, warehouse, **chosen).status_code == 201
    slot = state(client, {"id": 1})
    different = {**MATERIAL, **change}
    endpoint = f"/api/team-materials/{warehouse['team']['id']}/warehouse-locations"
    assert client.get(endpoint, params=different).json()["items"] == []
    failed = client.post(
        f"/api/warehouse-locations/{slot['id']}/reservation",
        headers=warehouse["headers"],
        json={"key": uuid4().hex, **different},
    )
    assert failed.status_code == 409
    selected = reserve(client, warehouse, slot)
    # A forged or edited document cannot bypass matching with an old valid lock.
    failed = intake(client, warehouse, idempotency_key="mismatch", **change, **selected)
    assert failed.status_code == 409
    assert len(state(client, slot)["batches"]) == 1
    assert state(client, slot)["draft_locked"]


def test_same_material_still_cannot_steal_another_forms_live_lock(client, warehouse):
    chosen = location(client, warehouse, "A-同类")
    assert intake(client, warehouse, **chosen).status_code == 201
    slot = state(client, {"id": 1})
    reserve(client, warehouse, slot)
    response = client.post(
        f"/api/warehouse-locations/{slot['id']}/reservation",
        headers=warehouse["headers"],
        json={"key": uuid4().hex, **MATERIAL},
    )
    assert response.status_code == 409
    assert len(state(client, slot)["batches"]) == 1


def test_manual_placement_adds_same_lot_and_compatible_lot_with_versions(client, warehouse):
    slot = create_slot(client)
    first = intake(client, warehouse).json()
    second = intake(client, warehouse, idempotency_key="second").json()
    endpoint = f"/api/warehouse-locations/{slot['id']}/placement"
    for lot, quantity, weight, version in [
        (first, 40, 4, 1),
        (first, 60, 6.125, 2),
        (second, 100, 10.125, 3),
    ]:
        response = client.post(
            endpoint,
            json={
                "source_transfer_id": lot["id"],
                "quantity": quantity,
                "weight": weight,
                "expected_version": version,
            },
        )
        assert response.status_code == 200, response.text
    assert len(state(client, slot)["batches"]) == 2
    assert sum(batch["quantity"] for batch in state(client, slot)["batches"]) == 200
    assert (
        client.post(
            endpoint,
            json={
                "source_transfer_id": first["id"],
                "quantity": 1,
                "weight": 0,
                "expected_version": 4,
            },
        ).status_code
        == 409
    )


def test_mixed_types_in_one_bulk_submit_roll_back_every_line_and_keep_lease(client, warehouse):
    source = production_source(client, warehouse)
    chosen = location(client, warehouse, "A-01", headers=warehouse["other_headers"])
    response = client.post(
        f"/api/team-materials/{warehouse['other']['id']}/outbound-batches",
        headers=warehouse["other_headers"],
        json={
            "next_team_id": warehouse["team"]["id"],
            "idempotency_key": "mixed",
            "lines": [
                {"source_transfer_id": source["id"], "quantity": 10, "weight": 1, **chosen},
                {
                    "source_transfer_id": source["id"],
                    "quantity": 10,
                    "weight": 1,
                    "material_type": "finished",
                    **chosen,
                },
            ],
        },
    )
    assert response.status_code == 409, response.text
    with SessionLocal() as db:
        assert (
            db.scalar(select(WarehouseLocation.reservation_key))
            == chosen["warehouse_location_reservation_key"]
        )
    assert return_rows(client, warehouse, source, "valid", chosen, count=2).status_code == 201


def test_pending_batches_keep_matching_identity_on_edits_and_receive_independently(
    client, warehouse
):
    source = production_source(client, warehouse)
    chosen = location(client, warehouse, "A-01", headers=warehouse["other_headers"])
    response = return_rows(client, warehouse, source, "same-material", chosen, count=2)
    assert response.status_code == 201, response.text
    first, second = response.json()["items"]
    slot = client.get("/api/warehouse-locations").json()["items"][0]
    renamed = client.patch(
        f"/api/warehouse-locations/{slot['id']}",
        json={"name": "已改名", "active": True, "expected_version": slot["version"]},
    )
    assert renamed.status_code == 200, renamed.text
    endpoint = "/api/material-transfers/" + first["batch_no"]
    conflict = client.patch(
        endpoint, headers=warehouse["other_headers"], json={"material_type": "finished"}
    )
    assert conflict.status_code == 409, conflict.text
    assert client.get(endpoint).json()["material_type"] == "semi_finished"
    edited = client.patch(
        endpoint,
        headers=warehouse["other_headers"],
        json={"quantity": 8, "weight": 0.8, "material_type": "semi_finished"},
    )
    assert edited.status_code == 200, edited.text
    for index, row in enumerate([first, second]):
        result = client.post(
            "/api/material-transfers/" + row["batch_no"] + "/confirm",
            headers=warehouse["headers"],
            json={"idempotency_key": f"receive-{index}"},
        )
        assert result.status_code == 200, result.text
    slot = client.get("/api/warehouse-locations").json()["items"][0]
    assert slot["status"] == "occupied"
    assert len(slot["batches"]) == 2
    assert all(row["status"] == "received" for row in slot["batches"])
    assert sum(row["quantity"] for row in slot["batches"]) == 18
    assert sum(row["weight"] for row in slot["batches"]) == 1.8
