from datetime import datetime
from decimal import Decimal
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

import pytest
from app.configure_material_teams import configure_material_teams
from app.database import SessionLocal
from app.inventory_shipments import ShipmentTotal, allocate
from app.models import MaterialTransfer, ProcessRoutePolicy, Team, TeamPurpose
from fastapi import HTTPException
from receipt_helpers import receipt_post
from sender_helpers import sender_post
from sqlalchemy import func, select
from test_material_transfers import _create, _setup_three_teams
from test_warehouse_receipts import intake
from test_warehouse_receipts import warehouse as warehouse


def test_normal_transfer_requires_dimensions_and_cannot_clear_them(client):
    setup = _setup_three_teams(client)
    response = _create(client, setup, transfer_specification="   ")
    assert response.status_code == 422 and "实际尺寸" in response.text
    created = _create(client, setup).json()
    result = client.patch(
        f"/api/material-transfers/{created['batch_no']}",
        headers=setup["source_headers"],
        json={"transfer_specification": "", "expected_version": created["version"]},
    )
    assert result.status_code == 422
    # An older pending document cannot bypass the receiving boundary either.
    with SessionLocal.begin() as db:
        db.get(MaterialTransfer, created["id"]).transfer_specification = None
    result = receipt_post(
        client,
        f"/api/material-transfers/{created['batch_no']}/confirm",
        headers=setup["target_headers"],
        json={"idempotency_key": "receive"},
    )
    assert result.status_code == 422 and "实际尺寸" in result.text


def test_unknown_intake_serial_blocked_when_engineering_enabled(client, warehouse):
    with SessionLocal.begin() as db:
        db.add(ProcessRoutePolicy(id=1, enforced_after=datetime.now()))
    result = intake(client, warehouse, serial_no="WRONG-123")
    assert result.status_code == 422 and "流水号未登记" in result.text
    result = intake(
        client, warehouse, serial_no="", material_type="raw_material", idempotency_key="raw"
    )
    assert result.status_code == 201, result.text


def test_flat_grinding_is_a_business_and_configuration_is_idempotent(client):
    with SessionLocal() as db:
        configure_material_teams(db)
        configure_material_teams(db)
        team = db.scalar(select(Team).where(Team.code == "FACTORY-GRIND"))
        choices = db.scalars(select(TeamPurpose).where(TeamPurpose.team_id == team.id)).all()
        assert {row.name for row in choices} == {"研磨", "平磨"}
        assert len(choices) == 2
        assert db.scalar(select(func.count()).select_from(Team).where(Team.name == "平磨")) == 0


def test_flat_grinding_migration_preserves_existing_businesses(client, monkeypatch):
    path = Path(__file__).parents[1] / "alembic/versions/20261105_0068_grinding_purpose.py"
    spec = spec_from_file_location("grinding_purpose_migration", path)
    migration = module_from_spec(spec)
    spec.loader.exec_module(migration)
    with SessionLocal.begin() as db:
        team = Team(code="FACTORY-GRIND", name="研磨")
        db.add(team)
        db.flush()
        monkeypatch.setattr(migration.op, "get_bind", db.connection)
        migration.upgrade()
        choices = db.scalars(select(TeamPurpose).where(TeamPurpose.team_id == team.id)).all()
        assert {row.name for row in choices} == {"研磨", "平磨"}
        flat = next(row for row in choices if row.name == "平磨")
        flat.active, flat.version = False, 3
        db.flush()
        migration.upgrade()
        db.expire_all()
        choices = db.scalars(select(TeamPurpose).where(TeamPurpose.team_id == team.id)).all()
        assert len(choices) == 2
        flat = next(row for row in choices if row.name == "平磨")
        assert flat.active is False and flat.version == 3


def test_inventory_search_accepts_copied_serial_and_preserves_leading_zeros(client, warehouse):
    intake(client, warehouse, serial_no="00691236-50")
    for query in ("00691236－50", " 00691236–50 ", "００６９１２３６－５０", "00691236-50\u200b"):
        response = client.get(
            f"/api/team-materials/{warehouse['team']['id']}/inventory", params={"query": query}
        )
        assert response.status_code == 200, response.text
        assert response.json()["total"] == 1, query
    assert (
        client.get(
            f"/api/team-materials/{warehouse['team']['id']}/inventory",
            params={"query": "00691236%"},
        ).json()["total"]
        == 0
    )


@pytest.fixture()
def inspection_stock(client):
    setup = _setup_three_teams(client)
    with SessionLocal.begin() as db:
        target = db.get(Team, setup["target"]["id"])
        target.code, target.name = "FACTORY-QC", "检验"
    lots = []
    for i, (quantity, weight) in enumerate([(10, "2"), (20, "5")]):
        result = _create(
            client,
            setup,
            serial_no="SHIP-001",
            material_type="finished",
            quantity=quantity,
            weight=weight,
            idempotency_key=f"lot-{i}",
        )
        assert result.status_code == 201, result.text
        lot = result.json()
        result = receipt_post(
            client,
            f"/api/material-transfers/{lot['batch_no']}/confirm",
            headers=setup["target_headers"],
            json={"idempotency_key": f"receive-{i}"},
        )
        assert result.status_code == 200, result.text
        lots.append(lot)
    return setup, lots


@pytest.mark.usefixtures("legacy_stock")
def test_total_shipment_allocates_atomically_and_retries_without_double_deduction(
    client, inspection_stock
):
    setup, lots = inspection_stock
    base = f"/api/team-materials/{setup['target']['id']}"
    preview = client.get(
        base + f"/inventory/{lots[0]['id']}/shipment-stock", headers=setup["target_headers"]
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["quantity"] == 30
    payload = {
        "entry_kind": "inspection_shipment",
        "external_destination": "对外转料",
        "idempotency_key": "total-ship",
        "inventory_total": {
            "group_id": lots[0]["id"],
            "revision": preview.json()["revision"],
            "quantity": 15,
            "weight": 3,
        },
    }
    result = sender_post(
        client, base + "/dispatches", headers=setup["target_headers"], json=payload
    )
    assert result.status_code == 201, result.text
    items = result.json()["items"]
    assert [(i["source_transfer_id"], i["quantity"], i["weight"]) for i in items] == [
        (lots[0]["id"], 10, 2),
        (lots[1]["id"], 5, 1),
    ]
    repeat = sender_post(
        client, base + "/dispatches", headers=setup["target_headers"], json=payload
    )
    assert repeat.status_code == 201 and repeat.json() == result.json()
    stale = sender_post(
        client,
        base + "/dispatches",
        headers=setup["target_headers"],
        json={**payload, "idempotency_key": "stale"},
    )
    assert stale.status_code == 409 and "库存已变化" in stale.text
    balance = client.get(base + "/overview").json()["totals"]
    assert balance["on_hand_quantity"] == 15 and balance["on_hand_weight"] == 4
    forbidden = client.get(
        base + f"/inventory/{lots[0]['id']}/shipment-stock", headers=setup["source_headers"]
    )
    assert forbidden.status_code == 403


def test_total_allocation_rejects_excess_and_keeps_decimal_precision():
    rows = [
        {"id": 1, "quantity": 2, "weight": Decimal("0.001123")},
        {"id": 2, "quantity": 4, "weight": Decimal("0.002234")},
    ]
    total = ShipmentTotal(group_id=1, revision="a" * 64, quantity=4, weight=Decimal("0.002"))
    lines = allocate(rows, total)
    assert sum(line["quantity"] for line in lines) == 4
    assert sum(line["weight"] for line in lines) == Decimal("0.002")
    with pytest.raises(HTTPException):
        allocate(rows, total.model_copy(update={"quantity": 7}))


def test_total_allocation_never_allocates_negative_stock_measurements():
    rows = [
        {"id": 1, "quantity": -2, "weight": Decimal("1")},
        {"id": 2, "quantity": 4, "weight": Decimal("-0.1")},
    ]
    total = ShipmentTotal(group_id=1, revision="a" * 64, quantity=4, weight=Decimal("1"))
    assert allocate(rows, total) == [
        {"source_transfer_id": 1, "quantity": 0, "weight": Decimal("1")},
        {"source_transfer_id": 2, "quantity": 4, "weight": Decimal("0")},
    ]


@pytest.mark.usefixtures("legacy_stock")
def test_dispatch_rejects_missing_or_cleared_dimensions_before_reserving_stock(
    client, inspection_stock
):
    setup, lots = inspection_stock
    with SessionLocal.begin() as db:
        db.get(MaterialTransfer, lots[0]["id"]).transfer_specification = None
    base = f"/api/team-materials/{setup['target']['id']}"
    payload = {
        "next_team_id": setup["third"]["id"],
        "idempotency_key": "required-dimensions",
        "lines": [{"source_transfer_id": lots[0]["id"], "quantity": 5, "weight": 1}],
    }
    missing = sender_post(
        client, base + "/dispatches", headers=setup["target_headers"], json=payload
    )
    assert missing.status_code == 422 and "实际尺寸" in missing.text
    assert client.get(base + "/overview").json()["totals"]["reserved_quantity"] == 0
    payload["lines"][0]["transfer_specification"] = "20 × 10 × 2 mm"
    valid = sender_post(client, base + "/dispatches", headers=setup["target_headers"], json=payload)
    assert valid.status_code == 201, valid.text
    assert valid.json()["items"][0]["transfer_specification"] == "20 × 10 × 2 mm"
    payload["idempotency_key"] = "cleared-dimensions"
    payload["lines"][0].update(source_transfer_id=lots[1]["id"], transfer_specification="")
    cleared = sender_post(
        client, base + "/dispatches", headers=setup["target_headers"], json=payload
    )
    assert cleared.status_code == 422 and "实际尺寸" in cleared.text
