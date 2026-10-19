"""Sampling holds physical lots without manufacturing stock or production."""

from datetime import datetime, timezone

import pytest
from app.database import SessionLocal
from app.models import TeamEmployee
from test_material_transfers import _leader, _team
from test_processing_daily import setup_lot, work
from test_warehouse_classification import base, dispatch
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401


@pytest.fixture()
def inspection(client, warehouse):
    s = warehouse
    lot, worker = setup_lot(client, s)
    done = work(client, s, lot, worker)
    assert done.status_code == 201, done.text
    produced = done.json()["outputs"][0]
    qc = _team(client, "FACTORY-QC", "检验")
    _, headers = _leader(client, "qc-leader", qc["id"])
    with SessionLocal() as db:
        person = TeamEmployee(team_id=qc["id"], name="巡检员李师傅")
        db.add(person)
        db.commit()
        person_id = person.id
    context = client.get(base(s, True) + f"/stock/{produced['id']}/quantity-adjustments").json()
    return (
        s,
        produced,
        headers,
        dict(
            source_transfer_id=produced["id"],
            expected_revision=context["revision"],
            inspector_employee_id=person_id,
            checked_at=datetime.now(timezone.utc).isoformat(),
            sample_quantity=5,
            failed_quantity=1,
            idempotency_key="inspection-one",
        ),
    )


def test_failed_sample_holds_whole_lot_and_passing_recheck_releases(client, inspection):
    s, lot, headers, body = inspection
    before = client.get(base(s, True) + "/overview").json()["totals"]
    first = client.post("/api/inspections", headers=headers, json=body)
    assert first.status_code == 201, first.text
    root = first.json()
    assert (
        root["status"] == "pending"
        and root["passed_quantity"] == 4
        and root["batch_quantity"] == 10
    )
    assert client.post("/api/inspections", headers=headers, json=body).json() == root
    overview = client.get(base(s, True) + "/overview").json()
    assert overview["totals"] == {**before, "available_quantity": 0, "available_weight": 0}
    for category in ("materials", "material_types"):
        assert overview[category][0]["on_hand_quantity"] == 10
        assert overview[category][0]["on_hand_weight"] == 100
        assert overview[category][0]["available_quantity"] == 0
        assert overview[category][0]["available_weight"] == 0
    assert client.get(base(s, True) + "/stock?availability=available").json()["total"] == 0
    stock = client.get(base(s, True) + "/stock?availability=all").json()["items"]
    assert (
        next(row for row in stock if row["transfer"]["id"] == lot["id"])["inspection_hold_id"]
        == root["id"]
    )
    group = client.get(base(s, True) + "/inventory").json()["items"][0]
    assert group["inspection_hold_count"] == 1
    lines = [dict(source_transfer_id=lot["id"], quantity=1, weight=10)]
    assert dispatch(client, s, lines, workshop=True).status_code == 409
    reallocation = client.post(
        base(s, True) + "/serial-reallocations",
        headers=s["other_headers"],
        json=dict(
            source_transfer_id=lot["id"],
            serial_no="OTHER",
            quantity=1,
            weight=10,
            idempotency_key="held-reallocate",
        ),
    )
    assert reallocation.status_code == 409
    assert (
        client.post(
            "/api/inspections",
            headers=headers,
            json={**body, "failed_quantity": 0, "idempotency_key": "not-a-recheck"},
        ).status_code
        == 409
    )
    failed = client.post(
        "/api/inspections",
        headers=headers,
        json={**body, "parent_id": root["id"], "idempotency_key": "failed-recheck"},
    )
    assert failed.status_code == 201 and failed.json()["status"] == "failed"
    assert dispatch(client, s, lines, workshop=True).status_code == 409
    passed = client.post(
        "/api/inspections",
        headers=headers,
        json={
            **body,
            "parent_id": root["id"],
            "failed_quantity": 0,
            "idempotency_key": "passing-recheck",
        },
    )
    assert passed.status_code == 201, passed.text
    assert client.get(base(s, True) + "/overview").json()["totals"] == before
    assert client.get("/api/inspections", params={"status": "pending"}).json()["total"] == 0
    assert client.get("/api/inspections", params={"status": "released"}).json()["total"] == 1
    assert client.get("/api/inspections", params={"query": "巡检员李"}).json()["total"] == 3
    assert dispatch(client, s, lines, workshop=True).status_code == 201
    records = client.get(base(s, True) + "/processing-records").json()
    assert records["summary"]["completed_quantity"] == 10 and records["total"] == 1


@pytest.mark.parametrize(
    "change",
    [
        dict(sample_quantity=0),
        dict(sample_quantity=11),
        dict(failed_quantity=6),
        dict(inspector_employee_id=99999),
        dict(expected_revision=999),
        dict(checked_at="2099-01-01T00:00:00Z"),
        dict(checked_at="2026-10-19T00:00:00"),
    ],
)
def test_invalid_inspection_cannot_create_a_hold(client, inspection, change):
    s, lot, headers, body = inspection
    response = client.post("/api/inspections", headers=headers, json={**body, **change})
    assert response.status_code in (422, 409), response.text
    assert client.get("/api/inspections").json()["total"] == 0


def test_only_qc_personnel_and_processed_lots_can_be_inspected(client, inspection):
    s, lot, headers, body = inspection
    assert client.post("/api/inspections", headers=s["other_headers"], json=body).status_code == 403
    assert client.post("/api/inspections", json=body).status_code == 403
    wrong_person = client.get(base(s, True) + "/employees").json()[0]
    assert (
        client.post(
            "/api/inspections",
            headers=headers,
            json={**body, "inspector_employee_id": wrong_person["id"]},
        ).status_code
        == 422
    )
    sources = client.get("/api/inspections/sources", params={"team_id": s["other"]["id"]}).json()
    assert sources["total"] == 1 and sources["items"][0]["source_transfer_id"] == lot["id"]
    assert (
        client.get("/api/inspections/sources", params={"team_id": s["team"]["id"]}).status_code
        == 422
    )


def test_hold_cannot_be_bypassed_and_other_lots_are_unaffected(client, inspection):
    from test_quantity_adjustments import change

    s, lot, headers, body = inspection
    registered = client.post("/api/inspections", headers=headers, json=body)
    assert registered.status_code == 201
    original = registered.json()
    assert original["processing_record_id"] and original["processor_name"]
    assert change(client, s, lot, 20, workshop=True, key="held-count-change").status_code == 409
    fresh, employee = setup_lot(client, s, idempotency_key="another-material")
    allowed = dispatch(
        client,
        s,
        [dict(source_transfer_id=fresh["id"], quantity=1, weight=10)],
        workshop=True,
        idempotency_key="other-out",
    )
    assert allowed.status_code == 201, allowed.text
    # Ordinary incoming, unprocessed stock cannot be claimed as sampled processed work.
    current = client.get(base(s, True) + f"/stock/{fresh['id']}/quantity-adjustments").json()
    denied = client.post(
        "/api/inspections",
        headers=headers,
        json={
            **body,
            "source_transfer_id": fresh["id"],
            "expected_revision": current["revision"],
            "idempotency_key": "unprocessed",
        },
    )
    assert denied.status_code == 422
    assert client.get("/api/inspections").json()["total"] == 1


def test_rechecks_require_current_hold_and_preserve_original_result(client, inspection):
    s, lot, headers, body = inspection
    root = client.post("/api/inspections", headers=headers, json=body).json()
    assert (
        client.post(
            "/api/inspections", headers=headers, json={**body, "failed_quantity": 0}
        ).status_code
        == 409
    )
    assert (
        client.post(
            "/api/inspections",
            headers=headers,
            json={**body, "parent_id": root["id"] + 1, "idempotency_key": "wrong-parent"},
        ).status_code
        == 409
    )
    passing = {
        **body,
        "parent_id": root["id"],
        "failed_quantity": 0,
        "idempotency_key": "release-one",
    }
    released = client.post("/api/inspections", headers=headers, json=passing)
    assert released.status_code == 201
    assert client.post("/api/inspections", headers=headers, json=passing).json() == released.json()
    assert (
        client.post(
            "/api/inspections", headers=headers, json={**passing, "idempotency_key": "stale-repeat"}
        ).status_code
        == 409
    )
    records = client.get("/api/inspections", params={"source_transfer_id": lot["id"]}).json()
    assert records["total"] == 2
    saved = next(r for r in records["items"] if r["id"] == root["id"])
    assert saved["sample_quantity"] == 5 and saved["failed_quantity"] == 1 and saved["released_at"]
    again = client.post(
        "/api/inspections", headers=headers, json={**body, "idempotency_key": "second-hold"}
    )
    assert again.status_code == 201 and again.json()["status"] == "pending"
    assert client.get("/api/inspections", params={"status": "pending"}).json()["total"] == 1


def test_inspection_search_dates_paging_and_deactivated_person(client, inspection):
    from datetime import timedelta

    from app.models import MaterialTransferEvent
    from sqlalchemy import select

    s, lot, headers, body = inspection
    root = client.post("/api/inspections", headers=headers, json=body).json()
    history = client.get(
        "/api/inspections",
        params={
            "team_id": s["other"]["id"],
            "source_transfer_id": lot["id"],
            "inspector_id": body["inspector_employee_id"],
            "query": lot["batch_no"],
            "page_size": 1,
        },
    ).json()
    assert history["total"] == 1 and history["items"][0]["id"] == root["id"]
    assert client.get("/api/inspections", params={"page": 2, "page_size": 1}).json()["items"] == []
    assert client.get("/api/inspections", params={"team_id": s["team"]["id"]}).json()["total"] == 0
    assert client.get("/api/inspections", params={"query": "%"}).json()["total"] == 0
    assert client.get("/api/inspections", params={"date_from": "2099-01-01"}).json()["total"] == 0
    assert (
        client.get(
            "/api/inspections", params={"date_from": "2026-10-02", "date_to": "2026-10-01"}
        ).status_code
        == 422
    )
    earlier = (datetime.fromisoformat(body["checked_at"]) - timedelta(seconds=1)).isoformat()
    assert (
        client.post(
            "/api/inspections",
            headers=headers,
            json={
                **body,
                "parent_id": root["id"],
                "checked_at": earlier,
                "idempotency_key": "before-first",
            },
        ).status_code
        == 422
    )
    with SessionLocal() as db:
        db.get(TeamEmployee, body["inspector_employee_id"]).active = False
        db.commit()
        events = list(
            db.scalars(
                select(MaterialTransferEvent).where(
                    MaterialTransferEvent.transfer_id == lot["id"],
                    MaterialTransferEvent.action == "inspection_recorded",
                )
            )
        )
        assert len(events) == 1 and events[0].changes["inspection"]["after"]["failed"] == 1
    assert (
        client.post(
            "/api/inspections",
            headers=headers,
            json={
                **body,
                "parent_id": root["id"],
                "failed_quantity": 0,
                "idempotency_key": "inactive-inspector",
            },
        ).status_code
        == 422
    )


def test_inspection_migration_matches_model_and_keeps_existing_stock():
    import importlib.util
    from pathlib import Path

    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from app.models import MaterialInspection
    from sqlalchemy import create_engine, inspect

    path = Path(__file__).parents[1] / "alembic/versions/20261019_0039_inspections.py"
    spec = importlib.util.spec_from_file_location("inspection_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as conn:
            for name in (
                "teams",
                "team_employees",
                "users",
                "material_quantity_adjustments",
                "material_transfers",
            ):
                conn.exec_driver_sql(f"CREATE TABLE {name} (id INTEGER PRIMARY KEY)")
            conn.exec_driver_sql("INSERT INTO material_transfers VALUES (1)")
            with Operations.context(MigrationContext.configure(conn)):
                migration.upgrade()
                migration.upgrade()
            schema = inspect(conn)
            assert {c["name"] for c in schema.get_columns("material_inspections")} == set(
                MaterialInspection.__table__.columns.keys()
            )
            assert (
                schema.get_check_constraints("material_inspections")[0]["name"]
                == "ck_inspection_sample"
            )
            assert len(schema.get_foreign_keys("material_inspections")) == 7
            assert conn.exec_driver_sql("SELECT id FROM material_transfers").all() == [(1,)]
    finally:
        engine.dispose()


def test_increasing_pending_order_obeys_hold(client, inspection):
    s, lot, headers, body = inspection
    outgoing = dispatch(
        client,
        s,
        [dict(source_transfer_id=lot["id"], quantity=1, weight=10)],
        workshop=True,
        idempotency_key="before-inspection",
    )
    assert outgoing.status_code == 201
    document = outgoing.json()["items"][0]
    context = client.get(base(s, True) + f"/stock/{lot['id']}/quantity-adjustments").json()
    root = client.post(
        "/api/inspections", headers=headers, json={**body, "expected_revision": context["revision"]}
    )
    assert root.status_code == 201, root.text
    increased = client.patch(
        "/api/material-transfers/" + document["batch_no"],
        headers=s["other_headers"],
        json={"quantity": 2, "weight": 20, "expected_version": document["version"]},
    )
    assert increased.status_code == 409, increased.text


def test_external_shipping_cannot_bypass_a_hold(client, warehouse):
    s = warehouse
    lot, employee = setup_lot(client, s, "FACTORY-QC")
    produced = work(client, s, lot, employee).json()["outputs"][0]
    context = client.get(base(s, True) + f"/stock/{produced['id']}/quantity-adjustments").json()
    response = client.post(
        "/api/inspections",
        headers=s["other_headers"],
        json=dict(
            source_transfer_id=produced["id"],
            expected_revision=context["revision"],
            inspector_employee_id=employee["id"],
            checked_at=datetime.now(timezone.utc).isoformat(),
            sample_quantity=1,
            failed_quantity=1,
            idempotency_key="qc-on-site-check",
        ),
    )
    assert response.status_code == 201, response.text
    external = dispatch(
        client,
        s,
        [dict(source_transfer_id=produced["id"], quantity=1, weight=10)],
        workshop=True,
        idempotency_key="held-external",
        entry_kind="inspection_shipment",
        next_team_id=None,
        external_destination="库房成品",
    )
    assert external.status_code == 409, external.text
    assert (
        client.get(
            base(s, True) + "/stock",
            params={"source_ids": str(produced["id"]), "availability": "all"},
        ).json()["items"][0]["on_hand_quantity"]
        == 10
    )
