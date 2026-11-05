"""The factory inventory shares team grouping and filters before pagination."""

from datetime import datetime, timedelta
from decimal import Decimal

from app.database import SessionLocal
from app.models import (
    MaterialStockBalance,
    MaterialTransfer,
    SharedMaterialGroup,
    SharedMaterialMember,
)
from test_material_stock import stock_setup as stock_setup  # noqa: F401

NOW = datetime(2026, 11, 5, 12)


def add_lot(db, team, serial, *, days=0, quantity=10, spec="20×10", **extra):
    lot = MaterialTransfer(
        batch_no=f"ALL-{team['id']}-{serial}-{days}-{spec}",
        serial_no=serial,
        next_team_id=team["id"],
        next_team_code=team["code"],
        next_team_name=team["name"],
        entry_kind="opening_stock",
        status="received",
        stock_tracked=True,
        material_type="semi_finished",
        material_name="铜钼",
        transfer_specification=spec,
        quantity=quantity,
        weight=Decimal(quantity) / 10,
        received_at=NOW - timedelta(days=days) if days is not None else None,
        created_by="test",
        **extra,
    )
    db.add(lot)
    db.flush()
    return lot


def stock(client, **params):
    response = client.get("/api/serial-inventory/stock", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_all_teams_match_team_inventory_and_preserve_source_groups(
    client, stock_setup, monkeypatch
):
    monkeypatch.setattr("app.warehouse_inventory.utcnow", lambda: NOW)
    teams = [stock_setup["target"], stock_setup["third"]]
    with SessionLocal() as db:
        for team in teams:
            add_lot(db, team, "000012", days=5, quantity=20)
            add_lot(db, team, "000012", days=1, quantity=3)
            add_lot(db, team, "000012", days=2, quantity=4, spec="30×10")
        db.commit()
    result = stock(client)
    assert result["total"] == 4
    assert {row["team_id"] for row in result["items"]} == {t["id"] for t in teams}
    for team in teams:
        local = client.get(
            f"/api/team-materials/{team['id']}/inventory", params={"availability": "owned"}
        ).json()
        expected = {r["group_id"]: r for r in local["items"]}
        for row in (r for r in result["items"] if r["team_id"] == team["id"]):
            original = expected[row["group_id"]]
            for field in (
                "serial_no",
                "owned_quantity",
                "owned_weight",
                "available_quantity",
                "transfer_specification",
                "processing_unregistered_batch_count",
                "batch_count",
            ):
                assert row[field] == original[field]
            assert row["team_name"] == team["name"]
            if row["transfer_specification"] == "20×10":
                assert row["owned_quantity"] == 23
                assert row["stock_age_hours"] == 120
            detail = client.get(
                f"/api/team-materials/{team['id']}/inventory/{row['group_id']}/sources"
            )
            assert detail.status_code == 200
            assert detail.json()["total"] == row["batch_count"]
    assert stock(client, team_id=teams[0]["id"])["total"] == 2
    assert stock(client, serial_no="12")["total"] == 0
    assert stock(client, query="000012")["total"] == 4
    assert stock(client, material_name="铝")["total"] == 0


def test_residence_range_is_applied_before_count_and_pagination(client, stock_setup, monkeypatch):
    monkeypatch.setattr("app.warehouse_inventory.utcnow", lambda: NOW)
    with SessionLocal() as db:
        for serial, age in [("NEW", 0.25), ("MIN", 3), ("MAX", 7), ("OLD", 9), ("UNKNOWN", None)]:
            add_lot(db, stock_setup["target"], serial, days=age)
        db.commit()
    first = stock(client, stock_age_min=3, stock_age_max=7, page_size=1)
    second = stock(client, stock_age_min=3, stock_age_max=7, page_size=1, page=2)
    assert first["total"] == second["total"] == 2
    assert {first["items"][0]["serial_no"], second["items"][0]["serial_no"]} == {"MIN", "MAX"}
    assert stock(client, stock_age_min=0, stock_age_max=0.5)["items"][0]["serial_no"] == "NEW"
    unknown = stock(client, serial_no="UNKNOWN")["items"][0]
    assert unknown["stock_age_hours"] is None
    for params in (
        {"stock_age_min": -1},
        {"stock_age_min": 9, "stock_age_max": 3},
        {"page_size": 101},
        {"stock_age_max": "nan"},
    ):
        assert client.get("/api/serial-inventory/stock", params=params).status_code == 422


def test_cleared_lots_do_not_inflate_residence_and_shared_stock_is_not_duplicated(
    client, stock_setup, monkeypatch
):
    monkeypatch.setattr("app.warehouse_inventory.utcnow", lambda: NOW)
    with SessionLocal() as db:
        old = add_lot(db, stock_setup["target"], "MIXED", days=30)
        add_lot(db, stock_setup["target"], "MIXED", days=1)
        db.flush()
        balance = db.get(MaterialStockBalance, old.id)
        balance.lost_quantity = balance.received_quantity
        balance.lost_weight = balance.received_weight
        balance.on_hand_quantity = 0
        balance.on_hand_weight = 0
        group = SharedMaterialGroup(batch_no="SHARED-ALL")
        db.add(group)
        db.flush()
        for serial in ("ORDER-A", "ORDER-B"):
            db.add(SharedMaterialMember(group_id=group.id, serial_no=serial))
        add_lot(
            db,
            stock_setup["target"],
            "",
            days=2,
            quantity=1,
            shared_group_id=group.id,
            shared_unallocated=True,
        )
        db.commit()
    result = stock(client)
    assert result["total"] == 2
    assert next(r for r in result["items"] if r["serial_no"] == "MIXED")["stock_age_hours"] == 24
    assert stock(client, stock_age_min=7)["total"] == 0
    for serial in ("ORDER-A", "ORDER-B"):
        shared = stock(client, serial_no=serial)["items"]
        assert len(shared) == 1 and shared[0]["shared_unallocated"]
        assert shared[0]["owned_quantity"] == 1
        assert stock(client, query=serial)["total"] == 1


def test_factory_stock_requires_admin(client, stock_setup):
    assert (
        client.get("/api/serial-inventory/stock", headers={"Authorization": ""}).status_code == 401
    )
    assert (
        client.get("/api/serial-inventory/stock", headers=stock_setup["target_headers"]).status_code
        == 403
    )
