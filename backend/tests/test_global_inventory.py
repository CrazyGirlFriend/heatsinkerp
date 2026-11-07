"""The factory inventory shares team grouping and filters before pagination."""

from datetime import datetime, timedelta
from decimal import Decimal

import pytest
from app.database import SessionLocal
from app.models import (
    MaterialStockBalance,
    MaterialTransfer,
    SharedMaterialGroup,
    SharedMaterialMember,
)
from test_material_stock import stock_setup as stock_setup  # noqa: F401
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

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


def test_property_filters_apply_to_balances_before_pagination(client, stock_setup, monkeypatch):
    monkeypatch.setattr("app.warehouse_inventory.utcnow", lambda: NOW)
    with SessionLocal() as db:
        add_lot(
            db,
            stock_setup["target"],
            "MATCH",
            days=5,
            quantity=24,
            customer_code="C001",
            product_code="P001",
            source_batch_no="SOURCE-12",
        )
        add_lot(db, stock_setup["target"], "SMALL", days=5, quantity=3, customer_code="C002")
        db.commit()
    for field, query in (
        ("customer_code", "C001"),
        ("product_code", "P001"),
        ("source_batch_no", "SOURCE-12"),
        ("owned_quantity", "24"),
        ("owned_weight", "2.4"),
    ):
        result = stock(
            client,
            search_field=field,
            query=query,
            receipt_source="opening",
            route_status="unlinked",
            stock_age_min=3,
            page_size=1,
        )
        assert result["total"] == 1
        assert result["items"][0]["serial_no"] == "MATCH"
    assert (
        stock(client, search_field="owned_quantity", search_operator="gte", query="4")["total"] == 1
    )
    assert (
        client.get(
            "/api/serial-inventory/stock", params={"search_field": "owned_quantity", "query": "2.4"}
        ).status_code
        == 422
    )


@pytest.mark.usefixtures("legacy_stock")
def test_processing_state_filters_agree_with_actual_work_and_quantities(client, warehouse):
    from test_processing_daily import setup_lot, work

    s = warehouse
    lot, employee = setup_lot(client, s)
    before = stock(client, team_id=s["other"]["id"], processing_state="unregistered")
    assert before["total"] == 1 and before["items"][0]["owned_quantity"] == 10
    assert stock(client, team_id=s["other"]["id"], processing_state="complete")["total"] == 0
    result = work(client, s, lot, employee)
    assert result.status_code == 201, result.text
    after = stock(client, team_id=s["other"]["id"], processing_state="complete", page_size=1)
    assert after["total"] == 1
    assert after["items"][0]["processing_state"] == "complete"
    assert after["items"][0]["owned_quantity"] == 10
    assert stock(client, team_id=s["other"]["id"], processing_state="unregistered")["total"] == 0


@pytest.mark.usefixtures("legacy_stock")
def test_processed_and_remaining_stock_keep_receipt_clock_through_repeated_splits(
    client, warehouse, monkeypatch
):
    from test_processing_daily import setup_lot, work
    from test_warehouse_classification import base

    s = warehouse
    lot, employee = setup_lot(client, s)
    with SessionLocal() as db:
        db.get(MaterialTransfer, lot["id"]).received_at = NOW - timedelta(days=10)
        db.commit()
    monkeypatch.setattr("app.warehouse_inventory.utcnow", lambda: NOW)
    monkeypatch.setattr("app.material_analytics.utcnow", lambda: NOW)
    monkeypatch.setattr("app.factory_overview.utcnow", lambda: NOW)
    monkeypatch.setattr("app.quantity_adjustments.utcnow", lambda: NOW - timedelta(days=2))
    first = work(client, s, lot, employee, completed_quantity=6, completed_weight=60)
    assert first.status_code == 201, first.text
    produced, remaining = first.json()["outputs"]
    rows = stock(client, team_id=s["other"]["id"])["items"]
    by_role = {r["processing_role"]: r for r in rows}
    assert by_role["produced"]["stock_age_hours"] == 240
    assert by_role["produced"]["stock_age_basis"] == "received"
    assert by_role["produced"]["stock_age_started_at"] == "2026-10-26T12:00:00+00:00"
    assert by_role["remaining"]["stock_age_hours"] == 240
    assert by_role["remaining"]["stock_age_basis"] == "received"
    assert by_role["remaining"]["stock_age_started_at"] == "2026-10-26T12:00:00+00:00"

    monkeypatch.setattr("app.quantity_adjustments.utcnow", lambda: NOW - timedelta(days=1))
    second = work(
        client,
        s,
        remaining,
        employee,
        completed_quantity=2,
        completed_weight=20,
        idempotency_key="age-second",
    )
    assert second.status_code == 201, second.text
    old = stock(client, team_id=s["other"]["id"], stock_age_min=7)
    assert old["total"] == 2
    assert sum(row["owned_quantity"] for row in old["items"]) == 10
    assert all(row["stock_age_hours"] == 240 for row in old["items"])
    completed = stock(
        client, team_id=s["other"]["id"], processing_state="complete", stock_age_min=7
    )
    assert completed["total"] == 1
    assert completed["items"][0]["owned_quantity"] == 8
    assert completed["items"][0]["stock_age_hours"] == 240
    assert stock(client, team_id=s["other"]["id"], stock_age_max=3)["total"] == 0
    analytics = client.get(base(s, True) + "/analytics").json()
    ages = {r["key"]: r["quantity"] for r in analytics["stock_age"]}
    assert ages["ge7"] == 10 and ages["1_3"] == 0
    factory = client.get("/api/factory-overview").json()
    factory_ages = {r["key"]: r["quantity"] for r in factory["stock_age"]}
    assert factory_ages["ge7"] == 10 and factory_ages["1_3"] == 0
    attention = factory["stock_attention"]
    assert sum(row["quantity"] for row in attention) == 10
    assert {row["received_at"] for row in attention} == {"2026-10-26T12:00:00+00:00"}
    assert lot["id"] not in {row["transfer_id"] for row in attention}
    filtered = client.get(base(s, True) + "/inventory", params={"stock_age": "ge7"}).json()
    assert filtered["total"] == 2
    assert sum(row["owned_quantity"] for row in filtered["items"]) == 10

    # Derive clocks from provenance; do not overwrite actual child creation/receipt facts.
    with SessionLocal() as db:
        assert db.get(MaterialTransfer, produced["id"]).received_at == NOW - timedelta(days=2)
        assert db.get(MaterialTransfer, remaining["id"]).received_at == NOW - timedelta(days=2)


@pytest.mark.usefixtures("legacy_stock")
def test_same_team_reallocation_keeps_clocks_and_next_team_receipt_starts_over(
    client, warehouse, monkeypatch
):
    from test_processing_daily import setup_lot, work
    from test_serial_reallocations import reallocate
    from test_warehouse_classification import confirm, dispatch

    s = warehouse
    lot, employee = setup_lot(client, s)
    with SessionLocal() as db:
        db.get(MaterialTransfer, lot["id"]).received_at = NOW - timedelta(days=10)
        db.commit()
    monkeypatch.setattr("app.warehouse_inventory.utcnow", lambda: NOW)
    monkeypatch.setattr("app.quantity_adjustments.utcnow", lambda: NOW - timedelta(days=2))
    first = work(client, s, lot, employee, completed_quantity=6, completed_weight=60)
    assert first.status_code == 201, first.text
    produced, remaining = first.json()["outputs"]
    for child, serial in ((produced, "DONE-ORDER"), (remaining, "WAIT-ORDER")):
        changed = reallocate(
            client,
            {"team": s["other"], "headers": s["other_headers"]},
            child,
            serial_no=serial,
            quantity=1,
            weight=10,
            idempotency_key=f"age-{serial}",
        )
        assert changed.status_code == 201, changed.text
        assert stock(client, serial_no=serial)["items"][0]["stock_age_hours"] == 240
    sent = dispatch(
        client,
        s,
        [dict(source_transfer_id=produced["id"], quantity=1, weight=10)],
        workshop=True,
    )
    assert sent.status_code == 201, sent.text
    assert confirm(client, s, sent.json()).status_code == 200
    with SessionLocal() as db:
        db.get(MaterialTransfer, sent.json()["items"][0]["id"]).received_at = NOW - timedelta(
            hours=6
        )
        db.commit()
    received = stock(client, team_id=s["team"]["id"])["items"][0]
    assert received["stock_age_hours"] == 6
    assert received["stock_age_basis"] == "received"


@pytest.mark.usefixtures("legacy_stock")
def test_unsplit_processing_keeps_receipt_clock_despite_work_and_later_updates(
    client, warehouse, monkeypatch
):
    from test_processing_daily import setup_lot, work

    s = warehouse
    lot, employee = setup_lot(client, s, code="FACTORY-WIRE")
    with SessionLocal() as db:
        row = db.get(MaterialTransfer, lot["id"])
        row.received_at = NOW - timedelta(days=10)
        db.commit()
    monkeypatch.setattr("app.warehouse_inventory.utcnow", lambda: NOW)
    monkeypatch.setattr("app.quantity_adjustments.utcnow", lambda: NOW - timedelta(hours=5))
    done = work(client, s, lot, employee, input_quantity=10, processing_status="complete")
    assert done.status_code == 201, done.text
    with SessionLocal() as db:
        db.get(MaterialTransfer, lot["id"]).updated_at = NOW
        db.commit()
    row = stock(client, team_id=s["other"]["id"])["items"][0]
    assert row["stock_age_hours"] == 240
    assert row["stock_age_basis"] == "received"
