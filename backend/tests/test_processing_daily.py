"""Completed physical work, independent of piece deltas and later shipments."""

import importlib.util
from datetime import date, timedelta
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from app.database import SessionLocal
from app.models import MaterialQuantityAdjustment, MaterialStockBalance
from sqlalchemy import create_engine, select
from test_quantity_adjustments import processing_lot
from test_warehouse_classification import base, confirm, dispatch
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401


def setup_lot(client, s, code="FACTORY-ANNEAL", quantity=10, **extra):
    assert client.patch(f"/api/teams/{s['other']['id']}", json={"code": code}).status_code == 200
    lot = processing_lot(client, s, quantity=quantity, weight=100, **extra)
    employee = client.get(base(s, True) + "/employees").json()[0]
    return lot, employee


def work(client, s, lot, employee, **extra):
    url = base(s, True)
    context = client.get(f"{url}/stock/{lot['id']}/quantity-adjustments").json()
    body = dict(
        source_transfer_id=lot["id"],
        quantity=context["quantity"],
        expected_revision=context["revision"],
        processor_name=employee["name"],
        processor_employee_id=employee["id"],
        processing_date="2026-10-15",
        processing_mode=context["processing_mode"],
        completed_quantity=context["quantity"],
        completed_weight=context["weight"],
        idempotency_key="daily-first",
    )
    body.update(extra)
    return client.post(url + "/quantity-adjustments", headers=s["other_headers"], json=body)


@pytest.mark.parametrize(
    "code",
    [
        "FACTORY-ANNEAL",
        "FACTORY-GRIND",
        "FACTORY-PLATE",
        "FACTORY-QC",
        "FACTORY-ROLL",
        "FACTORY-WIRE",
        "FACTORY-ENGRAVE",
    ],
)
def test_all_production_teams_record_actual_work(client, warehouse, code):
    s = warehouse
    split = code in ("FACTORY-ROLL", "FACTORY-WIRE", "FACTORY-ENGRAVE")
    lot, employee = setup_lot(client, s, code, 1 if split else 10)
    extra = (
        dict(
            quantity=100,
            input_quantity=1,
            outputs=[
                dict(role="produced", material_type="semi_finished", quantity=100, weight=100)
            ],
        )
        if split
        else {}
    )
    response = work(client, s, lot, employee, **extra)
    assert response.status_code == 201, response.text
    assert response.json()["processor_employee_id"] == employee["id"]
    daily = client.get(base(s, True) + "/processing-daily").json()
    assert daily["total"] == 1
    row = daily["items"][0]
    assert (row["input_quantity"], row["completed_quantity"]) == ((1, 100) if split else (10, 10))
    assert row["completed_weight"] == 100
    records = client.get(base(s, True) + "/processing-records").json()
    assert records["summary"]["completed_quantity"] == row["completed_quantity"]
    assert records["summary"]["completed_weight"] == 100
    assert records["summary"]["employee_day_count"] == 1
    totals = client.get(base(s, True) + "/overview").json()["totals"]
    assert totals["on_hand_quantity"] == (100 if split else 10)
    assert totals["on_hand_weight"] == 100
    assert client.get(base(s) + "/processing-daily").status_code == 422


def test_partial_work_multiple_people_stock_trace_and_outgoing_snapshots(client, warehouse):
    s = warehouse
    lot, employee = setup_lot(client, s)
    first = work(client, s, lot, employee, completed_quantity=6, completed_weight=60)
    assert first.status_code == 201, first.text
    produced, remaining = first.json()["outputs"]
    sources = client.get(base(s, True) + "/stock").json()["items"]
    states = {row["transfer"]["id"]: row["processing_state"] for row in sources}
    assert states[produced["id"]] == "complete"
    assert states[remaining["id"]] == "unregistered"
    groups = client.get(base(s, True) + "/inventory").json()
    assert groups["total"] == 2
    person2 = client.post(base(s, True) + "/employees", json={"name": "第二位员工"}).json()
    second = work(client, s, remaining, person2, idempotency_key="second-worker")
    assert second.status_code == 201, second.text
    daily = client.get(base(s, True) + "/processing-daily").json()["items"]
    assert sorted(row["completed_quantity"] for row in daily) == [4, 6]
    outgoing = dispatch(
        client, s, [dict(source_transfer_id=produced["id"], quantity=2, weight=20)], workshop=True
    )
    assert outgoing.status_code == 201, outgoing.text
    assert outgoing.json()["items"][0]["sent_processing_status"] == "complete"
    assert confirm(client, s, outgoing.json()).status_code == 200
    assert client.get(base(s, True) + "/processing-daily").json()["items"] == daily
    assert (
        work(client, s, produced, employee, idempotency_key="duplicate-completed").status_code
        == 409
    )
    filtered = client.get(
        base(s, True) + "/processing-records",
        params={"processor_id": employee["id"], "work_date": "2026-10-15"},
    ).json()
    assert filtered["total"] == 1 and filtered["items"][0]["completed_quantity"] == 6
    with SessionLocal() as db:
        assert db.get(MaterialStockBalance, lot["id"]).on_hand_quantity == 0
        assert len(list(db.scalars(select(MaterialQuantityAdjustment)))) == 2


def test_atomic_replay_stale_stock_and_invalid_person(client, warehouse):
    s = warehouse
    lot, employee = setup_lot(client, s)
    assert work(client, s, lot, employee, processor_employee_id=None).status_code == 422
    foreign = client.get(base(s) + "/employees").json()[0]
    assert work(client, s, lot, foreign).status_code == 422
    assert (
        work(
            client, s, lot, employee, processing_date=(date.today() + timedelta(days=2)).isoformat()
        ).status_code
        == 422
    )
    assert work(client, s, lot, employee, completed_quantity=11).status_code == 422
    first = work(
        client, s, lot, employee, expected_revision=0, completed_quantity=6, completed_weight=60
    )
    assert first.status_code == 201, first.text
    replay = work(
        client,
        s,
        lot,
        employee,
        quantity=10,
        expected_revision=0,
        completed_quantity=6,
        completed_weight=60,
    )
    assert replay.json() == first.json()
    assert (
        work(
            client,
            s,
            lot,
            employee,
            idempotency_key="stale",
            expected_revision=0,
            completed_quantity=10,
            completed_weight=100,
        ).status_code
        == 409
    )
    assert (
        client.get(base(s, True) + "/processing-daily").json()["items"][0]["completed_quantity"]
        == 6
    )


def test_unprocessed_outbound_and_downstream_status_reset(client, warehouse):
    s = warehouse
    lot, employee = setup_lot(client, s)
    sent = dispatch(
        client, s, [dict(source_transfer_id=lot["id"], quantity=3, weight=30)], workshop=True
    )
    assert sent.status_code == 201, sent.text
    assert sent.json()["items"][0]["sent_processing_status"] == "unregistered"
    assert confirm(client, s, sent.json()).status_code == 200
    back = dispatch(
        client,
        s,
        [dict(source_transfer_id=sent.json()["items"][0]["id"], quantity=3, weight=30)],
        idempotency_key="back-again",
    )
    assert back.status_code == 201, back.text
    assert confirm(client, s, back.json(), workshop=True).status_code == 200
    stock = client.get(
        base(s, True) + "/stock", params={"source_ids": str(back.json()["items"][0]["id"])}
    ).json()["items"][0]
    assert stock["processing_state"] == "unregistered"


def test_reallocation_preserves_completed_state_and_does_not_count_again(client, warehouse):
    s = warehouse
    lot, employee = setup_lot(client, s, "FACTORY-QC")
    done = work(client, s, lot, employee).json()["outputs"][0]
    result = client.post(
        base(s, True) + "/serial-reallocations",
        headers=s["other_headers"],
        json=dict(
            source_transfer_id=done["id"],
            serial_no="ORDER-B",
            quantity=10,
            weight=100,
            idempotency_key="reallocate-processed",
        ),
    )
    assert result.status_code == 201, result.text
    inventory = client.get(
        base(s, True) + "/stock", params={"source_ids": str(result.json()["id"])}
    ).json()["items"][0]
    assert inventory["processing_state"] == "complete"
    assert (
        client.get(base(s, True) + "/processing-daily").json()["items"][0]["completed_quantity"]
        == 10
    )


def test_migration_preserves_unknown_history_and_is_repeatable():
    path = Path(__file__).parents[1] / "alembic/versions/20261019_0038_processing_daily.py"
    spec = importlib.util.spec_from_file_location("processing_daily_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as conn:
            conn.exec_driver_sql("CREATE TABLE team_employees (id INTEGER PRIMARY KEY)")
            conn.exec_driver_sql("CREATE TABLE material_transfers (id INTEGER PRIMARY KEY)")
            conn.exec_driver_sql(
                "CREATE TABLE material_quantity_adjustments (id INTEGER PRIMARY KEY, team_id INTEGER, before_quantity INTEGER, after_quantity INTEGER)"
            )
            conn.exec_driver_sql("INSERT INTO material_quantity_adjustments VALUES (1, 2, 1, 100)")
            with Operations.context(MigrationContext.configure(conn)):
                migration.upgrade()
                migration.upgrade()
            assert conn.exec_driver_sql(
                "SELECT before_quantity, after_quantity, processor_employee_id, completed_quantity, processing_date FROM material_quantity_adjustments"
            ).one() == (1, 100, None, None, None)
    finally:
        engine.dispose()


def test_unit_work_cannot_be_hidden_inside_outbound(client, warehouse):
    s = warehouse
    lot, employee = setup_lot(client, s)
    result = dispatch(
        client,
        s,
        [dict(source_transfer_id=lot["id"], quantity=6, weight=60)],
        workshop=True,
        quantity_adjustments=[
            dict(
                source_transfer_id=lot["id"],
                quantity=10,
                expected_revision=0,
                processor_name=employee["name"],
                processor_employee_id=employee["id"],
                processing_date="2026-10-15",
                processing_mode="unit",
                completed_quantity=6,
                completed_weight=60,
            )
        ],
    )
    assert result.status_code == 422
    with SessionLocal() as db:
        assert db.get(MaterialStockBalance, lot["id"]).on_hand_quantity == 10
        assert not list(db.scalars(select(MaterialQuantityAdjustment)))


def test_daily_filters_identity_and_unknown_history(client, warehouse):
    from test_quantity_adjustments import change

    s = warehouse
    lot, employee = setup_lot(client, s)
    first = work(client, s, lot, employee, completed_quantity=6, completed_weight=60).json()
    remaining = first["outputs"][1]
    url = base(s, True)
    assert (
        client.patch(
            f"{url}/employees/{employee['id']}",
            json=dict(name="张师傅（原名）", active=False, expected_version=1),
        ).status_code
        == 200
    )
    new_person = client.post(url + "/employees", json=dict(name=employee["name"])).json()
    assert work(client, s, remaining, new_person, idempotency_key="new-identity").status_code == 201
    report = client.get(
        url + "/processing-daily",
        params=dict(
            date_from="2026-10-15", date_to="2026-10-15", query=lot["serial_no"], page_size=1
        ),
    ).json()
    assert report["total"] == 2 and len(report["items"]) == 1
    assert report["items"][0]["team_id"] == s["other"]["id"]
    row = client.get(url + "/processing-daily", params=dict(processor_id=employee["id"])).json()[
        "items"
    ][0]
    assert row["completed_quantity"] == 6 and row["processor_name"] == "张师傅（原名）"
    assert (
        client.get(url + "/processing-daily", params=dict(date_from="2026-10-16")).json()["total"]
        == 0
    )
    assert (
        client.get(
            url + "/processing-daily", params=dict(date_from="2026-10-16", date_to="2026-10-15")
        ).status_code
        == 422
    )
    detail = client.get(
        url + "/processing-records", params=dict(processor_id=employee["id"])
    ).json()["items"][0]
    assert detail["processor_name"] == employee["name"]
    # A historical recount has no trustworthy actual production date or output.
    old_lot, old_employee = setup_lot(
        client, s, "FACTORY-ROLL", idempotency_key="historical-intake"
    )
    assert (
        change(
            client,
            s,
            old_lot,
            100,
            workshop=True,
            key="historical",
            processor_name=new_person["name"],
        ).status_code
        == 201
    )
    assert client.get(url + "/processing-daily").json()["total"] == 2
    detail = client.get(url + "/processing-records", params=dict(page_size=1)).json()
    assert detail["total"] == 3 and len(detail["items"]) == 1
    assert detail["summary"]["completed_quantity"] == 10
    assert detail["summary"]["record_count"] == 2
    assert detail["summary"]["unreported_count"] == 1
    assert detail["summary"]["employee_day_count"] == 2
    assert {"id": employee["id"], "name": "张师傅（原名）"} in detail["processors"]
    renamed = client.get(url + "/processing-records", params=dict(query="张师傅（原名）")).json()
    assert renamed["summary"]["completed_quantity"] == 6
    assert (
        client.get(url + "/processing-daily", params=dict(query="张师傅（原名）")).json()["items"][
            0
        ]["completed_quantity"]
        == 6
    )


def test_unit_processing_keeps_shared_board_whole_and_counts_worker_once(client, warehouse):
    from test_shared_material import MEMBERS, shared_intake, trace

    s = warehouse
    assert (
        client.patch(f"/api/teams/{s['other']['id']}", json=dict(code="FACTORY-ANNEAL")).status_code
        == 200
    )
    origin = shared_intake(client, s).json()
    sent = dispatch(
        client, s, [dict(source_transfer_id=origin["id"], quantity=1, weight=100)]
    ).json()
    assert confirm(client, s, sent, workshop=True).status_code == 200
    lot = sent["items"][0]
    person = client.get(base(s, True) + "/employees").json()[0]
    result = work(client, s, lot, person)
    assert result.status_code == 201, result.text
    child = result.json()["outputs"][0]
    assert child["shared_unallocated"] and child["quantity"] == 1 and child["weight"] == 100
    for member in MEMBERS:
        daily = client.get(
            base(s, True) + "/processing-daily", params=dict(query=member["serial_no"])
        ).json()
        assert daily["total"] == 1 and daily["items"][0]["completed_quantity"] == 1
        assert trace(client, member["serial_no"])["shared_totals"]["on_hand"]["weight"] == 100
    assert client.get("/api/factory-overview").json()["totals"]["on_hand_weight"] == 100


def test_records_and_export_share_actual_date_reason_and_worker_filters(
    client, warehouse, monkeypatch
):
    from datetime import datetime, timezone

    from app import quantity_adjustments

    # Both entered later; filtering must use the separate actual work date.
    monkeypatch.setattr(
        quantity_adjustments, "utcnow", lambda: datetime(2026, 10, 19, tzinfo=timezone.utc)
    )
    s = warehouse
    lot, employee = setup_lot(client, s)
    first = work(
        client, s, lot, employee, completed_quantity=6, completed_weight=60, reason="夜班补录"
    ).json()
    second = work(
        client,
        s,
        first["outputs"][1],
        employee,
        processing_date="2026-10-16",
        idempotency_key="next-day",
        reason="夜班补录",
    )
    assert second.status_code == 201
    url = base(s, True)
    params = dict(
        date_from="2026-10-15", date_to="2026-10-15", processor_id=employee["id"], query="夜班补录"
    )
    records = client.get(url + "/processing-records", params=params).json()
    grouped = client.get(url + "/processing-daily", params=params).json()
    assert records["total"] == grouped["total"] == 1
    assert records["items"][0]["processing_date"] == "2026-10-15"
    assert (
        records["summary"]["completed_quantity"] == grouped["items"][0]["completed_quantity"] == 6
    )
    assert records["summary"]["completed_weight"] == grouped["items"][0]["completed_weight"] == 60
    assert (
        client.get(url + "/processing-records", params=dict(date_from="2026-10-19")).json()["total"]
        == 0
    )
    assert (
        client.get(url + "/processing-daily", params=dict(work_date="2026-10-16")).json()["items"][
            0
        ]["completed_quantity"]
        == 4
    )
    params["processor_id"] = 999999
    empty = client.get(url + "/processing-records", params=params).json()
    assert (
        empty["total"]
        == empty["summary"]["completed_quantity"]
        == empty["summary"]["employee_day_count"]
        == 0
    )
