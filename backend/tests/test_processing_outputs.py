# ruff: noqa: F811 -- Imported shared pytest fixtures are injected by parameter name.
"""Machining partitions inventory, never another receipt or shipment."""

from decimal import Decimal

from app.database import SessionLocal
from app.models import MaterialQuantityAdjustment, MaterialStockBalance, MaterialTransfer
from sqlalchemy import func, select
from test_processing_records import processing as processing  # noqa: F401
from test_processing_records import receive
from test_quantity_adjustments import change
from test_warehouse_classification import base, confirm, dispatch
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401


def outputs():
    return [
        {
            "role": "remaining",
            "quantity": 1,
            "weight": 40,
            "material_type": "semi_finished",
            "transfer_specification": "100 × 100 × 10 mm",
        },
        {
            "role": "produced",
            "quantity": 20,
            "weight": 55,
            "material_type": "semi_finished",
            "transfer_specification": "20 × 10 × 2 mm",
        },
        {"role": "scrap", "quantity": 0, "weight": 5, "material_type": "scrap_chips"},
    ]


def test_outputs_keep_origin_and_partition_stock_with_atomic_replay(client, processing):
    s = processing
    lot = receive(client, s, delivery_date="2026-11-01", delivery_quantity=50)
    response = change(
        client, s, lot, 21, workshop=True, processing_status="partial", outputs=outputs()
    )
    assert response.status_code == 201, response.text
    data = response.json()
    assert data["weight"] == data["after_weight"] == 100
    assert [row["quantity"] for row in data["outputs"]] == [1, 20, 0]
    assert (
        change(
            client,
            s,
            lot,
            21,
            workshop=True,
            revision=0,
            processing_status="partial",
            outputs=outputs(),
        ).json()
        == data
    )
    with SessionLocal() as db:
        original = db.get(MaterialTransfer, lot["id"])
        assert (original.quantity, original.weight) == (1, 100)
        balance = db.get(MaterialStockBalance, lot["id"])
        assert (balance.on_hand_quantity, balance.on_hand_weight) == (0, 0)
        assert db.scalar(select(func.count()).select_from(MaterialQuantityAdjustment)) == 1
    for output in data["outputs"]:
        child = client.get("/api/material-transfers/" + output["batch_no"]).json()
        assert child["source_transfer_id"] == lot["id"]
        assert (
            child["entry_kind"] == "processing_output"
            and child["processing_role"] == output["role"]
        )
        assert child["delivery_origin_batch_no"] == lot["delivery_origin_batch_no"]
        assert child["delivery_quantity"] == 50 and child["delivery_date"] == "2026-11-01"
        assert child["allowed_actions"] == [] and child["status"] == "received"
        assert (
            client.patch(
                "/api/material-transfers/" + output["batch_no"],
                headers=s["other_headers"],
                json={"quantity": 99},
            ).status_code
            == 409
        )
    url = base(s, True)
    totals = client.get(url + "/overview").json()["totals"]
    assert (
        totals["received_quantity"],
        totals["received_weight"],
        totals["dispatched_quantity"],
        totals["dispatched_weight"],
    ) == (1, 100, 0, 0)
    assert (totals["on_hand_quantity"], totals["on_hand_weight"], totals["scrap_weight"]) == (
        21,
        100,
        5,
    )
    assert client.get(url + "/dispatches").json()["total"] == 0
    assert client.get(url + "/outbound-batches").json()["total"] == 0
    assert client.get(url + "/receipts").json()["total"] == 1
    selectable = client.get(url + "/stock", params={"availability": "dispatchable"}).json()["items"]
    assert lot["id"] not in {row["transfer"]["id"] for row in selectable}
    assert (
        dispatch(
            client,
            s,
            [{"source_transfer_id": lot["id"], "quantity": 1, "weight": 1}],
            workshop=True,
        ).status_code
        == 409
    )
    produced = data["outputs"][1]
    sent = dispatch(
        client,
        s,
        [{"source_transfer_id": produced["id"], "quantity": 8, "weight": 22}],
        workshop=True,
    )
    assert sent.status_code == 201, sent.text
    assert sent.json()["items"][0]["transfer_specification"] == produced["transfer_specification"]
    assert confirm(client, s, sent.json()).status_code == 200
    stock = client.get(url + "/stock", params={"source_ids": str(produced["id"])}).json()["items"][
        0
    ]
    assert stock["on_hand_quantity"] == 12 and stock["on_hand_weight"] == 33
    assert stock["current_specification"] == produced["transfer_specification"]


def test_pending_before_processing_can_be_voided_and_remaining_child_processed_again(
    client, processing
):
    s = processing
    lot = receive(client, s)
    prior = dispatch(
        client, s, [{"source_transfer_id": lot["id"], "quantity": 0, "weight": 20}], workshop=True
    ).json()["items"][0]
    lines = outputs()
    lines[0]["weight"] = 20
    result = change(client, s, lot, 21, workshop=True, processing_status="partial", outputs=lines)
    assert result.status_code == 201, result.text
    assert (
        client.delete(
            "/api/material-transfers/" + prior["batch_no"], headers=s["other_headers"]
        ).status_code
        == 204
    )
    remaining = result.json()["outputs"][0]
    second = change(
        client,
        s,
        remaining,
        10,
        workshop=True,
        key="second-processing",
        processing_status="complete",
        outputs=[
            {
                "role": "produced",
                "quantity": 10,
                "weight": 20,
                "material_type": "semi_finished",
                "transfer_specification": "10 × 10 × 2 mm",
            }
        ],
    )
    assert second.status_code == 201, second.text
    with SessionLocal() as db:
        parent = db.get(MaterialStockBalance, lot["id"])
        assert parent.on_hand_quantity == 0 and parent.on_hand_weight == 20
        assert db.get(MaterialStockBalance, remaining["id"]).on_hand_weight == 0
    trace = client.get("/api/material-trace", params={"serial_no": lot["serial_no"]}).json()
    by_id = {row["id"]: row for row in trace["items"]}
    new_id = second.json()["outputs"][0]["id"]
    assert by_id[new_id]["source_transfer_id"] == remaining["id"]
    assert by_id[remaining["id"]]["source_transfer_id"] == lot["id"]
    assert trace["totals"]["on_hand"] == {"quantity": 30, "weight": 100}


def test_measured_weight_delta_does_not_change_receipt_or_invent_loss(client, processing):
    s = processing
    lot = receive(client, s)
    lines = outputs()
    lines[1]["weight"] = 55.6
    result = change(client, s, lot, 21, workshop=True, processing_status="partial", outputs=lines)
    assert result.status_code == 201, result.text
    with SessionLocal() as db:
        balance = db.get(MaterialStockBalance, lot["id"])
        assert balance.adjusted_weight == Decimal(".6")
        assert balance.on_hand_weight == balance.lost_weight == 0
        assert balance.received_weight == 100
    totals = client.get(base(s, True) + "/overview").json()["totals"]
    assert (
        totals["on_hand_weight"] == 100.6
        and totals["received_weight"] == 100
        and totals["lost_weight"] == 0
    )
    audit = client.get("/api/material-transfers/" + lot["batch_no"]).json()["history"][-1]
    assert audit["changes"]["stock_weight"] == {"before": 100, "after": 100.6}


def test_invalid_outputs_are_atomic_and_cannot_bypass_team_or_inline_permissions(
    client, processing
):
    s = processing
    lot = receive(client, s)
    invalid = outputs()
    invalid[2] = {"role": "scrap", "quantity": 0, "weight": 5, "material_type": "sludge"}
    assert (
        change(
            client, s, lot, 21, workshop=True, processing_status="partial", outputs=invalid
        ).status_code
        == 422
    )
    assert (
        change(
            client, s, lot, 22, workshop=True, processing_status="partial", outputs=outputs()
        ).status_code
        == 422
    )
    assert (
        change(
            client, s, lot, 21, workshop=True, processing_status="complete", outputs=outputs()
        ).status_code
        == 422
    )
    assert change(client, s, lot, 21, workshop=True, outputs=outputs()).status_code == 422
    assert (
        change(
            client, s, lot, 21, revision=0, processing_status="partial", outputs=outputs()
        ).status_code
        == 403
    )
    assert (
        dispatch(
            client,
            s,
            [{"source_transfer_id": lot["id"], "quantity": 1, "weight": 1}],
            workshop=True,
            quantity_adjustments=[
                {
                    "source_transfer_id": lot["id"],
                    "expected_revision": 0,
                    "processor_name": "张师傅",
                    "quantity": 21,
                    "processing_status": "partial",
                    "outputs": outputs(),
                }
            ],
        ).status_code
        == 422
    )
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(MaterialQuantityAdjustment)) == 0
        assert (
            db.scalar(
                select(func.count())
                .select_from(MaterialTransfer)
                .where(MaterialTransfer.entry_kind == "processing_output")
            )
            == 0
        )
        assert db.get(MaterialStockBalance, lot["id"]).on_hand_weight == 100


def test_legacy_unknown_material_nature_can_be_classified_without_changing_receipt(
    client, processing
):
    lot = receive(client, processing)
    with SessionLocal() as db:
        db.get(MaterialTransfer, lot["id"]).material_type = None
        db.commit()
    result = change(
        client, processing, lot, 21, workshop=True, processing_status="partial", outputs=outputs()
    )
    assert result.status_code == 201, result.text
    assert result.json()["outputs"][0]["material_type"] == "semi_finished"
    with SessionLocal() as db:
        assert db.get(MaterialTransfer, lot["id"]).material_type is None
