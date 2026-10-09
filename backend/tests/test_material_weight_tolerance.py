"""A 1 kg allowance applies to each source lot, never each outbound submission."""

from decimal import Decimal

import pytest
from sqlalchemy import select

from app.database import SessionLocal
from app.models import MaterialStockBalance
from test_warehouse_receipts import warehouse, intake  # noqa: F401
from test_warehouse_classification import dispatch


def ship(client, setup, source, weight, *, quantity=1, key="ship"):
    response = dispatch(
        client,
        setup,
        [{"source_transfer_id": source["id"], "quantity": quantity, "weight": str(weight)}],
        next_team_id=None,
        entry_kind="warehouse_outbound",
        external_destination="客户",
        idempotency_key=key,
    )
    assert response.status_code == 201, response.text
    assert response.json()["items"][0]["status"] == "dispatched"


def statuses(client, setup, serial):
    rows = client.get("/api/factory-dashboard/yields").json()["items"]
    serial_row = next(row for row in rows if row["serial_no"] == serial)
    teams = client.get("/api/factory-dashboard/team-yields", params={"serial_no": serial}).json()[
        "items"
    ]
    return serial_row, next(row for row in teams if row["team_id"] == setup["team"]["id"])


@pytest.mark.parametrize("difference", [".000001", ".6", "1", "1.000001"])
def test_per_batch_allowance_boundary_preserves_actual_yield_and_does_not_create_loss(
    client, warehouse, difference
):
    source = intake(
        client, warehouse, serial_no="TOL-001", material_type="finished", quantity=1, weight=10
    ).json()
    delta = Decimal(difference)
    ship(client, warehouse, source, Decimal(10) + delta)
    for row in statuses(client, warehouse, source["serial_no"]):
        assert row["status"] == ("complete" if delta <= 1 else "needs_review")
        assert row["rate"] == (round(float((Decimal(10) + delta) * 10), 2) if delta <= 1 else None)
        assert row["output_weight"] == float(Decimal(10) + delta)
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
    for row in statuses(client, warehouse, "TOL-MULTI"):
        assert row["status"] == "complete" and row["rate"] == 106
        assert row["input_weight"] == 20 and row["output_weight"] == 21.2


def test_repeated_outbounds_accumulate_against_the_same_source_batch(client, warehouse):
    source = intake(
        client, warehouse, serial_no="TOL-REPEAT", material_type="finished", quantity=1, weight=10
    ).json()
    ship(client, warehouse, source, "5.6", quantity=0, key="first")
    ship(client, warehouse, source, "5.6", key="second")
    for row in statuses(client, warehouse, source["serial_no"]):
        assert row["status"] == "needs_review" and row["rate"] is None
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
    for row in statuses(client, warehouse, source["serial_no"]):
        assert row["status"] == "in_progress" and row["rate"] is None
