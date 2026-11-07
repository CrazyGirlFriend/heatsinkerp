"""Team overview must reconcile with physical stock, not historical throughput."""

from datetime import datetime

from app.database import SessionLocal
from app.models import MaterialTransfer, SharedMaterialGroup, SharedMaterialMember
from test_inventory_processing_groups import classified_lots as classified_lots
from test_inventory_processing_groups import get
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401


def overview(client, team_id):
    return get(client, f"/api/team-materials/{team_id}/overview", include_summary=True)


def test_states_match_filtered_inventory_and_do_not_count_one_serial_five_times(
    client, classified_lots
):
    team_id, _ = classified_lots
    summary = overview(client, team_id)["current_stock"]
    assert summary["serial_count"] == 1
    assert summary["unnumbered_batch_count"] == 0
    assert {row["state"]: row["quantity"] for row in summary["processing"]} == {
        "complete": 60,
        "partial": 20,
        "unregistered": 40,
        "registered": 5,
    }
    for row in summary["processing"]:
        inventory = get(
            client,
            f"/api/team-materials/{team_id}/inventory",
            availability="current",
            processing_state=row["state"],
        )
        assert sum(item["on_hand_quantity"] for item in inventory["items"]) == row["quantity"]
        assert sum(item["on_hand_weight"] for item in inventory["items"]) == row["weight"]


def test_pending_outbound_leaves_source_and_is_not_stock_at_destination(
    client, classified_lots, warehouse
):
    team_id, ids = classified_lots
    with SessionLocal() as db:
        source = db.get(MaterialTransfer, min(ids["complete"]))
        db.add(
            MaterialTransfer(
                batch_no="DASHBOARD-OUT",
                serial_no=source.serial_no,
                entry_kind="transfer",
                source_transfer_id=source.id,
                source_team_id=team_id,
                source_team_code=source.next_team_code,
                source_team_name=source.next_team_name,
                next_team_id=warehouse["team"]["id"],
                next_team_code="FACTORY-WAREHOUSE",
                next_team_name="库房",
                quantity=10,
                weight=10,
                status="pending",
                created_by="test",
            )
        )
        db.commit()
    result = overview(client, team_id)
    assert result["totals"]["on_hand_quantity"] == 115
    assert (
        next(
            row["quantity"]
            for row in result["current_stock"]["processing"]
            if row["state"] == "complete"
        )
        == 50
    )
    destination = overview(client, warehouse["team"]["id"])
    assert destination["current_stock"] == {
        "serial_count": 0,
        "unnumbered_batch_count": 0,
        "processing": [],
    }
    assert destination["pending_incoming"]["quantity"] == 10


def test_shared_serials_are_deduplicated_without_multiplying_physical_quantity(client, warehouse):
    team = warehouse["other"]
    with SessionLocal() as db:
        group = SharedMaterialGroup(batch_no="DASHBOARD-SHARED")
        db.add(group)
        db.flush()
        db.add_all(
            [
                SharedMaterialMember(group_id=group.id, serial_no=serial)
                for serial in ("691236-51", "691236-52")
            ]
        )
        for index, (serial, quantity, shared, kind) in enumerate(
            [
                ("共投", 10, True, "semi_finished"),
                ("691236-51", 20, False, "semi_finished"),
                ("", 5, False, "semi_finished"),
                ("EMPTY-LOT", 1, False, "semi_finished"),
                ("691236-52", 0, False, "scrap_chips"),
            ]
        ):
            db.add(
                MaterialTransfer(
                    batch_no=f"DASHBOARD-{index}",
                    serial_no=serial,
                    next_team_id=team["id"],
                    next_team_code=team["code"],
                    next_team_name=team["name"],
                    entry_kind="opening_stock",
                    status="received",
                    stock_tracked=True,
                    material_type=kind,
                    material_name="铜钼",
                    transfer_specification="20×10",
                    shared_group_id=group.id if shared else None,
                    shared_unallocated=shared,
                    quantity=quantity,
                    weight=quantity if kind == "semi_finished" else 2,
                    received_at=datetime(2026, 11, 1),
                    created_by="test",
                )
            )
        db.flush()
        empty_lot = db.query(MaterialTransfer).filter_by(batch_no="DASHBOARD-3").one()
        db.add(
            MaterialTransfer(
                batch_no="DASHBOARD-EMPTY-OUT",
                serial_no="EMPTY-LOT",
                entry_kind="transfer",
                source_transfer_id=empty_lot.id,
                source_team_id=team["id"],
                source_team_code=team["code"],
                source_team_name=team["name"],
                next_team_id=warehouse["team"]["id"],
                next_team_code="FACTORY-WAREHOUSE",
                next_team_name="库房",
                quantity=1,
                weight=1,
                status="pending",
                created_by="test",
            )
        )
        db.commit()
    result = overview(client, team["id"])
    assert result["current_stock"]["serial_count"] == 2
    assert result["current_stock"]["unnumbered_batch_count"] == 1
    states = {row["state"]: row for row in result["current_stock"]["processing"]}
    assert states["unregistered"]["quantity"] == 35
    assert states["unregistered"]["batch_count"] == 3
    assert states["not_applicable"]["weight"] == 2
    assert result["totals"]["on_hand_weight"] == 37


def test_warehouse_stock_is_not_classified_as_unprocessed(client, warehouse):
    team = warehouse["team"]
    with SessionLocal() as db:
        db.add(
            MaterialTransfer(
                batch_no="DASHBOARD-WAREHOUSE",
                serial_no="691236-51",
                next_team_id=team["id"],
                next_team_code=team["code"],
                next_team_name=team["name"],
                entry_kind="opening_stock",
                status="received",
                stock_tracked=True,
                material_type="semi_finished",
                quantity=100,
                weight=10,
                received_at=datetime(2026, 11, 1),
                created_by="test",
            )
        )
        db.commit()
    assert overview(client, team["id"])["current_stock"]["processing"] == [
        {"state": "not_required", "quantity": 100, "weight": 10, "batch_count": 1},
    ]
