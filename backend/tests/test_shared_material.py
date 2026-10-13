"""A shared physical lot is counted once and allocated only at actual processing."""

import pytest
from receipt_helpers import receipt_post
from sender_helpers import sender_post
from test_quantity_adjustments import change
from test_warehouse_classification import base, confirm, dispatch
from test_warehouse_receipts import intake  # noqa: F401
from test_warehouse_receipts import warehouse as warehouse

MEMBERS = [
    {
        "serial_no": "ORDER-A",
        "customer_code": "CA",
        "finished_specification": "20×10×2",
        "delivery_date": "2026-11-01",
        "delivery_quantity": 30,
        "planned_weight": 60,
        "planned_quantity": 30,
        "planned_specification": "25 × 12 × 2 mm",
    },
    {
        "serial_no": "ORDER-B",
        "customer_code": "CB",
        "finished_specification": "10×10×2",
        "delivery_date": "2026-11-05",
        "delivery_quantity": 20,
        "planned_weight": 40,
        "planned_quantity": 20,
        "planned_specification": "12 × 12 × 2 mm",
    },
]


def shared_intake(client, setup, **extra):
    return intake(
        client,
        setup,
        **{"serial_no": "", "shared_serials": MEMBERS, "quantity": 1, "weight": 100, **extra},
    )


def trace(client, serial):
    response = client.get("/api/material-trace", params={"serial_no": serial})
    assert response.status_code == 200, response.text
    return response.json()


def test_shared_intake_and_queries_count_one_physical_lot(client, warehouse):
    s = warehouse
    response = shared_intake(client, s)
    assert response.status_code == 201, response.text
    lot = response.json()
    assert lot["shared_unallocated"] and lot["shared_origin_batch_no"] == lot["batch_no"]
    assert lot["shared_serials"] == MEMBERS
    assert shared_intake(client, s).json() == lot
    overview = client.get(base(s) + "/overview").json()
    assert (
        overview["totals"]["on_hand_quantity"] == 1 and overview["totals"]["on_hand_weight"] == 100
    )
    factory = client.get("/api/factory-overview").json()
    assert factory["totals"]["on_hand_weight"] == 100
    assert (
        next(team for team in factory["teams"] if team["code"] == "FACTORY-WAREHOUSE")[
            "serial_count"
        ]
        == 2
    )
    for member in MEMBERS:
        serial = member["serial_no"]
        rows = client.get(base(s) + "/inventory", params={"query": serial}).json()
        assert rows["total"] == 1 and rows["items"][0]["on_hand_weight"] == 100
        assert rows["items"][0]["shared_unallocated"]
        assert rows["items"][0]["shared_serials"] == MEMBERS
        assert client.get(base(s) + "/stock", params={"serial_no": serial}).json()["total"] == 1
        assert (
            client.get("/api/material-transfers", params={"serial_no": serial}).json()["total"] == 1
        )
        path = trace(client, serial)
        assert path["totals"]["on_hand"]["weight"] == 0
        assert path["shared_totals"]["on_hand"]["weight"] == 100
        assert len(path["items"]) == 1


def test_shared_flow_partial_processing_and_later_allocation_preserve_genealogy(client, warehouse):
    s = warehouse
    assert (
        client.patch(f"/api/teams/{s['other']['id']}", json={"code": "FACTORY-WIRE"}).status_code
        == 200
    )
    origin = shared_intake(client, s).json()
    sent = dispatch(client, s, [{"source_transfer_id": origin["id"], "quantity": 1, "weight": 100}])
    assert sent.status_code == 201, sent.text
    assert confirm(client, s, sent.json(), workshop=True).status_code == 200
    lot = sent.json()["items"][0]
    assert lot["shared_serials"] == MEMBERS
    outputs = [
        {"role": "remaining", "quantity": 1, "weight": 40, "material_type": "semi_finished"},
        {
            "role": "produced",
            "serial_no": "ORDER-A",
            "quantity": 30,
            "weight": 55,
            "material_type": "semi_finished",
        },
        {"role": "scrap", "quantity": 0, "weight": 5, "material_type": "scrap_chips"},
    ]
    first = change(client, s, lot, 31, workshop=True, outputs=outputs, processing_status="partial")
    assert first.status_code == 201, first.text
    remaining, produced, waste = first.json()["outputs"]
    assert remaining["shared_unallocated"] and waste["shared_unallocated"]
    assert produced["serial_no"] == "ORDER-A" and not produced["shared_unallocated"]
    detail = client.get("/api/material-transfers/" + produced["batch_no"]).json()
    assert detail["customer_code"] == "CA" and detail["delivery_quantity"] == 30
    assert detail["shared_serials"] == MEMBERS
    assert (
        detail["quantity"] == 30 and detail["weight"] == 55
    )  # Actual output does not overwrite the 60 kg plan.
    second = change(
        client,
        s,
        remaining,
        20,
        workshop=True,
        key="second-split",
        processing_status="complete",
        outputs=[
            {
                "role": "produced",
                "serial_no": "ORDER-B",
                "quantity": 20,
                "weight": 38,
                "material_type": "semi_finished",
            },
            {"role": "scrap", "quantity": 0, "weight": 2, "material_type": "scrap_chips"},
        ],
    )
    assert second.status_code == 201, second.text
    b = second.json()["outputs"][0]
    a_trace, b_trace = trace(client, "ORDER-A"), trace(client, "ORDER-B")
    assert a_trace["totals"]["on_hand"] == {"quantity": 30, "weight": 55}
    assert b_trace["totals"]["on_hand"] == {"quantity": 20, "weight": 38}
    assert a_trace["shared_totals"]["on_hand"]["weight"] == 7
    assert b["id"] not in {item["id"] for item in a_trace["items"]}
    assert produced["id"] not in {item["id"] for item in b_trace["items"]}
    assert {origin["id"], lot["id"], remaining["id"]}.issubset(
        {item["id"] for item in b_trace["items"]}
    )
    all_trace = trace(client, origin["batch_no"])
    assert all_trace["shared_group_view"]
    assert produced["id"] in {item["id"] for item in all_trace["items"]}
    totals = client.get(base(s, True) + "/overview").json()["totals"]
    assert totals["on_hand_weight"] == 100 and totals["received_weight"] == 100
    assert totals["on_hand_quantity"] == 50 and totals["scrap_weight"] == 7
    plans = client.get("/api/factory-dashboard/deliveries").json()
    assert plans["total"] == 2
    import json
    import os
    from pathlib import Path

    if target := os.environ.get("SHARED_MATERIAL_QA_DIR"):
        folder = Path(target)
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "trace.json").write_text(json.dumps(all_trace, ensure_ascii=False))
        (folder / "serial-a.json").write_text(json.dumps(a_trace, ensure_ascii=False))
        (folder / "intake.json").write_text(json.dumps(origin, ensure_ascii=False))


@pytest.mark.parametrize(
    "members",
    [
        [MEMBERS[0]],
        [MEMBERS[0], MEMBERS[0]],
        [{**MEMBERS[0], "delivery_quantity": None}, MEMBERS[1]],
        [{**MEMBERS[0], "planned_weight": None}, MEMBERS[1]],
        [{**MEMBERS[0], "planned_weight": 0}, MEMBERS[1]],
        [{**MEMBERS[0], "planned_quantity": 0}, MEMBERS[1]],
        [{**MEMBERS[0], "planned_specification": "   "}, MEMBERS[1]],
        [
            {key: value for key, value in member.items() if not key.startswith("planned_")}
            for member in MEMBERS
        ],
    ],
)
def test_invalid_shared_members_are_rejected_without_stock(client, warehouse, members):
    response = shared_intake(client, warehouse, shared_serials=members)
    assert response.status_code == 422, response.text
    assert client.get(base(warehouse) + "/stock").json()["total"] == 0


def test_unknown_allocation_rolls_back_every_output(client, warehouse):
    s = warehouse
    client.patch(f"/api/teams/{s['other']['id']}", json={"code": "FACTORY-ROLL"})
    origin = shared_intake(client, s).json()
    sent = dispatch(
        client, s, [{"source_transfer_id": origin["id"], "quantity": 1, "weight": 100}]
    ).json()
    assert confirm(client, s, sent, workshop=True).status_code == 200
    lot = sent["items"][0]
    result = change(
        client,
        s,
        lot,
        20,
        workshop=True,
        processing_status="complete",
        outputs=[
            {
                "role": "produced",
                "serial_no": "ORDER-A",
                "quantity": 10,
                "weight": 50,
                "material_type": "semi_finished",
            },
            {
                "role": "produced",
                "serial_no": "OTHER",
                "quantity": 10,
                "weight": 50,
                "material_type": "semi_finished",
            },
        ],
    )
    assert result.status_code == 422, result.text
    assert client.get(base(s, True) + "/stock").json()["total"] == 1
    assert client.get(base(s, True) + "/overview").json()["totals"]["on_hand_weight"] == 100


def test_shared_allocation_to_inspection_shipping_and_void_keep_single_stock(client, warehouse):
    from test_material_transfers import _leader, _team

    s = warehouse
    client.patch(f"/api/teams/{s['other']['id']}", json={"code": "FACTORY-ENGRAVE"})
    inspection = _team(client, "FACTORY-INSPECT", "检验")
    # The official inspection code is used by outbound authorization.
    from app.team_constants import INSPECTION_TEAM_CODE

    client.patch(f"/api/teams/{inspection['id']}", json={"code": INSPECTION_TEAM_CODE})
    _, headers = _leader(client, "shared-inspection", inspection["id"])
    origin = shared_intake(client, s).json()
    sent = dispatch(
        client, s, [{"source_transfer_id": origin["id"], "quantity": 1, "weight": 100}]
    ).json()
    cancelled = client.delete(
        "/api/material-transfers/" + sent["items"][0]["batch_no"], headers=s["headers"]
    )
    assert cancelled.status_code == 204
    assert trace(client, "ORDER-A")["shared_totals"]["on_hand"]["weight"] == 100
    sent = dispatch(
        client,
        s,
        [{"source_transfer_id": origin["id"], "quantity": 1, "weight": 100}],
        idempotency_key="send-again",
    ).json()
    assert confirm(client, s, sent, workshop=True).status_code == 200
    processed = change(
        client,
        s,
        sent["items"][0],
        50,
        workshop=True,
        processing_status="complete",
        outputs=[
            {
                "role": "produced",
                "serial_no": "ORDER-A",
                "quantity": 30,
                "weight": 60.5,
                "material_type": "finished",
            },
            {
                "role": "produced",
                "serial_no": "ORDER-B",
                "quantity": 20,
                "weight": 39.9,
                "material_type": "finished",
            },
        ],
    )
    assert processed.status_code == 201, processed.text
    a = processed.json()["outputs"][0]
    to_inspection = dispatch(
        client,
        s,
        [{"source_transfer_id": a["id"], "quantity": 30, "weight": 60.5}],
        workshop=True,
        next_team_id=inspection["id"],
    ).json()["items"][0]
    assert to_inspection["shared_group_id"] == origin["shared_group_id"]
    assert (
        receipt_post(
            client,
            "/api/material-transfers/" + to_inspection["batch_no"] + "/confirm",
            headers=headers,
            json={"idempotency_key": "sign-a"},
        ).status_code
        == 200
    )
    payload = {
        "entry_kind": "inspection_shipment",
        "external_destination": "客户A",
        "idempotency_key": "ship-shared-a",
        "lines": [{"source_transfer_id": to_inspection["id"], "quantity": 30, "weight": 60.5}],
    }
    url = f"/api/team-materials/{inspection['id']}/dispatches"
    shipped = sender_post(client, url, headers=headers, json=payload)
    assert shipped.status_code == 201, shipped.text
    assert sender_post(client, url, headers=headers, json=payload).json() == shipped.json()
    final = trace(client, "ORDER-A")
    assert final["totals"]["on_hand"]["weight"] == 0
    assert final["totals"]["dispatched"] == {"quantity": 30, "weight": 60.5}
    assert trace(client, "ORDER-B")["totals"]["on_hand"]["weight"] == 39.9
    assert origin["id"] in {row["id"] for row in final["items"]}
    assert any(row["other_processing_outputs"] for row in final["items"])
    plans = client.get("/api/factory-dashboard/deliveries").json()["items"]
    assert next(row for row in plans if row["serial_no"] == "ORDER-A")["shipped"] == 30
    assert next(row for row in plans if row["serial_no"] == "ORDER-B")["shipped"] == 0
    yields = client.get("/api/factory-dashboard/yields").json()["items"]
    assert {row["serial_no"] for row in yields} == {"ORDER-A", "ORDER-B"}
    a_yield = next(row for row in yields if row["serial_no"] == "ORDER-A")
    assert a_yield["input_weight"] == a_yield["shared_allocated_weight"] == 60.5
    assert a_yield["reallocated_in_weight"] == 0
    assert a_yield["status"] == "complete" and a_yield["rate"] == 100


def test_legacy_shared_receipt_retry_still_replays_without_a_plan(client, warehouse):
    import hashlib
    import json

    from app.database import SessionLocal
    from app.material_transfer_workflow import _creation_fingerprint
    from app.models import MaterialTransfer, SharedMaterialMember
    from app.schemas import WarehouseReceiptCreate
    from sqlalchemy import select

    created = shared_intake(client, warehouse).json()
    members = [
        {key: value for key, value in member.items() if not key.startswith("planned_")}
        for member in MEMBERS
    ]
    body = {
        "serial_no": "",
        "material_name": "铜钼",
        "material_type": "semi_finished",
        "quantity": 1,
        "weight": 100,
        "notes": "外部来料，实物清点后手工入库",
        "source_batch_no": "RAW-001",
        "idempotency_key": "warehouse-intake-1",
        "shared_serials": members,
    }
    payload = WarehouseReceiptCreate.model_validate(body)
    legacy_hash = _creation_fingerprint(payload)
    # Compare with the pre-plan canonical request, including its original default fields.
    value = payload.model_dump(mode="json", exclude={"idempotency_key"})
    from app.material_transfer_workflow import DOCUMENT_FIELDS, SLUDGE_FIELDS

    for field in (
        "receipt_kind",
        "external_source",
        "return_dispatch_no",
        "purpose_id",
        "warehouse_location",
        "warehouse_location_reservation_key",
    ):
        if field not in payload.model_fields_set:
            value.pop(field, None)
    for field in (*DOCUMENT_FIELDS, *SLUDGE_FIELDS):
        if value.get(field) is None:
            value.pop(field, None)
    value["shared_serials"] = members
    assert (
        legacy_hash
        == hashlib.sha256(
            json.dumps(value, sort_keys=True, ensure_ascii=False).encode()
        ).hexdigest()
    )
    with SessionLocal.begin() as db:
        lot = db.get(MaterialTransfer, created["id"])
        lot.request_hash = legacy_hash
        for member in db.scalars(
            select(SharedMaterialMember).where(SharedMaterialMember.group_id == lot.shared_group_id)
        ):
            member.planned_weight = member.planned_quantity = member.planned_specification = None
    replay = shared_intake(client, warehouse, shared_serials=members)
    assert replay.status_code == 201, replay.text
    assert replay.json()["id"] == created["id"]
    assert all(member["planned_weight"] is None for member in replay.json()["shared_serials"])
    assert client.get(base(warehouse) + "/stock").json()["total"] == 1
