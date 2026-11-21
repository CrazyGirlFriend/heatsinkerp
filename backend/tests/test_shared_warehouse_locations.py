"""Shared slots keep independent batch balances and exclusive form ownership."""

from uuid import uuid4

import pytest
from app.database import SessionLocal
from app.models import WarehouseLocation, WarehousePlacement
from receipt_helpers import receipt_post
from sender_helpers import sender_post
from sqlalchemy import select
from test_warehouse_location_locks import create_slot, production_source, return_rows, state
from test_warehouse_locations import dispatch, location
from test_warehouse_receipts import intake
from test_warehouse_receipts import warehouse as warehouse

MATERIAL = {"serial_no": "WAREHOUSE-001", "material_name": "铜钼", "material_type": "semi_finished"}


pytestmark = pytest.mark.usefixtures("legacy_stock")


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
    assert [item["id"] for item in choices] == [empty["id"], slot["id"]]
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
    ("change", "field"),
    [
        ({"material_name": "材料2"}, "材质"),
        ({"material_type": "finished"}, "物料类型"),
        ({"transfer_specification": "100 × 80 × 6 mm"}, "尺寸"),
    ],
)
def test_incompatible_stock_is_rejected_and_slot_lease_survives(client, warehouse, change, field):
    first = intake(client, warehouse, **location(client, warehouse, "A-01"))
    assert first.status_code == 201, first.text
    slot = state(client, {"id": 1})
    if "material_name" in change or "material_type" in change:
        partial = {**MATERIAL, **change}
        endpoint = f"/api/team-materials/{warehouse['team']['id']}/warehouse-locations"
        assert client.get(endpoint, params=partial).json()["items"] == []
        lease = client.post(
            f"/api/warehouse-locations/{slot['id']}/reservation",
            headers=warehouse["headers"],
            json={"key": uuid4().hex, **partial},
        )
        assert lease.status_code == 409, lease.text
    if "transfer_specification" in change:
        endpoint = f"/api/team-materials/{warehouse['team']['id']}/warehouse-locations"
        assert client.get(endpoint, params={**MATERIAL, **change}).json()["items"] == []
        assert (
            client.get(endpoint, params={**MATERIAL, "transfer_specification": "100*80*5"}).json()[
                "total"
            ]
            == 1
        )
        lease = client.post(
            f"/api/warehouse-locations/{slot['id']}/reservation",
            headers=warehouse["headers"],
            json={"key": uuid4().hex, **MATERIAL, **change},
        )
        assert lease.status_code == 409 and "尺寸" in lease.text
    selected = reserve(client, warehouse, slot)
    response = intake(client, warehouse, idempotency_key="mixed", **change, **selected)
    assert response.status_code == 409 and field in response.text, response.text
    result = state(client, slot)
    assert result["draft_locked"] and [row["id"] for row in result["batches"]] == [
        first.json()["id"]
    ]
    accepted = intake(
        client,
        warehouse,
        idempotency_key="mixed",
        serial_no="OTHER",
        transfer_specification="100*80*5",
        material_description="说明不同",
        material_shape="棒料",
        outsourced_unit="加工厂",
        is_outsourced=True,
        **selected,
    )
    assert accepted.status_code == 201, accepted.text


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
    # Busy slots remain visible, but another form cannot claim them.
    endpoint = f"/api/team-materials/{warehouse['team']['id']}/warehouse-locations"
    listed = client.get(endpoint).json()
    assert listed["total"] == 1 and listed["items"][0]["draft_locked"]


def test_manual_placement_adds_same_lot_and_rejects_different_material(client, warehouse):
    slot = create_slot(client)
    first = intake(client, warehouse).json()
    second = intake(client, warehouse, idempotency_key="second", material_name="铝").json()
    with SessionLocal.begin() as db:
        for placement in db.scalars(select(WarehousePlacement)).all():
            db.delete(placement)
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
        if lot["id"] == second["id"]:
            assert response.status_code == 409 and "材质" in response.text, response.text
        else:
            assert response.status_code == 200, response.text
    assert [batch["id"] for batch in state(client, slot)["batches"]] == [first["id"]]
    assert sum(batch["quantity"] for batch in state(client, slot)["batches"]) == 100
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


def test_mixed_bulk_arrival_rolls_back_every_line_and_keeps_lease(client, warehouse):
    source = production_source(client, warehouse)
    stored = intake(
        client,
        warehouse,
        idempotency_key="stored",
        material_name="铝",
        **location(client, warehouse, "A-01"),
    ).json()
    chosen = location(client, warehouse, "A-01", headers=warehouse["other_headers"])
    response = sender_post(
        client,
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
        slot = db.scalar(select(WarehouseLocation).where(WarehouseLocation.name == "A-01"))
        assert slot.reservation_key == chosen["warehouse_location_reservation_key"]
        slot_id = slot.id
    assert [row["id"] for row in state(client, {"id": slot_id})["batches"]] == [stored["id"]]


def test_pending_batches_reject_incompatible_edits_and_receive_independently(client, warehouse):
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
    changed = client.patch(
        endpoint, headers=warehouse["other_headers"], json={"material_type": "finished"}
    )
    assert changed.status_code == 409 and "物料类型" in changed.text, changed.text
    assert client.get(endpoint).json()["material_type"] == "semi_finished"
    edited = client.patch(
        endpoint,
        headers=warehouse["other_headers"],
        json={"quantity": 8, "weight": 0.8, "material_type": "semi_finished"},
    )
    assert edited.status_code == 200, edited.text
    for index, row in enumerate([first, second]):
        result = receipt_post(
            client,
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


def test_location_picker_pages_all_available_slots_and_searches_existing_material(
    client, warehouse
):
    for index in range(3):
        create_slot(client, f"A-{index}")
    endpoint = f"/api/team-materials/{warehouse['team']['id']}/warehouse-locations"
    page = client.get(endpoint, params={"page": 2, "limit": 2}).json()
    assert page["total"] == 3 and page["page"] == 2
    assert [row["name"] for row in page["items"]] == ["A-2"]
    stored = intake(client, warehouse, **location(client, warehouse, "A-2")).json()
    for query in (stored["batch_no"], "铜钼", stored["serial_no"]):
        result = client.get(endpoint, params={"query": query}).json()
        assert result["total"] == 1 and result["items"][0]["name"] == "A-2"


def test_mixed_bulk_arrival_with_wrong_second_key_rolls_back_and_keeps_original_lease(
    client, warehouse
):
    source = production_source(client, warehouse)
    chosen = location(client, warehouse, "A-01", headers=warehouse["other_headers"])
    line = {"source_transfer_id": source["id"], "quantity": 10, "weight": 1, **chosen}
    response = sender_post(
        client,
        f"/api/team-materials/{warehouse['other']['id']}/outbound-batches",
        headers=warehouse["other_headers"],
        json={
            "next_team_id": warehouse["team"]["id"],
            "idempotency_key": "invalid-mixed",
            "lines": [
                line,
                {
                    **line,
                    "material_type": "finished",
                    "warehouse_location_reservation_key": uuid4().hex,
                },
            ],
        },
    )
    assert response.status_code == 409, response.text
    with SessionLocal() as db:
        slot = db.scalar(select(WarehouseLocation).where(WarehouseLocation.name == "A-01"))
        assert slot.reservation_key == chosen["warehouse_location_reservation_key"]
        slot_id = slot.id
    assert state(client, {"id": slot_id})["batches"] == []
    assert return_rows(client, warehouse, source, "retry-valid", chosen, count=2).status_code == 201
