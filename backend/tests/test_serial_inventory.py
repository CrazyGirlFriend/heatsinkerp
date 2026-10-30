"""Serial lookup uses current balances, including split receipts and shared material."""

from decimal import Decimal

from app.database import SessionLocal
from app.models import MaterialTransfer
from receipt_helpers import receipt_post
from sender_helpers import sender_post
from test_external_outbound import confirm as external_confirm
from test_external_outbound import legacy_dispatch as external_dispatch
from test_external_outbound import outbound as outbound  # noqa: F401
from test_inspections import create_check
from test_inspections import inspection as inspection  # noqa: F401
from test_material_stock import dispatch, loss, receive_lot
from test_material_stock import stock_setup as stock_setup  # noqa: F401
from test_quantity_adjustments import change
from test_shared_material import shared_intake
from test_team_business import initialize
from test_warehouse_classification import confirm
from test_warehouse_classification import dispatch as workshop_dispatch
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401


def overview(client, serial="000012"):
    response = client.get("/api/serial-inventory", params={"serial_no": serial})
    assert response.status_code == 200, response.text
    return response.json()


def batches(client, row, serial="000012", **extra):
    response = client.get(
        "/api/serial-inventory/batches",
        params={
            "serial_no": serial,
            "team_id": row["team_id"],
            "material_name": row["material_name"],
            "material_type": row["material_type"],
            "shared": row["shared_unallocated"],
            **extra,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_split_receipt_return_void_and_loss(client, stock_setup):
    s = stock_setup
    root = initialize(client, s, weight="10.000")
    response = dispatch(
        client,
        s,
        [
            {"source_transfer_id": root["id"], "quantity": 30, "weight": 3},
            {"source_transfer_id": root["id"], "quantity": 20, "weight": 2},
        ],
    )
    assert response.status_code == 201, response.text
    first, second = response.json()["items"]
    assert (
        receipt_post(
            client,
            f"/api/material-transfers/{first['batch_no']}/confirm",
            headers=s["third_headers"],
            json={"idempotency_key": "receive"},
        ).status_code
        == 200
    )
    back = sender_post(
        client,
        f"/api/team-materials/{s['third']['id']}/dispatches",
        headers=s["third_headers"],
        json={
            "next_team_id": s["target"]["id"],
            "idempotency_key": "return",
            "lines": [{"source_transfer_id": first["id"], "quantity": 10, "weight": 1}],
        },
    )
    assert back.status_code == 201, back.text
    returned = back.json()["items"][0]
    assert loss(client, s, root).status_code == 201
    rows = {r["team_id"]: r for r in overview(client)["items"]}
    a, b = rows[s["target"]["id"]], rows[s["third"]["id"]]
    assert (a["stock_quantity"], a["stock_weight"], a["incoming_quantity"]) == (48, 4.8, 10)
    assert (b["stock_quantity"], b["stock_weight"], b["incoming_quantity"]) == (20, 2, 20)
    assert batches(client, a)["items"][0]["quantity"] == 48
    assert batches(client, b, location="incoming")["items"][0]["batch_no"] == second["batch_no"]
    assert (
        receipt_post(
            client,
            f"/api/material-transfers/{returned['batch_no']}/confirm",
            headers=s["target_headers"],
            json={"idempotency_key": "back"},
        ).status_code
        == 200
    )
    assert (
        client.delete(
            f"/api/material-transfers/{second['batch_no']}", headers=s["target_headers"]
        ).status_code
        == 204
    )
    rows = overview(client)["items"]
    assert sum(r["stock_quantity"] for r in rows) == 98
    assert sum(r["incoming_quantity"] for r in rows) == 0


def test_exact_serial_weight_only_and_untracked_stock(client, stock_setup):
    initialize(client, stock_setup, quantity=0, weight="1.234", material_type="scrap_chips")
    data = overview(client, " 000012 ")
    assert data["serial_no"] == "000012"
    assert data["items"][0]["stock_quantity"] == 0
    assert data["items"][0]["stock_weight"] == 1.234
    assert client.get("/api/serial-inventory", params={"serial_no": "12"}).status_code == 404
    assert client.get("/api/serial-inventory", params={"serial_no": " "}).status_code == 422
    legacy = receive_lot(client, stock_setup)
    with SessionLocal() as db:
        db.get(MaterialTransfer, legacy["id"]).stock_tracked = False
        db.commit()
    old = overview(client, legacy["serial_no"])
    assert old["untracked_count"] == 1 and old["items"] == []


def test_external_outbound_does_not_create_phantom_team_inventory(client, outbound):
    sent = external_dispatch(client, outbound)
    assert sent.status_code == 201, sent.text
    for line in sent.json()["items"]:
        before = overview(client, line["serial_no"])["items"]
        assert len(before) == 1
        assert before[0]["stock_quantity"] == 70 and before[0]["incoming_quantity"] == 0
        assert external_confirm(client, outbound, line).status_code == 200
        assert overview(client, line["serial_no"])["items"] == before


def test_processing_allocation_keeps_shared_remainder_and_scrap_separate(client, warehouse):
    s = warehouse
    assert (
        client.patch(f"/api/teams/{s['other']['id']}", json={"code": "FACTORY-WIRE"}).status_code
        == 200
    )
    origin = shared_intake(client, s).json()
    sent = workshop_dispatch(
        client, s, [{"source_transfer_id": origin["id"], "quantity": 1, "weight": 100}]
    )
    assert sent.status_code == 201, sent.text
    assert confirm(client, s, sent.json(), workshop=True).status_code == 200
    lot = sent.json()["items"][0]
    processed = change(
        client,
        s,
        lot,
        31,
        workshop=True,
        processing_status="partial",
        outputs=[
            {"role": "remaining", "quantity": 1, "weight": 40, "material_type": "semi_finished"},
            {
                "role": "produced",
                "serial_no": "ORDER-A",
                "quantity": 30,
                "weight": 55,
                "material_type": "semi_finished",
            },
            {"role": "scrap", "quantity": 0, "weight": 5, "material_type": "scrap_chips"},
        ],
    )
    assert processed.status_code == 201, processed.text
    a, b = overview(client, "ORDER-A")["items"], overview(client, "ORDER-B")["items"]
    assigned = [r for r in a if not r["shared_unallocated"]]
    shared = [r for r in a if r["shared_unallocated"]]
    assert len(assigned) == 1 and assigned[0]["stock_quantity"] == 30
    assert assigned[0]["stock_weight"] == 55
    assert sum(r["stock_weight"] for r in shared) == 45
    assert all(r["shared_unallocated"] for r in b)
    assert sum(r["stock_weight"] for r in b) == 45
    assert batches(client, assigned[0], "ORDER-A")["total"] == 1
    assert batches(client, assigned[0], "ORDER-A")["items"][0]["quantity"] == 30


def test_pagination_and_permissions_without_history_limit(client, stock_setup):
    team = stock_setup["target"]
    with SessionLocal() as db:
        for i in range(1205):
            db.add(
                MaterialTransfer(
                    batch_no=f"LOOKUP-{i:04}",
                    serial_no="000012",
                    entry_kind="opening_stock",
                    next_team_id=team["id"],
                    next_team_code=team["code"],
                    next_team_name=team["name"],
                    quantity=1,
                    weight=Decimal(".001"),
                    status="received",
                    stock_tracked=True,
                    created_by="test",
                )
            )
        db.commit()
    row = overview(client)["items"][0]
    assert row["stock_quantity"] == 1205 and row["stock_weight"] == 1.205
    last = batches(client, row, page=61, page_size=20)
    assert last["total"] == 1205 and len(last["items"]) == 5
    params = {"serial_no": "000012", "team_id": team["id"]}
    for path in ("/api/serial-inventory", "/api/serial-inventory/batches"):
        assert client.get(path, params=params, headers={"Authorization": ""}).status_code == 401
        assert (
            client.get(path, params=params, headers=stock_setup["target_headers"]).status_code
            == 403
        )


def test_frozen_and_rework_stock_stays_visible_with_its_attributes(client, inspection):
    from app.models import MaterialInspection

    _, lot, _, _ = inspection
    checked = create_check(client, inspection)
    assert checked.status_code == 201, checked.text
    with SessionLocal() as db:
        db.get(MaterialInspection, checked.json()["id"]).blocks_outbound = True
        material = db.get(MaterialTransfer, lot["id"])
        material.rework_pending = True
        material.rework_count = 2
        db.commit()
    row = next(
        r
        for r in overview(client, lot["serial_no"])["items"]
        if r["material_type"] == lot["material_type"]
    )
    assert row["stock_quantity"] == lot["quantity"]
    item = next(r for r in batches(client, row, lot["serial_no"])["items"] if r["id"] == lot["id"])
    assert item["inspection_hold_id"] == checked.json()["id"]
    assert item["rework_pending"] is True and item["rework_count"] == 2
