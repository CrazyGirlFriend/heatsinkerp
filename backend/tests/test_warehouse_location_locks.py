"""Exclusive warehouse form selection, stock ownership, expiry and rollback."""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from uuid import uuid4

from sqlalchemy import func, select

from app.database import SessionLocal
from app.models import MaterialTransfer, WarehouseLocation, utcnow
from test_warehouse_receipts import warehouse, intake  # noqa: F401
from test_warehouse_locations import dispatch, location


def create_slot(client, name="A-01"):
    result = client.post("/api/warehouse-locations", json={"name": name})
    assert result.status_code == 201, result.text
    return result.json()


def claim(client, slot, headers, key=None):
    return client.post(
        f"/api/warehouse-locations/{slot['id']}/reservation",
        headers=headers,
        json={"key": key or uuid4().hex},
    )


def release(client, slot, headers, key):
    return client.request(
        "DELETE",
        f"/api/warehouse-locations/{slot['id']}/reservation",
        headers=headers,
        json={"key": key},
    )


def state(client, slot):
    return next(
        row
        for row in client.get("/api/warehouse-locations").json()["items"]
        if row["id"] == slot["id"]
    )


def test_selection_locks_until_its_owner_cancels(client, warehouse):
    slot, key = create_slot(client), uuid4().hex
    assert claim(client, slot, warehouse["headers"], key).status_code == 200
    assert state(client, slot)["status"] == "locked"
    assert claim(client, slot, warehouse["other_headers"]).status_code == 409
    assert claim(client, slot, warehouse["headers"]).status_code == 409
    assert claim(client, slot, warehouse["headers"], key).status_code == 200
    assert release(client, slot, warehouse["other_headers"], key).status_code == 403
    assert release(client, slot, warehouse["headers"], key).status_code == 204
    assert state(client, slot)["status"] == "available"
    assert claim(client, slot, warehouse["other_headers"]).status_code == 200


def test_expired_form_cannot_unlock_the_next_form(client, warehouse):
    slot = create_slot(client)
    first = claim(client, slot, warehouse["headers"]).json()
    with SessionLocal.begin() as db:
        db.get(WarehouseLocation, slot["id"]).reserved_until = utcnow() - timedelta(seconds=1)
    second = claim(client, slot, warehouse["other_headers"]).json()
    assert second["key"] != first["key"]
    assert release(client, slot, warehouse["headers"], first["key"]).status_code == 204
    assert claim(client, slot, warehouse["headers"], first["key"]).status_code == 409
    assert state(client, slot)["status"] == "locked"


def test_intake_consumes_lease_and_late_close_cannot_free_stock(client, warehouse):
    slot = create_slot(client)
    lease = claim(client, slot, warehouse["headers"]).json()
    assert intake(client, warehouse, warehouse_location=slot["name"]).status_code == 409
    selected = {
        "warehouse_location": slot["name"],
        "warehouse_location_reservation_key": lease["key"],
    }
    result = intake(client, warehouse, **selected)
    assert result.status_code == 201, result.text
    assert intake(client, warehouse, **selected).json() == result.json()
    assert release(client, slot, warehouse["headers"], lease["key"]).status_code == 204
    assert state(client, slot)["status"] == "occupied"
    assert claim(client, slot, warehouse["other_headers"]).status_code == 409
    assert intake(client, warehouse, idempotency_key="no-location").status_code == 201


def test_warehouse_account_can_maintain_its_slots(client, warehouse):
    headers = warehouse["headers"]
    created = client.post("/api/warehouse-locations", headers=headers, json={"name": "库房-01"})
    assert created.status_code == 201, created.text
    slot = created.json()
    assert slot["team_id"] == warehouse["team"]["id"]
    assert (
        client.get("/api/warehouse-locations", headers=headers).json()["items"][0]["id"]
        == slot["id"]
    )
    url = f"/api/warehouse-locations/{slot['id']}"
    edited = client.patch(url, headers=headers, json={"name": "库房-02", "expected_version": 1})
    assert edited.status_code == 200, edited.text
    assert edited.json()["name"] == "库房-02"
    assert (
        client.patch(
            url,
            headers=warehouse["other_headers"],
            json={"name": "其他班组修改", "expected_version": 2},
        ).status_code
        == 403
    )


def test_managers_maintain_slots_but_cannot_edit_a_busy_slot(client, warehouse):
    assert (
        client.post(
            "/api/warehouse-locations", headers=warehouse["other_headers"], json={"name": "X"}
        ).status_code
        == 403
    )
    assert (
        client.get("/api/warehouse-locations", headers=warehouse["other_headers"]).status_code
        == 403
    )
    slot = create_slot(client)
    assert client.post("/api/warehouse-locations", json={"name": " A-01 "}).status_code == 409
    url = f"/api/warehouse-locations/{slot['id']}"
    assert client.patch(url, json={"name": "A-02", "expected_version": 2}).status_code == 409
    lease = claim(client, slot, warehouse["headers"]).json()
    assert client.patch(url, json={"name": "A-02", "expected_version": 1}).status_code == 409
    assert release(client, slot, warehouse["headers"], lease["key"]).status_code == 204
    disabled = client.patch(url, json={"name": "A-02", "active": False, "expected_version": 1})
    assert disabled.status_code == 200, disabled.text
    assert disabled.json()["status"] == "disabled"
    assert claim(client, slot, warehouse["headers"]).status_code == 409


def test_source_slot_stays_occupied_until_full_outgoing_is_confirmed(client, warehouse):
    origin = intake(client, warehouse, **location(client, warehouse, "A-01")).json()
    slot = client.get("/api/warehouse-locations").json()["items"][0]
    outgoing = dispatch(client, warehouse, origin, "out")
    assert state(client, slot)["status"] == "occupied"
    assert (
        client.delete(
            f"/api/material-transfers/{outgoing['batch_no']}", headers=warehouse["headers"]
        ).status_code
        == 204
    )
    assert state(client, slot)["status"] == "occupied"
    outgoing = dispatch(client, warehouse, origin, "out-2")
    assert (
        client.post(
            f"/api/material-transfers/{outgoing['batch_no']}/confirm",
            headers=warehouse["other_headers"],
            json={"idempotency_key": "recv"},
        ).status_code
        == 200
    )
    assert state(client, slot)["status"] == "available"
    assert claim(client, slot, warehouse["headers"]).status_code == 200


def production_source(client, setup):
    row = dispatch(client, setup, intake(client, setup).json(), "out")
    assert (
        client.post(
            f"/api/material-transfers/{row['batch_no']}/confirm",
            headers=setup["other_headers"],
            json={"idempotency_key": "recv"},
        ).status_code
        == 200
    )
    return row


def return_rows(client, setup, source, key, selected, count=1):
    return client.post(
        f"/api/team-materials/{setup['other']['id']}/outbound-batches",
        headers=setup["other_headers"],
        json={
            "next_team_id": setup["team"]["id"],
            "idempotency_key": key,
            "lines": [
                {"source_transfer_id": source["id"], "quantity": 10, "weight": 1, **selected}
                for _ in range(count)
            ],
        },
    )


def test_saved_transfer_retains_lock_through_receipt_and_void_releases(client, warehouse):
    source = production_source(client, warehouse)
    selected = location(client, warehouse, "A-01", headers=warehouse["other_headers"])
    slot = client.get("/api/warehouse-locations").json()["items"][0]
    result = return_rows(client, warehouse, source, "return", selected)
    assert result.status_code == 201, result.text
    row = result.json()["items"][0]
    assert return_rows(client, warehouse, source, "return", selected).json() == result.json()
    assert state(client, slot)["status"] == "locked"
    with SessionLocal() as db:
        assert db.get(WarehouseLocation, slot["id"]).reservation_key is None
    assert claim(client, slot, warehouse["headers"]).status_code == 409
    assert (
        client.post(
            f"/api/material-transfers/{row['batch_no']}/confirm",
            headers=warehouse["headers"],
            json={"idempotency_key": "return-recv", "warehouse_location": "A-01"},
        ).status_code
        == 200
    )
    assert state(client, slot)["status"] == "occupied"
    selected2 = location(client, warehouse, "A-02", headers=warehouse["other_headers"])
    row2 = return_rows(client, warehouse, source, "return2", selected2).json()["items"][0]
    assert (
        client.delete(
            f"/api/material-transfers/{row2['batch_no']}", headers=warehouse["other_headers"]
        ).status_code
        == 204
    )
    assert location(client, warehouse, "A-02")


def test_duplicate_slot_in_bulk_rolls_back_every_row_and_preserves_form_lock(client, warehouse):
    source = production_source(client, warehouse)
    selected = location(client, warehouse, "A-01", headers=warehouse["other_headers"])
    with SessionLocal() as db:
        before = db.scalar(select(func.count(MaterialTransfer.id)))
    assert (
        return_rows(client, warehouse, source, "duplicate-slot", selected, count=2).status_code
        == 409
    )
    with SessionLocal() as db:
        assert db.scalar(select(func.count(MaterialTransfer.id))) == before
        assert (
            db.scalar(select(WarehouseLocation.reservation_key))
            == selected["warehouse_location_reservation_key"]
        )
    assert return_rows(client, warehouse, source, "valid-one", selected).status_code == 201


def test_simultaneous_forms_only_one_claims_slot(client, warehouse):
    slot, barrier = create_slot(client), Barrier(4)

    def send(_):
        barrier.wait(timeout=10)
        return claim(client, slot, warehouse["headers"]).status_code

    with ThreadPoolExecutor(max_workers=4) as pool:
        assert sorted(pool.map(send, range(4))) == [200, 409, 409, 409]


def test_expired_and_foreign_keys_cannot_be_used_to_submit(client, warehouse):
    slot = create_slot(client)
    lease = claim(client, slot, warehouse["other_headers"]).json()
    selected = {
        "warehouse_location": slot["name"],
        "warehouse_location_reservation_key": lease["key"],
    }
    assert intake(client, warehouse, **selected).status_code == 409
    assert release(client, slot, warehouse["other_headers"], lease["key"]).status_code == 204
    lease = claim(client, slot, warehouse["headers"]).json()
    selected["warehouse_location_reservation_key"] = lease["key"]
    with SessionLocal.begin() as db:
        db.get(WarehouseLocation, slot["id"]).reserved_until = utcnow() - timedelta(seconds=1)
    assert intake(client, warehouse, **selected).status_code == 409
    assert (
        intake(client, warehouse, warehouse_location_reservation_key=lease["key"]).status_code
        == 422
    )
    assert state(client, slot)["status"] == "available"


def test_direct_transfer_and_edit_require_a_lease_and_preserve_assigned_slot(client, warehouse):
    selected = location(client, warehouse, "A-01", headers=warehouse["other_headers"])
    payload = {
        "serial_no": "SLOT-DIRECT",
        "material_type": "semi_finished",
        "quantity": 10,
        "weight": 1,
        "next_team_id": warehouse["team"]["id"],
        "idempotency_key": "direct",
        **selected,
    }
    created = client.post(
        "/api/material-transfers", headers=warehouse["other_headers"], json=payload
    )
    assert created.status_code == 201, created.text
    transfer = created.json()
    assert (
        client.post(
            "/api/material-transfers", headers=warehouse["other_headers"], json=payload
        ).json()["id"]
        == transfer["id"]
    )
    url = "/api/material-transfers/" + transfer["batch_no"]
    assert (
        client.patch(
            url, headers=warehouse["other_headers"], json={"warehouse_location": None}
        ).status_code
        == 409
    )
    assert (
        client.patch(
            url,
            headers=warehouse["other_headers"],
            json={"warehouse_location": "A-01", "notes": "保留原仓位"},
        ).status_code
        == 200
    )
    second = client.post(
        "/api/material-transfers",
        headers=warehouse["other_headers"],
        json={
            k: v
            for k, v in {**payload, "idempotency_key": "second"}.items()
            if not k.startswith("warehouse_location")
        },
    ).json()
    selected = location(client, warehouse, "B-01", headers=warehouse["other_headers"])
    updated = client.patch(
        "/api/material-transfers/" + second["batch_no"],
        headers=warehouse["other_headers"],
        json=selected,
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["warehouse_location"] == "B-01"
    assert (
        client.post(
            url + "/confirm",
            headers=warehouse["headers"],
            json={"idempotency_key": "confirm-direct", "warehouse_location": "A-01"},
        ).status_code
        == 200
    )


def test_all_split_outgoings_must_be_received_before_releasing_slot(client, warehouse):
    origin = intake(client, warehouse, **location(client, warehouse, "A-01")).json()
    slot = client.get("/api/warehouse-locations").json()["items"][0]
    response = client.post(
        f"/api/team-materials/{warehouse['team']['id']}/outbound-batches",
        headers=warehouse["headers"],
        json={
            "next_team_id": warehouse["other"]["id"],
            "idempotency_key": "two-outgoings",
            "lines": [
                {"source_transfer_id": origin["id"], "quantity": 40, "weight": 4},
                {"source_transfer_id": origin["id"], "quantity": 60, "weight": 6.125},
            ],
        },
    )
    assert response.status_code == 201, response.text
    rows = response.json()["items"]
    assert state(client, slot)["status"] == "occupied"
    assert (
        client.post(
            f"/api/material-transfers/{rows[0]['batch_no']}/confirm",
            headers=warehouse["other_headers"],
            json={"idempotency_key": "partial"},
        ).status_code
        == 200
    )
    assert state(client, slot)["status"] == "occupied"
    assert claim(client, slot, warehouse["headers"]).status_code == 409
    assert (
        client.post(
            f"/api/material-transfers/{rows[1]['batch_no']}/confirm",
            headers=warehouse["other_headers"],
            json={"idempotency_key": "complete"},
        ).status_code
        == 200
    )
    assert state(client, slot)["status"] == "available"


def test_heartbeats_cannot_extend_a_draft_beyond_ten_minutes(client, warehouse):
    from unittest.mock import patch
    from datetime import datetime, timezone

    start = utcnow()
    slot = create_slot(client)
    with patch("app.warehouse_locations.utcnow", return_value=start):
        first = claim(client, slot, warehouse["headers"]).json()
    deadline = datetime.fromisoformat(first["hold_until"]).replace(tzinfo=None)
    assert deadline == start + timedelta(minutes=10)
    with patch("app.warehouse_locations.utcnow", return_value=start + timedelta(minutes=9)):
        renewed = claim(client, slot, warehouse["headers"], first["key"]).json()
        assert renewed["expires_at"] == deadline.replace(tzinfo=timezone.utc).isoformat()
        assert renewed["hold_until"] == first["hold_until"]
    with patch("app.warehouse_locations.utcnow", return_value=deadline):
        assert state(client, slot)["status"] == "available"
        assert claim(client, slot, warehouse["headers"], first["key"]).status_code == 409
        assert (
            intake(
                client,
                warehouse,
                warehouse_location=slot["name"],
                warehouse_location_reservation_key=first["key"],
            ).status_code
            == 409
        )
        assert claim(client, slot, warehouse["other_headers"]).status_code == 200
