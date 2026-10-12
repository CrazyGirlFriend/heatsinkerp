"""Internal processing changes stock identity, never a receipt or business handoff."""

from decimal import Decimal

import pytest
from test_processing_records import receive
from test_quantity_adjustments import change
from test_warehouse_classification import base, confirm, dispatch
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401


@pytest.fixture
def machining(client, warehouse):  # noqa: F811
    response = client.patch(
        f"/api/teams/{warehouse['other']['id']}", json={"code": "FACTORY-WIRE", "name": "线切割"}
    )
    assert response.status_code == 200, response.text
    return {**warehouse, "other": response.json()}


def output(role, quantity, weight, specification, material_type="semi_finished"):
    return {
        "role": role,
        "quantity": quantity,
        "weight": weight,
        "material_type": material_type,
        "transfer_specification": specification,
    }


def process(client, setup, lot, outputs, **extra):
    response = change(
        client,
        setup,
        lot,
        sum(row["quantity"] for row in outputs),
        workshop=True,
        processing_status="partial"
        if any(row["role"] == "remaining" for row in outputs)
        else "complete",
        outputs=outputs,
        **extra,
    )
    assert response.status_code == 201, response.text
    return response.json()


def get(client, url, **params):
    response = client.get(url, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_processing_stock_classifications_and_statistics_do_not_duplicate_intake(client, machining):
    from app.database import SessionLocal
    from app.models import MaterialStockBalance

    setup = machining
    lot = receive(client, setup, delivery_date="2030-01-01", delivery_quantity=10)
    url = base(setup, True)
    record = process(
        client,
        setup,
        lot,
        [
            output("remaining", 1, 60, "100×100×10"),
            output("produced", 8, 32, "20×20×10"),
            output("produced", 2, 6, "10×10×10"),
            output("scrap", 0, 1.5, "切割废屑", "scrap_chips"),
        ],
    )
    generated = {item["id"] for item in record["outputs"]}
    with SessionLocal() as db:
        balance = db.get(MaterialStockBalance, lot["id"])
        assert balance.converted_quantity == 11
        assert balance.converted_weight == Decimal("99.5")
    inventory = get(client, url + "/inventory")["items"]
    assert len(inventory) == 4
    assert {
        (row["processing_role"], row["transfer_specification"], row["material_type"])
        for row in inventory
    } == {
        ("remaining", "100×100×10", "semi_finished"),
        ("produced", "20×20×10", "semi_finished"),
        ("produced", "10×10×10", "semi_finished"),
        ("scrap", "切割废屑", "scrap_chips"),
    }
    assert all(row["receipt_source"] == "processing" for row in inventory)
    assert get(client, url + "/inventory", receipt_source="processing")["total"] == 4
    sources = get(client, url + "/processing-stock")["items"]
    assert len(sources) == 3
    assert {row["transfer"]["processing_role"]: row["processing_state"] for row in sources} == {
        "remaining": "partial",
        "produced": "complete",
    }
    for source in sources:
        context = get(client, f"{url}/stock/{source['transfer']['id']}/quantity-adjustments")
        assert context["processing_status"] == source["processing_state"]
        assert context["origin_processing_record"]["id"] == record["id"]
        assert context["total"] == 0 and context["items"] == []
    current = get(client, url + "/processing-records")["items"][0]
    assert (
        current["on_hand_quantity"],
        current["on_hand_weight"],
        current["processing_state"],
    ) == (11, 99.5, "partial")
    assert sum(row["on_hand_weight"] for row in current["outputs"]) == 99.5
    assert get(client, url + "/receipts")["total"] == 1
    assert not generated.intersection(
        row["id"] for row in get(client, "/api/material-transfers")["items"]
    )
    movements = get(client, f"{url}/inventory/{lot['id']}/movements")["items"]
    assert [row["id"] for row in movements] == [lot["id"]]
    analytics = get(client, url + "/analytics")
    assert sum(day["incoming"]["quantity"] for day in analytics["trend"]) == 1
    assert sum(day["incoming"]["weight"] for day in analytics["trend"]) == 100
    assert sum(day["outgoing"]["weight"] + day["loss"]["weight"] for day in analytics["trend"]) == 0
    history = get(client, url + "/serial-history", serial_no=lot["serial_no"])
    group = history["groups"][0]
    assert (
        group["incoming_quantity"],
        group["incoming_weight"],
        group["outgoing_weight"],
        group["lost_weight"],
    ) == (1, 100, 0, 0)
    assert group["processing_delta_weight"] == -0.5
    assert group["events"][-1]["balance_quantity"] == 11
    assert group["events"][-1]["balance_weight"] == 99.5
    assert len(history["flows"]) == 1
    for row in history["lots"]:
        assert row["closing_quantity"] == row["on_hand_quantity"]
        assert row["closing_weight"] == row["on_hand_weight"]
    overview = get(client, "/api/factory-overview")
    assert all(row["entry_kind"] != "processing_output" for row in overview["recent_batches"])
    assert overview["period_totals"]["inbound"]["weight"] == 100
    assert overview["period_totals"]["internal"]["weight"] == 100
    yielded = get(client, "/api/factory-dashboard/yields")["items"][0]
    assert {
        key: yielded[key]
        for key in (
            "input_weight",
            "output_weight",
            "lost_weight",
            "current_weight",
            "processing_delta_weight",
        )
    } == {
        "input_weight": 100,
        "output_weight": 0,
        "lost_weight": 0,
        "current_weight": 99.5,
        "processing_delta_weight": -0.5,
    }
    detail = get(client, "/api/factory-dashboard/stock-detail", team_id=setup["other"]["id"])
    assert detail["total"] == 4
    assert get(client, "/api/factory-dashboard/deliveries")["total"] == 1


def test_remaining_and_produced_with_identical_dimensions_stay_separate_through_reprocessing(
    client, machining
):
    from datetime import datetime

    from app.database import SessionLocal
    from app.models import MaterialTransfer, MaterialTransferEvent
    from sqlalchemy import select, update

    setup = machining
    lot = receive(client, setup)
    url = base(setup, True)
    first = process(
        client,
        setup,
        lot,
        [output("remaining", 1, 60, "同尺寸"), output("produced", 8, 40, "同尺寸")],
    )
    assert get(client, url + "/inventory")["total"] == 2
    remainder = first["outputs"][0]
    second = process(
        client,
        setup,
        remainder,
        [output("produced", 10, 58, "10×10"), output("scrap", 0, 2, "废屑", "scrap_chips")],
        key="remaining-processing",
    )
    sent = dispatch(
        client,
        setup,
        [{"source_transfer_id": second["outputs"][0]["id"], "quantity": 3, "weight": 17.4}],
        workshop=True,
    )
    assert sent.status_code == 201, sent.text
    records = get(client, url + "/processing-records")["items"]
    original = next(row for row in records if row["id"] == first["id"])
    assert original["outputs"][0]["quantity"] == 1  # The audited snapshot remains immutable.
    assert original["outputs"][0]["on_hand_quantity"] == 7
    assert original["outputs"][0]["on_hand_weight"] == 42.6
    assert original["on_hand_quantity"] == 15 and original["on_hand_weight"] == 82.6
    assert original["in_transit_quantity"] == 3 and original["processing_state"] == "complete"
    assert confirm(client, setup, sent.json()).status_code == 200
    # MySQL stores these event times at second precision; ordering must still
    # apply the parent's adjustment before its children's internal movements.
    with SessionLocal() as db:
        stamp = datetime(2026, 10, 10, 1, 0, 0)
        serial_lots = select(MaterialTransfer.id).where(
            MaterialTransfer.serial_no == lot["serial_no"]
        )
        db.execute(
            update(MaterialTransferEvent)
            .where(MaterialTransferEvent.transfer_id.in_(serial_lots))
            .values(occurred_at=stamp)
        )
        for row in db.scalars(
            select(MaterialTransfer).where(MaterialTransfer.serial_no == lot["serial_no"])
        ):
            row.created_at = row.received_at = stamp
        db.commit()
    history = get(client, url + "/serial-history", serial_no=lot["serial_no"])
    group = history["groups"][0]
    assert (group["incoming_quantity"], group["outgoing_quantity"], group["on_hand_quantity"]) == (
        1,
        3,
        15,
    )
    assert group["events"][-1]["balance_quantity"] == 15
    assert group["events"][-1]["balance_weight"] == pytest.approx(82.6)
    assert all(
        row["balance_weight"] >= 0 and row["balance_quantity"] >= 0 for row in group["events"]
    )
    assert sum(Decimal(str(row["closing_weight"])) for row in history["lots"]) == Decimal("82.6")
    assert len(history["flows"]) == 2


def test_measured_weight_delta_is_separate_from_input_yield_and_loss(client, machining):
    setup = machining
    lot = receive(client, setup)
    record = process(client, setup, lot, [output("produced", 10, 100.5, "20×20", "finished")])
    sent = dispatch(
        client,
        setup,
        [{"source_transfer_id": record["outputs"][0]["id"], "quantity": 10, "weight": 100.5}],
        workshop=True,
    )
    assert sent.status_code == 201, sent.text
    assert confirm(client, setup, sent.json()).status_code == 200
    child = sent.json()["items"][0]
    shipment = dispatch(
        client,
        setup,
        [{"source_transfer_id": child["id"], "quantity": 10, "weight": 100.5}],
        next_team_id=None,
        entry_kind="warehouse_outbound",
        external_destination="客户",
        idempotency_key="ship-finished",
    )
    assert shipment.status_code == 201, shipment.text
    yielded = get(client, "/api/factory-dashboard/yields")["items"][0]
    assert yielded["status"] == "complete"
    assert yielded["input_weight"] == 100 and yielded["output_weight"] == 100.5
    assert (
        yielded["processing_delta_weight"] == 0.5
        and yielded["lost_weight"] == yielded["current_weight"] == 0
    )
    team = next(
        row
        for row in get(client, "/api/factory-dashboard/team-yields", serial_no=lot["serial_no"])[
            "items"
        ]
        if row["team_id"] == setup["other"]["id"]
    )
    assert team["input_weight"] == 100 and team["output_weight"] == 100.5
    assert team["processing_delta_weight"] == 0.5 and team["status"] == "complete"


@pytest.mark.parametrize("step", [Decimal(".6"), Decimal("-.6")])
def test_repeated_processing_uses_one_signed_weight_difference_for_its_received_root(
    client, machining, step
):
    setup = machining
    lot = receive(client, setup)
    url = base(setup, True)
    first = process(client, setup, lot, [output("produced", 10, str(100 + step), "同尺寸")])
    second = process(
        client,
        setup,
        first["outputs"][0],
        [output("produced", 10, str(100 + 2 * step), "同尺寸")],
        key="second",
    )
    child = second["outputs"][0]
    context = get(client, f"{url}/stock/{child['id']}/quantity-adjustments")
    assert context["weight_root_transfer_id"] == lot["id"]
    assert context["weight_difference"] == float(2 * step)
    source = get(client, url + "/processing-stock")["items"][0]
    assert source["weight_difference"] == float(2 * step)
    inventory = get(client, url + "/inventory")["items"][0]
    assert inventory["weight_difference"] == float(2 * step)
    assert inventory["max_weight_difference"] == 1.2
    group_source = get(client, f"{url}/inventory/{inventory['group_id']}/sources")["items"][0]
    assert group_source["weight_root_transfer_id"] == lot["id"]
    trace = get(client, "/api/material-trace", serial_no=lot["serial_no"])
    assert trace["processing_delta_weight"] == trace["weight_difference"] == float(2 * step)
    assert trace["max_weight_difference"] == 1.2 and trace["shortage"]["weight"] == 0
    assert trace["totals"]["lost"]["weight"] == 0
    assert sum(Decimal(str(item["processing_delta_weight"])) for item in trace["items"]) == 2 * step
    yielded = get(client, "/api/factory-dashboard/yields")["items"][0]
    assert yielded["status"] == "needs_review" and yielded["input_weight"] == 100
    team = next(
        row
        for row in get(client, "/api/factory-dashboard/team-yields", serial_no=lot["serial_no"])[
            "items"
        ]
        if row["team_id"] == setup["other"]["id"]
    )
    assert team["status"] == "needs_review" and team["max_weight_difference"] == 1.2
    # A correction reduces the net difference instead of accumulating absolute
    # measurements or granting a fresh allowance to this newly created lot.
    corrected = process(
        client, setup, child, [output("produced", 10, str(100 + step), "同尺寸")], key="corrected"
    )
    context = get(client, f"{url}/stock/{corrected['outputs'][0]['id']}/quantity-adjustments")
    assert context["weight_difference"] == float(step)
    own = get(client, f"{url}/stock/{child['id']}/quantity-adjustments")
    assert own["items"][0]["id"] == corrected["id"] and own["total"] == 1
    assert own["origin_processing_record"]["id"] == second["id"]
    assert get(client, "/api/factory-dashboard/yields")["items"][0]["status"] == "in_progress"


def test_sibling_processing_outputs_share_root_without_duplicating_group_difference(
    client, machining
):
    setup = machining
    lot = receive(client, setup)
    first = process(
        client,
        setup,
        lot,
        [output("produced", 5, 50, "同尺寸"), output("produced", 5, 50, "同尺寸")],
    )
    for index, child in enumerate(first["outputs"]):
        process(
            client, setup, child, [output("produced", 5, 50.6, "同尺寸")], key=f"sibling-{index}"
        )
    inventory = get(client, base(setup, True) + "/inventory")["items"]
    assert len(inventory) == 1
    assert inventory[0]["weight_difference"] == inventory[0]["max_weight_difference"] == 1.2
    assert inventory[0]["on_hand_weight"] == 101.2
    yielded = get(client, "/api/factory-dashboard/yields")["items"][0]
    assert yielded["input_weight"] == 100 and yielded["status"] == "needs_review"
    trace = get(client, "/api/material-trace", serial_no=lot["serial_no"])
    assert trace["weight_difference"] == trace["max_weight_difference"] == 1.2


def test_processing_and_outbound_overage_accumulate_but_real_receipt_starts_new_root(
    client, machining
):
    setup = machining
    lot = receive(client, setup)
    first = process(client, setup, lot, [output("produced", 10, 100.6, "同尺寸")])
    child = first["outputs"][0]
    sent = dispatch(
        client,
        setup,
        [{"source_transfer_id": child["id"], "quantity": 10, "weight": 101.2}],
        workshop=True,
    )
    assert sent.status_code == 201, sent.text
    context = get(client, f"{base(setup, True)}/stock/{child['id']}/quantity-adjustments")
    assert context["weight_difference"] == 1.2
    assert confirm(client, setup, sent.json()).status_code == 200
    returned = sent.json()["items"][0]
    context = get(client, f"{base(setup)}/stock/{returned['id']}/quantity-adjustments")
    assert (
        context["weight_root_transfer_id"] == returned["id"] and context["weight_difference"] == 0
    )
    trace = get(client, "/api/material-trace", serial_no=lot["serial_no"])
    assert trace["shortage"]["weight"] == 0.6
    assert trace["processing_delta_weight"] == 0.6
    assert trace["weight_difference"] == trace["max_weight_difference"] == 1.2
    assert get(client, "/api/factory-dashboard/yields")["items"][0]["status"] == "needs_review"


def test_processing_record_current_outputs_exclude_earlier_reserved_input(client, machining):
    setup = machining
    lot = receive(client, setup)
    pending = dispatch(
        client,
        setup,
        [{"source_transfer_id": lot["id"], "quantity": 0, "weight": 40}],
        workshop=True,
    )
    assert pending.status_code == 201, pending.text
    record = process(client, setup, lot, [output("produced", 10, 60, "同尺寸")])
    current = get(client, base(setup, True) + "/processing-records")["items"][0]
    assert current["id"] == record["id"] and current["owned_weight"] == 60
    assert current["in_transit_weight"] == 0


def test_measured_gain_then_full_reallocation_has_no_unexplained_negative_input(client, machining):
    from test_serial_reallocations import reallocate

    setup = machining
    lot = receive(client, setup)
    record = process(client, setup, lot, [output("produced", 10, 100.6, "同尺寸")])
    pending = dispatch(
        client,
        setup,
        [{"source_transfer_id": record["outputs"][0]["id"], "quantity": 10, "weight": 100.6}],
        workshop=True,
    )
    assert pending.status_code == 201, pending.text
    assert confirm(client, setup, pending.json()).status_code == 200
    assigned = reallocate(
        client, setup, pending.json()["items"][0], quantity=10, weight=100.6, serial_no="NEW-SERIAL"
    )
    assert assigned.status_code == 201, assigned.text
    original = next(
        row
        for row in get(client, "/api/factory-dashboard/yields")["items"]
        if row["serial_no"] == lot["serial_no"]
    )
    assert original["input_weight"] == -0.6 and original["processing_delta_weight"] == 0.6
    assert original["status"] == "complete" and original["rate"] is None
