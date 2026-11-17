"""A 1 kg allowance applies to each source lot, never each outbound submission."""

from decimal import Decimal

import pytest
from app.database import SessionLocal
from app.models import MaterialStockBalance
from sqlalchemy import select
from test_warehouse_classification import dispatch
from test_warehouse_receipts import intake
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

pytestmark = pytest.mark.usefixtures("legacy_stock")


def ship(client, setup, source, weight, *, quantity=1, key="ship"):
    response = dispatch(
        client,
        setup,
        [{"source_transfer_id": source["id"], "quantity": quantity, "weight": str(weight)}],
        next_team_id=None,
        entry_kind="warehouse_outbound",
        external_destination="对外转料",
        idempotency_key=key,
    )
    assert response.status_code == 201, response.text
    assert response.json()["items"][0]["status"] == "dispatched"


def trace(client, serial):
    response = client.get("/api/material-trace", params={"serial_no": serial})
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize("difference", [".000001", ".6", "1", "1.000001"])
def test_per_batch_allowance_boundary_preserves_actual_weights_and_does_not_create_loss(
    client, warehouse, difference
):
    source = intake(
        client, warehouse, serial_no="TOL-001", material_type="finished", quantity=1, weight=10
    ).json()
    delta = Decimal(difference)
    ship(client, warehouse, source, Decimal(10) + delta)
    row = trace(client, source["serial_no"])
    assert row["max_weight_difference"] == float(delta)
    assert row["totals"]["dispatched"]["weight"] == float(Decimal(10) + delta)
    assert row["totals"]["lost"]["weight"] == 0
    with SessionLocal() as db:
        balance = db.get(MaterialStockBalance, source["id"])
        assert balance.on_hand_weight == -delta and balance.lost_weight == 0


def test_separate_batches_do_not_share_one_factory_allowance(client, warehouse):
    for index in range(2):
        source = intake(
            client,
            warehouse,
            serial_no="TOL-MULTI",
            material_type="finished",
            quantity=1,
            weight=10,
            idempotency_key=f"receipt-{index}",
        ).json()
        ship(client, warehouse, source, "10.6", key=f"ship-{index}")
    row = trace(client, "TOL-MULTI")
    assert row["weight_difference"] == 1.2 and row["max_weight_difference"] == 0.6
    assert row["totals"]["dispatched"]["weight"] == 21.2
    assert row["totals"]["lost"]["weight"] == 0


def test_repeated_outbounds_accumulate_against_the_same_source_batch(client, warehouse):
    source = intake(
        client, warehouse, serial_no="TOL-REPEAT", material_type="finished", quantity=1, weight=10
    ).json()
    ship(client, warehouse, source, "5.6", quantity=0, key="first")
    ship(client, warehouse, source, "5.6", key="second")
    row = trace(client, source["serial_no"])
    assert row["weight_difference"] == row["max_weight_difference"] == 1.2
    with SessionLocal() as db:
        assert db.scalar(
            select(MaterialStockBalance.on_hand_weight).where(
                MaterialStockBalance.transfer_id == source["id"]
            )
        ) == Decimal("-1.2")


def test_allowed_negative_balance_cannot_hide_another_batch_still_in_stock(client, warehouse):
    source = intake(
        client, warehouse, serial_no="TOL-OPEN", material_type="finished", quantity=1, weight=10
    ).json()
    intake(
        client,
        warehouse,
        serial_no="TOL-OPEN",
        material_type="finished",
        quantity=0,
        weight=".6",
        idempotency_key="leftover",
    )
    ship(client, warehouse, source, "10.6")
    row = trace(client, source["serial_no"])
    assert row["totals"]["on_hand"]["weight"] == 0
    assert row["max_weight_difference"] == 0.6
    remaining = [item for item in row["items"] if (item["on_hand_weight"] or 0) > 0]
    assert len(remaining) == 1 and remaining[0]["on_hand_weight"] == 0.6
