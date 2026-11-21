"""Every new physical arrival requires a real selected warehouse slot."""

import json

import pytest
from app.database import SessionLocal
from app.models import WarehouseLocation
from sender_helpers import sender_post
from sqlalchemy import select
from test_material_transfers import _team
from test_warehouse_classification import base, confirm, dispatch
from test_warehouse_receipts import intake
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401
from warehouse_test_locations import select_location

pytestmark = pytest.mark.usefixtures("legacy_stock")


def test_receipt_requires_location_and_lists_each_batch(client, warehouse):
    setup = warehouse
    for missing in (None, "", " "):
        rejected = intake(client, setup, warehouse_location=missing)
        assert rejected.status_code == 422, rejected.text
        assert "入库仓位" in rejected.text
    first = intake(client, setup).json()
    second = intake(client, setup, idempotency_key="second").json()
    assert first["batch_no"] != second["batch_no"]
    url = base(setup) + "/inventory"
    result = client.get(url).json()
    assert result["total"] == 2
    assert {row["batch_no"] for row in result["items"]} == {first["batch_no"], second["batch_no"]}
    assert all(
        row["serial_no"] == "WAREHOUSE-001" and row["batch_count"] == 1 for row in result["items"]
    )
    # Location names follow the current slot, not the original document snapshot.
    with SessionLocal.begin() as db:
        slot = db.scalar(
            select(WarehouseLocation).where(WarehouseLocation.name == first["warehouse_location"])
        )
        slot.name = "改名后的仓库"
    for params in (
        {"query": first["batch_no"]},
        {"query": first["batch_no"], "search_field": "batch_no"},
        {"query": "改名后的仓库"},
        {"query": "改名后的仓库", "search_field": "warehouse_location"},
        {
            "table_query": json.dumps(
                {"filters": [{"field": "batch_no", "value": first["batch_no"]}]}
            )
        },
    ):
        response = client.get(url, params=params)
        assert response.status_code == 200, response.text
        assert response.json()["total"] == 1
        row = response.json()["items"][0]
        assert row["batch_no"] == first["batch_no"]
        assert row["warehouse_location"] == "改名后的仓库"


def test_both_stock_and_manual_returns_require_location(client, warehouse):
    setup = warehouse
    origin = intake(client, setup).json()
    sent = dispatch(
        client, setup, [{"source_transfer_id": origin["id"], "quantity": 100, "weight": 10}]
    ).json()
    assert confirm(client, setup, sent, workshop=True).status_code == 200
    line = {"source_transfer_id": sent["items"][0]["id"], "quantity": 10, "weight": 1}
    payload = {"next_team_id": setup["team"]["id"], "idempotency_key": "return", "lines": [line]}
    for suffix in ("/dispatches", "/outbound-batches"):
        rejected = sender_post(
            client, base(setup, True) + suffix, headers=setup["other_headers"], json=payload
        )
        assert rejected.status_code == 422, rejected.text
        assert "入库仓位" in rejected.text
    assert client.get(base(setup) + "/overview").json()["pending_incoming"]["count"] == 0
    selected = select_location(client, setup, headers=setup["other_headers"])
    mixed = sender_post(
        client,
        base(setup, True) + "/outbound-batches",
        headers=setup["other_headers"],
        json={**payload, "lines": [{**line, **selected}, line]},
    )
    assert mixed.status_code == 422, mixed.text
    assert client.get(base(setup) + "/overview").json()["pending_incoming"]["count"] == 0
    accepted = sender_post(
        client,
        base(setup, True) + "/outbound-batches",
        headers=setup["other_headers"],
        json={**payload, "lines": [{**line, **selected}]},
    )
    assert accepted.status_code == 201, accepted.text

    assert accepted.json()["items"][0]["warehouse_location"] == selected["warehouse_location"]
    manual = {
        "next_team_id": setup["team"]["id"],
        "serial_no": "MANUAL",
        "material_type": "finished",
        "quantity": 1,
        "weight": 1,
        "idempotency_key": "manual-return",
        "transfer_specification": "100 × 80 × 5 mm",
    }
    rejected = sender_post(
        client, "/api/material-transfers", headers=setup["other_headers"], json=manual
    )
    assert rejected.status_code == 422, rejected.text
    assert "入库仓位" in rejected.text
    accepted = sender_post(
        client,
        "/api/material-transfers",
        headers=setup["other_headers"],
        json={**manual, **select_location(client, setup, headers=setup["other_headers"])},
    )
    assert accepted.status_code == 201, accepted.text

    # A saved transfer cannot bypass the rule by changing its destination later.
    next_team = _team(client, "FACTORY-GRIND", "研磨")
    original = sender_post(
        client,
        "/api/material-transfers",
        headers=setup["other_headers"],
        json={**manual, "next_team_id": next_team["id"], "idempotency_key": "change-destination"},
    )
    assert original.status_code == 201, original.text
    url = "/api/material-transfers/" + original.json()["batch_no"]
    rejected = client.patch(
        url, headers=setup["other_headers"], json={"next_team_id": setup["team"]["id"]}
    )
    assert rejected.status_code == 422, rejected.text
    assert "入库仓位" in rejected.text
    assert client.get(url).json()["next_team_id"] == next_team["id"]
    accepted = client.patch(
        url,
        headers=setup["other_headers"],
        json={
            "next_team_id": setup["team"]["id"],
            **select_location(client, setup, headers=setup["other_headers"]),
        },
    )
    assert accepted.status_code == 200, accepted.text
