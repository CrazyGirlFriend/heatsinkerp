"""Quality self-checks are facts on the work record; QC approval is not required."""

import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text
from test_processing_daily import setup_lot, work
from test_warehouse_classification import base, dispatch
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

pytestmark = pytest.mark.usefixtures("legacy_stock")


@pytest.mark.parametrize(
    "code", ["FACTORY-ANNEAL", "FACTORY-GRIND", "FACTORY-ENGRAVE", "FACTORY-WIRE"]
)
def test_processing_check_appears_once_in_own_team_quality(client, warehouse, code):
    s = warehouse
    split = code in ("FACTORY-ENGRAVE", "FACTORY-WIRE")
    lot, employee = setup_lot(client, s, code, 1 if split else 100)
    extra = (
        dict(
            quantity=100,
            input_quantity=1,
            outputs=[
                dict(
                    role="produced",
                    material_type="semi_finished",
                    quantity=100,
                    weight=100,
                    transfer_specification="20 × 10 × 2 mm",
                )
            ],
        )
        if split
        else {}
    )
    colleague = client.post(base(s, True) + "/employees", json={"name": "第二位员工"}).json()
    extra["processor_employee_ids"] = [employee["id"], colleague["id"]]
    check = dict(failed_quantity=2, failed_weight=1.25, failure_reason="边缘磕伤")
    invalid = work(client, s, lot, employee, self_check={**check, "failed_quantity": 101}, **extra)
    assert invalid.status_code == 422, invalid.text
    saved = work(client, s, lot, employee, expected_revision=0, self_check=check, **extra)
    assert saved.status_code == 201, saved.text
    replay = client.post(
        base(s, True) + "/quantity-adjustments",
        content=saved.request.content,
        headers={**s["other_headers"], "content-type": "application/json"},
    )
    assert replay.status_code == 201, replay.text
    assert replay.json() == saved.json()
    record = client.get(base(s, True) + "/processing-records").json()["items"][0]
    assert {k: record[k] for k in check} == check
    params = dict(team_id=s["other"]["id"], kind="processing", query="磕伤")
    result = client.get("/api/quality-feedback", params=params, headers=s["other_headers"])
    assert result.status_code == 200, result.text
    page = result.json()
    assert (page["total"], page["pending_count"]) == (1, 0)
    row = page["items"][0]
    assert (row["id"], row["feedback_status"], row["notes"]) == (
        record["id"],
        "recorded",
        "边缘磕伤",
    )
    assert (row["failed_quantity"], row["failed_weight"], row["processor_name"]) == (
        2,
        1.25,
        record["processor_name"],
    )
    assert (
        client.get("/api/quality-feedback", params={**params, "status": "pending"}).json()["total"]
        == 0
    )
    assert (
        client.get("/api/quality-feedback", params=params, headers=s["headers"]).json()["total"]
        == 0
    )
    totals = client.get(base(s, True) + "/overview").json()["totals"]
    assert (totals["on_hand_quantity"], totals["on_hand_weight"]) == (100, 100)


def test_passed_processing_is_only_in_production(client, warehouse):
    lot, employee = setup_lot(client, warehouse)
    for invalid in [
        dict(failed_quantity=1, failed_weight=1, failure_reason="  "),
        dict(failed_quantity=0, failed_weight=1),
        dict(failed_quantity=2, failed_weight=101, failure_reason="磕伤"),
    ]:
        assert work(client, warehouse, lot, employee, self_check=invalid).status_code == 422
    passed = work(
        client, warehouse, lot, employee, self_check=dict(failed_quantity=0, failed_weight=0)
    )
    assert passed.status_code == 201, passed.text
    assert passed.json()["failed_quantity"] == 0
    assert client.get("/api/quality-feedback", params={"kind": "processing"}).json()["total"] == 0


def test_split_defects_are_part_of_the_self_check(client, warehouse):
    lot, employee = setup_lot(client, warehouse, "FACTORY-ENGRAVE", quantity=1)
    outputs = [
        dict(
            role="produced",
            material_type="semi_finished",
            quantity=98,
            weight=90,
            transfer_specification="20 × 10 × 2 mm",
        ),
        dict(role="scrap", material_type="defective", quantity=2, weight=10),
    ]
    extra = dict(quantity=100, input_quantity=1, outputs=outputs)
    for count, weight in [(0, 0), (1, 10), (2, 8), (101, 10)]:
        check = dict(
            failed_quantity=count, failed_weight=weight, failure_reason="划伤" if count else ""
        )
        assert work(client, warehouse, lot, employee, self_check=check, **extra).status_code == 422
    check = dict(failed_quantity=2, failed_weight=10, failure_reason="划伤")
    response = work(client, warehouse, lot, employee, self_check=check, **extra)
    assert response.status_code == 201, response.text
    assert response.json()["completed_quantity"] == 98
    assert response.json()["failed_quantity"] == 2


def test_outbound_self_check_is_atomic_with_the_transfer(client, warehouse):
    lot, employee = setup_lot(client, warehouse, "FACTORY-WIRE", quantity=1)
    machine = client.post(base(warehouse, True) + "/equipment", json={"name": "线切割01"}).json()
    adjustment = dict(
        source_transfer_id=lot["id"],
        quantity=100,
        expected_revision=0,
        processor_name=employee["name"],
        processor_employee_id=employee["id"],
        processing_mode="split",
        processing_status="complete",
        processing_date="2026-10-15",
        input_quantity=1,
        equipment_id=machine["id"],
        processing_minutes=30,
        reason="无",
        self_check=dict(failed_quantity=2, failed_weight=2, failure_reason="切边缺口"),
    )

    def submit(**overrides):
        return dispatch(
            client,
            warehouse,
            [dict(source_transfer_id=lot["id"], quantity=98, weight=98, **overrides)],
            workshop=True,
            quantity_adjustments=[adjustment],
        )

    quality = "/api/quality-feedback?kind=processing"
    invalid = submit(serial_no="OTHER-ORDER")
    assert invalid.status_code == 422 and "流水号" in invalid.text, invalid.text
    assert client.get(quality).json()["total"] == 0
    sent = submit()
    assert sent.status_code == 201, sent.text
    assert submit().status_code == 201
    records = client.get(quality).json()
    assert records["total"] == 1
    assert (records["items"][0]["failed_quantity"], records["pending_count"]) == (2, 0)


def test_migration_preserves_existing_work_without_guessing_quality():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic/versions/20261120_0077_processing_self_check.py"
    )
    spec = importlib.util.spec_from_file_location("processing_self_check_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE material_quantity_adjustments (id INTEGER PRIMARY KEY)"))
        conn.execute(text("INSERT INTO material_quantity_adjustments (id) VALUES (1)"))
        with Operations.context(MigrationContext.configure(conn)):
            migration.upgrade()
            migration.upgrade()
            assert conn.execute(
                text(
                    "SELECT failed_quantity, failed_weight, failure_reason FROM material_quantity_adjustments"
                )
            ).one() == (None, None, None)
            migration.downgrade()
        assert [
            col["name"] for col in inspect(conn).get_columns("material_quantity_adjustments")
        ] == ["id"]
