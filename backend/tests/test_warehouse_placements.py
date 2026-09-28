"""Physical placement is independent of pending ownership and historical names."""

from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier

from sqlalchemy import select

from app.database import SessionLocal
from app.models import WarehousePlacement
from test_warehouse_receipts import warehouse, intake  # noqa: F401
from test_warehouse_locations import location, dispatch
from test_warehouse_location_locks import create_slot, state, claim
from test_transfer_list_loading import read_statements


def stock(client, setup, source):
    result = client.get(
        f"/api/team-materials/{setup['team']['id']}/stock",
        params={"availability": "all", "query": source["batch_no"]},
    )
    assert result.status_code == 200, result.text
    return result.json()["items"][0]


def place(client, setup, slot, source, quantity, weight, headers=None):
    return client.post(
        f"/api/warehouse-locations/{slot['id']}/placement",
        headers=headers or setup["headers"],
        json={
            "source_transfer_id": source["id"],
            "quantity": quantity,
            "weight": weight,
            "expected_version": slot["version"],
        },
    )


def test_reused_slot_survives_void_of_old_batch_and_can_assign_return_elsewhere(client, warehouse):
    source = intake(client, warehouse, **location(client, warehouse, "A")).json()
    slot = client.get("/api/warehouse-locations").json()["items"][0]
    outgoing = dispatch(client, warehouse, source, "out")
    assert stock(client, warehouse, source)["on_hand_quantity"] == 0
    assert stock(client, warehouse, source)["owned_quantity"] == 100
    assert stock(client, warehouse, source)["warehouse_positions"] == []
    blocked = client.post(
        f"/api/team-materials/{warehouse['team']['id']}/outbound-batches",
        headers=warehouse["headers"],
        json={
            "next_team_id": warehouse["other"]["id"],
            "idempotency_key": "duplicate-stock",
            "lines": [{"source_transfer_id": source["id"], "quantity": 1, "weight": 0.1}],
        },
    )
    assert blocked.status_code == 409
    new = intake(
        client,
        warehouse,
        idempotency_key="new",
        serial_no="NEW",
        **location(client, warehouse, "A"),
    ).json()
    assert (
        client.delete(
            "/api/material-transfers/" + outgoing["batch_no"], headers=warehouse["headers"]
        ).status_code
        == 204
    )
    assert [row["id"] for row in state(client, slot)["batches"]] == [new["id"]]
    restored = stock(client, warehouse, source)
    assert restored["unassigned_quantity"] == 100 and restored["unassigned_weight"] == 10.125
    assert restored["transfer"]["warehouse_location"] == "A"  # Historical snapshot.
    assert restored["warehouse_positions"] == []
    empty = create_slot(client, "B")
    assert (
        place(client, warehouse, empty, source, 100, 10.125, warehouse["other_headers"]).status_code
        == 403
    )
    assert place(client, warehouse, slot, source, 100, 10.125).status_code == 409
    assert place(client, warehouse, empty, source, 100, 10.125).status_code == 200
    assert place(client, warehouse, empty, source, 100, 10.125).status_code == 409
    assigned = stock(client, warehouse, source)
    assert assigned["unassigned_quantity"] == 0
    assert assigned["warehouse_positions"][0]["name"] == "B"
    assert assigned["owned_quantity"] == 100 and assigned["on_hand_quantity"] == 100


def test_partial_edit_restores_only_difference_to_unassigned(client, warehouse):
    source = intake(client, warehouse, weight=100, **location(client, warehouse, "A")).json()
    outgoing = dispatch(client, warehouse, {**source, "quantity": 30, "weight": 30}, "out")
    url = "/api/material-transfers/" + outgoing["batch_no"]
    edited = client.patch(
        url,
        headers=warehouse["headers"],
        json={"quantity": 20, "weight": 20, "expected_version": outgoing["version"]},
    )
    assert edited.status_code == 200, edited.text
    row = stock(client, warehouse, source)
    assert (row["owned_quantity"], row["on_hand_quantity"], row["in_transit_quantity"]) == (
        100,
        80,
        20,
    )
    assert row["warehouse_positions"][0]["quantity"] == 70
    assert row["warehouse_positions"][0]["weight"] == 70
    assert row["unassigned_quantity"] == 10 and row["unassigned_weight"] == 10
    base = f"/api/team-materials/{warehouse['team']['id']}"
    assert (
        client.get(base + "/stock", params={"location_status": "unassigned"}).json()["total"] == 1
    )
    classified = client.get(base + "/inventory", params={"location_status": "unassigned"})
    assert classified.status_code == 200, classified.text
    assert classified.json()["total"] == 1
    accepted = client.post(
        url + "/confirm", headers=warehouse["other_headers"], json={"idempotency_key": "receive"}
    )
    assert accepted.status_code == 200, accepted.text
    row = stock(client, warehouse, source)
    assert row["owned_quantity"] == 80 and row["warehouse_positions"][0]["quantity"] == 70
    assert client.delete(url, headers=warehouse["headers"]).status_code == 409
    assert (
        client.patch(
            url, headers=warehouse["headers"], json={"quantity": 10, "weight": 10}
        ).status_code
        == 409
    )


def test_occupied_slot_can_be_renamed_without_changing_history(client, warehouse):
    source = intake(client, warehouse, **location(client, warehouse, "A")).json()
    slot = client.get("/api/warehouse-locations").json()["items"][0]
    url = f"/api/warehouse-locations/{slot['id']}"
    assert (
        client.patch(
            url, headers=warehouse["headers"], json={"name": "B", "expected_version": 1}
        ).status_code
        == 200
    )
    assert state(client, slot)["batches"][0]["id"] == source["id"]
    assert (
        client.patch(url, json={"name": "B", "active": False, "expected_version": 2}).status_code
        == 409
    )
    row = stock(client, warehouse, source)
    assert row["warehouse_positions"][0]["name"] == "B"
    assert row["transfer"]["warehouse_location"] == "A"
    assert claim(client, slot, warehouse["headers"]).status_code == 409
    base = f"/api/team-materials/{warehouse['team']['id']}/stock"
    assert client.get(base, params={"query": "B"}).json()["total"] == 1


def test_weight_only_material_and_loss_release_slot(client, warehouse):
    response = intake(
        client,
        warehouse,
        quantity=0,
        weight=2,
        material_type="scrap_chips",
        **location(client, warehouse, "A"),
    )
    assert response.status_code == 201, response.text
    source = response.json()
    result = client.post(
        f"/api/team-materials/{warehouse['team']['id']}/losses",
        headers=warehouse["headers"],
        json={
            "source_transfer_id": source["id"],
            "quantity": 0,
            "weight": 2,
            "reason": "称重确认丢失",
            "idempotency_key": "loss",
        },
    )
    assert result.status_code == 201, result.text
    assert stock(client, warehouse, source)["warehouse_positions"] == []
    assert client.get("/api/warehouse-locations").json()["items"][0]["status"] == "available"


def test_external_submission_completes_and_releases_physical_slot_once(client, warehouse):
    source = intake(client, warehouse, **location(client, warehouse, "A")).json()
    body = {
        "entry_kind": "warehouse_outbound",
        "external_destination": "外部收货方",
        "idempotency_key": "external-slot",
        "lines": [
            {
                "source_transfer_id": source["id"],
                "quantity": source["quantity"],
                "weight": source["weight"],
            }
        ],
    }
    url = f"/api/team-materials/{warehouse['team']['id']}/outbound-batches"
    result = client.post(url, headers=warehouse["headers"], json=body)
    assert result.status_code == 201, result.text
    assert result.json()["items"][0]["status"] == "dispatched"
    row = stock(client, warehouse, source)
    assert row["owned_quantity"] == 0 and row["warehouse_positions"] == []
    assert row["unassigned_weight"] == 0 and row["dispatched_weight"] == source["weight"]
    assert client.get("/api/warehouse-locations").json()["items"][0]["status"] == "available"
    assert client.post(url, headers=warehouse["headers"], json=body).json() == result.json()


def test_concurrent_assignments_only_one_batch_claims_slot(client, warehouse):
    first = intake(client, warehouse).json()
    second = intake(client, warehouse, idempotency_key="second").json()
    slot, barrier = create_slot(client), Barrier(2)

    def run(source):
        barrier.wait()
        return place(client, warehouse, slot, source, 100, 10.125).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(run, [first, second]))
    assert sorted(results) == [200, 409]
    with SessionLocal() as db:
        rows = db.scalars(select(WarehousePlacement)).all()
        assert len(rows) == 1 and rows[0].weight == Decimal("10.125")


def test_three_selected_materials_are_three_batches_and_types_cannot_be_changed(client, warehouse):
    sources = [
        intake(
            client,
            warehouse,
            idempotency_key=f"in-{i}",
            serial_no=f"S-{i}",
            **location(client, warehouse, f"A-{i}"),
        ).json()
        for i in range(3)
    ]
    url = f"/api/team-materials/{warehouse['team']['id']}/outbound-batches"
    body = {
        "next_team_id": warehouse["other"]["id"],
        "idempotency_key": "three",
        "lines": [
            {"source_transfer_id": row["id"], "quantity": row["quantity"], "weight": row["weight"]}
            for row in sources
        ],
    }
    bad = {**body, "lines": [{**body["lines"][0], "material_type": "finished"}]}
    assert client.post(url, headers=warehouse["headers"], json=bad).status_code == 422
    with read_statements() as statements:
        result = client.post(url, headers=warehouse["headers"], json=body)
    assert result.status_code == 201, result.text
    assert sum("FROM warehouse_placements" in sql for sql in statements) == 1
    rows = result.json()["items"]
    assert len({row["batch_no"] for row in rows}) == 3
    assert all(
        row["barcode_payload"] == row["batch_no"] and row["dispatch_no"] is None for row in rows
    )
    assert all(stock(client, warehouse, source)["warehouse_positions"] == [] for source in sources)
    assert client.post(url, headers=warehouse["headers"], json=body).json() == result.json()
    assert (
        client.patch(
            "/api/material-transfers/" + rows[0]["batch_no"],
            headers=warehouse["headers"],
            json={"material_type": "finished"},
        ).status_code
        == 422
    )
