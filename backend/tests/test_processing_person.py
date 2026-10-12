"""Actual workers are name snapshots, independent of the logged-in recorder."""

import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from app.database import SessionLocal
from app.models import MaterialQuantityAdjustment, MaterialStockBalance
from sqlalchemy import create_engine, inspect, select
from test_processing_dispatch import workshop_lot
from test_quantity_adjustments import change
from test_warehouse_classification import base, dispatch
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401


@pytest.mark.parametrize("person", [None, "", " \t ", "张" * 81])
def test_invalid_worker_does_not_write_processing_or_dispatch(client, warehouse, person):
    lot = workshop_lot(client, warehouse)
    body = {"source_transfer_id": lot["id"], "quantity": 20, "expected_revision": 0}
    if person is not None:
        body["processor_name"] = person
    response = client.post(
        base(warehouse, True) + "/quantity-adjustments",
        headers=warehouse["other_headers"],
        json={**body, "idempotency_key": "invalid-worker"},
    )
    assert response.status_code == 422, response.text
    outgoing = dispatch(
        client,
        warehouse,
        [{"source_transfer_id": lot["id"], "quantity": 20, "weight": 1}],
        workshop=True,
        quantity_adjustments=[body],
    )
    assert outgoing.status_code == 422, outgoing.text
    with SessionLocal() as db:
        assert db.get(MaterialStockBalance, lot["id"]).on_hand_quantity == 1
        assert db.scalar(select(MaterialQuantityAdjustment)) is None


def test_worker_snapshot_search_history_and_idempotency(client, warehouse):
    client.patch(f"/api/teams/{warehouse['other']['id']}", json={"code": "FACTORY-ROLL"})
    employee = client.post(base(warehouse, True) + "/employees", json={"name": "王师傅"}).json()
    lot = workshop_lot(client, warehouse)
    first = change(client, warehouse, lot, 20, workshop=True, processor_name=" 王师傅 ", revision=0)
    assert first.status_code == 201, first.text
    assert first.json()["processor_name"] == "王师傅"
    assert first.json()["created_by"] != "王师傅"
    assert (
        change(
            client, warehouse, lot, 20, workshop=True, processor_name="王师傅", revision=0
        ).json()
        == first.json()
    )
    assert (
        change(
            client, warehouse, lot, 20, workshop=True, processor_name="李师傅", revision=0
        ).status_code
        == 409
    )
    url = base(warehouse, True)
    records = client.get(url + "/processing-records", params={"query": "王师傅"}).json()
    assert records["total"] == 1 and records["items"][0]["processor_name"] == "王师傅"
    context = client.get(f"{url}/stock/{lot['id']}/quantity-adjustments").json()
    assert context["items"][0]["processor_name"] == "王师傅"
    assert context["processor_options"].count("王师傅") == 1
    updated = client.patch(
        f"{url}/employees/{employee['id']}",
        json={"name": "王师傅（停用）", "active": False, "expected_version": 1},
    )
    assert updated.status_code == 200, updated.text
    assert (
        change(
            client, warehouse, lot, 20, workshop=True, processor_name="王师傅", revision=0
        ).json()
        == first.json()
    )
    assert (
        change(
            client, warehouse, lot, 21, workshop=True, processor_name="王师傅", key="disabled"
        ).status_code
        == 422
    )
    from app.quantity_adjustments import processor_options

    with SessionLocal() as db:
        assert "王师傅" not in processor_options(db, warehouse["team"]["id"])
        # A historical row remains unknown, rather than guessed from its recorder.
        db.connection().execute(
            MaterialQuantityAdjustment.__table__.update()
            .where(MaterialQuantityAdjustment.id == first.json()["id"])
            .values(processor_name=None)
        )
        db.commit()
    context = client.get(f"{url}/stock/{lot['id']}/quantity-adjustments").json()
    assert context["items"][0]["processor_name"] is None


def test_worker_migration_preserves_existing_history():
    path = Path(__file__).parents[1] / "alembic/versions/20261012_0035_processing_person.py"
    spec = importlib.util.spec_from_file_location("processing_person_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "CREATE TABLE material_quantity_adjustments (id INTEGER PRIMARY KEY, team_id INTEGER, created_by VARCHAR(80))"
            )
            connection.exec_driver_sql(
                "INSERT INTO material_quantity_adjustments VALUES (1, 2, '班组长')"
            )
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
                migration.upgrade()
            assert connection.exec_driver_sql(
                "SELECT id, created_by, processor_name FROM material_quantity_adjustments"
            ).one() == (1, "班组长", None)
            assert "ix_team_employees_team_id" in {
                index["name"] for index in inspect(connection).get_indexes("team_employees")
            }
    finally:
        engine.dispose()


def test_employee_directory_permissions_uniqueness_and_versions(client, warehouse):
    url = base(warehouse, True) + "/employees"
    assert client.get(url, headers=warehouse["headers"]).status_code == 403
    assert (
        client.post(url, headers=warehouse["headers"], json={"name": "李师傅"}).status_code == 403
    )
    employee = client.post(url, headers=warehouse["other_headers"], json={"name": "李师傅"})
    assert employee.status_code == 201, employee.text
    assert client.post(url, json={"name": "李师傅"}).status_code == 409
    endpoint = f"{url}/{employee.json()['id']}"
    assert client.patch(endpoint, json={"name": "李工", "expected_version": 9}).status_code == 409
    assert client.patch(endpoint, json={"name": "李工", "expected_version": 1}).status_code == 200
    assert any(item["name"] == "李工" for item in client.get(url).json())
    lot = workshop_lot(client, warehouse)
    assert (
        change(client, warehouse, lot, 20, workshop=True, processor_name="未登记员工").status_code
        == 422
    )
    client.post(base(warehouse) + "/employees", json={"name": "库房员工"})
    assert (
        change(client, warehouse, lot, 20, workshop=True, processor_name="库房员工").status_code
        == 422
    )
    with SessionLocal() as db:
        assert db.get(MaterialStockBalance, lot["id"]).on_hand_quantity == 1
