"""Origin dates survive splits and revisions without multiplying delivery requirements."""

from datetime import datetime
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from unittest.mock import patch

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from app.database import SessionLocal
from app.models import MaterialTransfer
from sqlalchemy import create_engine
from test_warehouse_receipts import intake
from test_warehouse_receipts import warehouse as warehouse


def details(client, batch, headers):
    return client.get(f"/api/material-transfers/{batch}", headers=headers).json()


def test_origin_date_follows_two_handoffs_and_revision_never_changes_stock(client, warehouse):
    response = intake(client, warehouse, delivery_date="2026-10-01", delivery_quantity=80)
    assert response.status_code == 201, response.text
    origin = response.json()
    assert origin["can_edit_delivery"] is True
    assert origin["delivery_origin_batch_no"] == origin["batch_no"]
    dispatch_url = warehouse["url"].replace("/receipts", "/dispatches")
    response = client.post(
        dispatch_url,
        headers=warehouse["headers"],
        json={
            "next_team_id": warehouse["other"]["id"],
            "idempotency_key": "delivery-split",
            "lines": [
                {"source_transfer_id": origin["id"], "quantity": n, "weight": 2} for n in (20, 30)
            ],
        },
    )
    assert response.status_code == 201, response.text
    children = response.json()["items"]
    for child in children:
        assert (child["delivery_date"], child["delivery_quantity"]) == ("2026-10-01", 80)
        assert not child["can_edit_delivery"]
        assert child["delivery_origin_batch_no"] == origin["batch_no"]
    child = children[0]
    assert (
        client.post(
            f"/api/material-transfers/{child['batch_no']}/confirm",
            headers=warehouse["other_headers"],
            json={"idempotency_key": "delivery-receive"},
        ).status_code
        == 200
    )
    response = client.post(
        f"/api/team-materials/{warehouse['other']['id']}/dispatches",
        headers=warehouse["other_headers"],
        json={
            "next_team_id": warehouse["team"]["id"],
            "idempotency_key": "delivery-return-internal",
            "lines": [
                {
                    "source_transfer_id": child["id"],
                    "quantity": 10,
                    "weight": 1,
                    "material_type": "semi_finished",
                }
            ],
        },
    )
    assert response.status_code == 201, response.text
    grandchild = response.json()["items"][0]
    assert grandchild["delivery_origin_batch_no"] == origin["batch_no"]
    before = client.get("/api/factory-dashboard").json()["stock"]
    payload = {
        "delivery_date": "2026-10-03",
        "delivery_quantity": 90,
        "expected_version": origin["version"],
    }
    url = f"/api/material-transfers/{origin['batch_no']}/delivery"
    assert client.patch(url, json=payload).status_code == 403
    assert client.patch(url, headers=warehouse["other_headers"], json=payload).status_code == 403
    response = client.patch(url, headers=warehouse["headers"], json=payload)
    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["locked"] and updated["quantity"] == 100 and updated["weight"] == 10.125
    assert updated["history"][-1]["changes"]["delivery_date"] == {
        "before": "2026-10-01",
        "after": "2026-10-03",
    }
    assert client.patch(url, headers=warehouse["headers"], json=payload).status_code == 409
    assert (
        details(client, grandchild["batch_no"], warehouse["headers"])["delivery_date"]
        == "2026-10-03"
    )
    rows = client.get("/api/factory-dashboard/deliveries").json()["items"]
    assert (
        len(rows) == 1
        and rows[0]["quantity"] == 90
        and rows[0]["source_batch_no"] == origin["batch_no"]
    )
    assert client.get("/api/factory-dashboard").json()["stock"] == before
    assert (
        client.patch(
            f"/api/material-transfers/{children[1]['batch_no']}",
            headers=warehouse["headers"],
            json={"delivery_date": "2026-10-04", "delivery_quantity": 10},
        ).status_code
        == 422
    )
    assert (
        client.patch(
            f"/api/material-transfers/{grandchild['batch_no']}/delivery",
            headers=warehouse["other_headers"],
            json=payload,
        ).status_code
        == 403
    )


@pytest.mark.parametrize(
    "fields",
    [
        {"delivery_date": "2026-10-01"},
        {"delivery_quantity": 20},
        {"delivery_date": "2026-10-01", "delivery_quantity": 0},
        {"delivery_date": "2026-02-30", "delivery_quantity": 1},
        {"delivery_date": "1999-10-01", "delivery_quantity": 1},
    ],
)
def test_invalid_origin_requirement_is_rejected_atomically(client, warehouse, fields):
    assert intake(client, warehouse, **fields).status_code == 422
    assert client.get(warehouse["url"]).json()["total"] == 0
    response = client.post(
        "/api/material-transfers",
        headers=warehouse["headers"],
        json={
            "serial_no": "DIRECT",
            "next_team_id": warehouse["other"]["id"],
            "quantity": 20,
            "weight": 1,
            **fields,
        },
    )
    assert response.status_code == 422


def test_new_origin_date_and_voiding_remove_only_that_requirement(client, warehouse):
    response = client.post(
        "/api/material-transfers",
        headers=warehouse["headers"],
        json={
            "serial_no": "DIRECT",
            "next_team_id": warehouse["other"]["id"],
            "quantity": 20,
            "weight": 1,
            "delivery_date": "2026-10-01",
            "delivery_quantity": 80,
            "idempotency_key": "new-date",
        },
    )
    assert response.status_code == 201, response.text
    row = response.json()
    assert row["delivery_quantity"] == 80 and row["quantity"] == 20
    assert client.get("/api/factory-dashboard/deliveries").json()["total"] == 1
    assert (
        client.delete(
            f"/api/material-transfers/{row['batch_no']}", headers=warehouse["headers"]
        ).status_code
        == 204
    )
    assert client.get("/api/factory-dashboard/deliveries").json()["total"] == 0


def test_two_origin_batches_keep_fifo_and_confirmed_shipment_dates(client, warehouse):
    first = intake(
        client,
        warehouse,
        material_type="finished",
        delivery_date="2026-09-24",
        delivery_quantity=20,
    ).json()
    second = intake(
        client,
        warehouse,
        material_type="finished",
        delivery_date="2026-09-25",
        delivery_quantity=20,
        idempotency_key="second-origin",
    ).json()
    response = client.post(
        warehouse["url"].replace("/receipts", "/dispatches"),
        headers=warehouse["headers"],
        json={
            "entry_kind": "warehouse_outbound",
            "external_destination": "客户",
            "idempotency_key": "ship-date",
            "lines": [{"source_transfer_id": second["id"], "quantity": 30, "weight": 3}],
        },
    )
    assert response.status_code == 201, response.text
    sent = response.json()["items"][0]
    assert (
        sum(r["shipped"] for r in client.get("/api/factory-dashboard/deliveries").json()["items"])
        == 30
    )
    assert sent['status'] == 'dispatched'
    with SessionLocal() as db:
        db.get(MaterialTransfer, sent["id"]).dispatched_at = datetime(2026, 9, 25, 2)
        db.commit()
    with patch("app.factory_dashboard.utcnow", return_value=datetime(2026, 9, 26)):
        rows = {
            r["source_batch_no"]: r
            for r in client.get("/api/factory-dashboard/deliveries").json()["items"]
        }
    assert (rows[first["batch_no"]]["shipped"], rows[first["batch_no"]]["status"]) == (
        20,
        "late_complete",
    )
    assert (rows[second["batch_no"]]["remaining"], rows[second["batch_no"]]["status"]) == (
        10,
        "overdue",
    )
    returned = intake(
        client,
        warehouse,
        receipt_kind="return",
        external_source="客户退回",
        return_dispatch_no=sent["batch_no"],
        idempotency_key="return-date",
        quantity=5,
        weight=0.5,
    )
    assert returned.status_code == 201, returned.text
    assert returned.json()["delivery_origin_batch_no"] == second["batch_no"]
    assert returned.json()["delivery_date"] == "2026-09-25"
    assert not returned.json()["can_edit_delivery"]
    assert client.get("/api/factory-dashboard/deliveries").json()["total"] == 2


def test_unlinked_return_cannot_create_an_extra_delivery_requirement(client, warehouse):
    response = intake(
        client,
        warehouse,
        receipt_kind="return",
        external_source="外委单位",
        delivery_date="2026-10-01",
        delivery_quantity=20,
    )
    assert response.status_code == 422
    assert client.get(warehouse["url"]).json()["total"] == 0


@pytest.mark.parametrize("partial", [False, True])
def test_migration_preserves_dates_unknown_and_rebuilds_explicit_ancestry_only(partial):
    path = Path(__file__).parents[1] / "alembic/versions/20260927_0021_batch_delivery.py"
    spec = spec_from_file_location("batch_delivery_migration", path)
    migration = module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "CREATE TABLE material_transfers (id INTEGER PRIMARY KEY, source_transfer_id INTEGER, quantity INTEGER)"
            )
            connection.exec_driver_sql(
                "INSERT INTO material_transfers VALUES (1, NULL, 100), (2, 1, 40), (3, 2, 20), (4, 1, 60)"
            )
            if partial:
                connection.exec_driver_sql(
                    "ALTER TABLE material_transfers ADD COLUMN delivery_date DATE"
                )
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
                migration.upgrade()
            rows = connection.exec_driver_sql(
                "SELECT id, source_transfer_id, quantity, delivery_origin_id, delivery_date, delivery_quantity FROM material_transfers ORDER BY id"
            ).all()
            assert rows == [
                (1, None, 100, None, None, None),
                (2, 1, 40, 1, None, None),
                (3, 2, 20, 1, None, None),
                (4, 1, 60, 1, None, None),
            ]
    finally:
        engine.dispose()
