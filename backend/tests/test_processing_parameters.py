"""Optional team parameters remain attached to the actual processing event."""

import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine
from test_processing_daily import setup_lot, work
from test_processing_dispatch import workshop_lot
from test_warehouse_classification import base, dispatch
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

pytestmark = pytest.mark.usefixtures("legacy_stock")
ANNEAL_FIELDS = ["furnace_no", "temperature_requirement", "actual_temperature_c", "holding_minutes"]


def test_anneal_parameters_persist_per_record_without_inheriting_previous_values(client, warehouse):
    s = warehouse
    lot, employee = setup_lot(client, s)
    url = base(s, True)
    first = work(
        client,
        s,
        lot,
        employee,
        furnace_no="  02炉  ",
        temperature_requirement="900–950 °C",
        actual_temperature_c=925.5,
        holding_minutes=60,
        processing_minutes=95,
        completed_quantity=6,
        completed_weight=60,
    )
    assert first.status_code == 201, first.text
    saved = first.json()
    expected = dict(
        furnace_no="02炉",
        temperature_requirement="900–950 °C",
        actual_temperature_c=925.5,
        holding_minutes=60,
        processing_minutes=95,
    )
    for key, value in expected.items():
        assert saved[key] == value
    remainder = next(row for row in saved["outputs"] if row["role"] == "remaining")
    second = work(client, s, remainder, employee, idempotency_key="another-furnace")
    assert second.status_code == 201, second.text
    assert all(second.json()[key] is None for key in ANNEAL_FIELDS)
    records = client.get(url + "/processing-records").json()
    assert records["parameter_fields"] == ANNEAL_FIELDS
    assert records["total"] == 2
    assert (
        next(r for r in records["items"] if r["id"] == saved["id"])["actual_temperature_c"] == 925.5
    )
    context = client.get(f"{url}/stock/{lot['id']}/quantity-adjustments").json()
    assert context["parameter_fields"] == ANNEAL_FIELDS
    assert context["items"][0]["furnace_no"] == "02炉"


@pytest.mark.parametrize(
    "code", ["FACTORY-ROLL", "FACTORY-GRIND", "FACTORY-WIRE", "FACTORY-ENGRAVE"]
)
def test_machine_number_applies_only_to_supported_teams(client, warehouse, code):
    s = warehouse
    lot, employee = setup_lot(client, s, code)
    params = (
        {}
        if code == "FACTORY-GRIND"
        else {
            "input_quantity": 10,
            "outputs": [
                dict(role="produced", material_type="semi_finished", quantity=10, weight=100)
            ],
        }
    )
    bad = work(client, s, lot, employee, furnace_no="03炉", **params)
    assert bad.status_code == 422, bad.text
    result = work(client, s, lot, employee, machine_no="  M-03  ", **params)
    assert result.status_code == 201, result.text
    assert result.json()["machine_no"] == "M-03"
    page = client.get(base(s, True) + "/processing-records").json()
    assert page["parameter_fields"] == ["machine_no"]
    assert page["items"][0]["machine_no"] == "M-03"


def test_invalid_parameters_do_not_change_stock_and_zero_temperature_is_recorded(client, warehouse):
    s = warehouse
    lot, employee = setup_lot(client, s)
    for params in [
        {"actual_temperature_c": -274},
        {"actual_temperature_c": 100000},
        {"actual_temperature_c": 925.123},
        {"actual_temperature_c": "NaN"},
        {"holding_minutes": 0},
        {"holding_minutes": 1.5},
        {"holding_minutes": 61, "processing_minutes": 60},
        {"furnace_no": "x" * 81},
        {"machine_no": "M-03"},
    ]:
        result = work(client, s, lot, employee, **params)
        assert result.status_code == 422, result.text
    assert client.get(base(s, True) + "/processing-records").json()["total"] == 0
    result = work(
        client, s, lot, employee, actual_temperature_c=0, furnace_no=" ", holding_minutes=30
    )
    assert result.status_code == 201, result.text
    assert result.json()["actual_temperature_c"] == 0
    assert result.json()["furnace_no"] is None
    assert result.json()["completed_quantity"] == 10


def test_outbound_processing_keeps_parameters_in_the_same_transaction(client, warehouse):
    s = warehouse
    lot = workshop_lot(client, s)
    update = dict(
        source_transfer_id=lot["id"],
        quantity=20,
        expected_revision=0,
        processor_name="张师傅",
        machine_no="WIRE-02",
    )
    amount = dict(source_transfer_id=lot["id"], quantity=8, weight=".4")
    bad = dispatch(
        client, s, [{**amount, "purpose_id": 999999}], workshop=True, quantity_adjustments=[update]
    )
    assert bad.status_code in (404, 422), bad.text
    assert client.get(base(s, True) + "/processing-records").json()["total"] == 0
    good = dispatch(client, s, [amount], workshop=True, quantity_adjustments=[update])
    assert good.status_code == 201, good.text
    records = client.get(base(s, True) + "/processing-records").json()
    assert records["items"][0]["machine_no"] == "WIRE-02"


def test_migration_retains_old_records_with_unknown_parameters():
    path = Path(__file__).parents[1] / "alembic/versions/20261112_0072_processing_parameters.py"
    spec = importlib.util.spec_from_file_location("parameters_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as conn:
            conn.exec_driver_sql(
                "CREATE TABLE material_quantity_adjustments (id INTEGER PRIMARY KEY)"
            )
            conn.exec_driver_sql("INSERT INTO material_quantity_adjustments VALUES (1)")
            with Operations.context(MigrationContext.configure(conn)):
                migration.upgrade()
                assert conn.exec_driver_sql(
                    "SELECT * FROM material_quantity_adjustments"
                ).one() == (1, None, None, None, None, None)
                migration.downgrade()
                assert conn.exec_driver_sql(
                    "SELECT * FROM material_quantity_adjustments"
                ).one() == (1,)
    finally:
        engine.dispose()
