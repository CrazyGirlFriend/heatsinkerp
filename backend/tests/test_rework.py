"""Rework effort is auditable without multiplying physical inventory or first output."""

from datetime import datetime, timezone

import pytest
from test_inspections import inspection as inspection  # noqa: F401
from test_processing_daily import setup_lot, work
from test_warehouse_classification import base, dispatch
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401


def test_one_piece_three_reworks_counts_effort_not_three_new_pieces(client, warehouse):
    s = warehouse
    lot, worker = setup_lot(client, s, quantity=1)
    original = work(client, s, lot, worker).json()
    current = original["outputs"][0]
    prior = original
    for round in range(1, 4):
        result = work(
            client,
            s,
            current,
            worker,
            work_kind="rework",
            rework_of_id=prior["id"],
            idempotency_key=f"rework-{round}",
        )
        assert result.status_code == 201, result.text
        prior = result.json()
        assert prior["rework_round"] == round
        current = prior["outputs"][0]
        totals = client.get(base(s, True) + "/overview").json()["totals"]
        assert totals["on_hand_quantity"] == 1 and totals["on_hand_weight"] == 100
    records = client.get(base(s, True) + "/processing-records").json()
    assert records["total"] == 4
    summary = records["summary"]
    assert (
        summary["completed_quantity"],
        summary["rework_quantity"],
        summary["work_quantity"],
    ) == (1, 3, 4)
    assert summary["completed_weight"] == 100 and summary["rework_weight"] == 300
    daily = client.get(base(s, True) + "/processing-daily").json()["items"][0]
    assert (daily["completed_quantity"], daily["rework_quantity"], daily["work_quantity"]) == (
        1,
        3,
        4,
    )
    filtered = client.get(base(s, True) + "/processing-records?work_kind=rework").json()
    assert filtered["total"] == 3 and filtered["summary"]["completed_quantity"] == 0
    candidates = client.get(
        base(s, True) + f"/processing-stock?rework_record_id={original['id']}"
    ).json()
    assert candidates["total"] == 1 and candidates["items"][0]["transfer"]["id"] == current["id"]
    trace = client.get("/api/material-trace", params={"serial_no": lot["serial_no"]}).json()
    assert trace["totals"]["on_hand"]["quantity"] == 1
    assert next(row for row in trace["items"] if row["id"] == current["id"])["rework_count"] == 3


def test_partial_rework_keeps_remaining_as_rework_not_initial_output(client, warehouse):
    s = warehouse
    lot, worker = setup_lot(client, s)
    first = work(client, s, lot, worker).json()["outputs"][0]
    response = work(
        client,
        s,
        first,
        worker,
        work_kind="rework",
        completed_quantity=4,
        completed_weight=40,
        idempotency_key="partial-rework",
    )
    assert response.status_code == 201, response.text
    done, remaining = response.json()["outputs"]
    pending = client.get(base(s, True) + "/inventory?rework=pending").json()
    assert pending["total"] == 1 and pending["items"][0]["on_hand_quantity"] == 6
    assert pending["items"][0]["processing_registered_quantity"] == 0
    assert pending["items"][0]["processing_unregistered_quantity"] == 6
    assert work(client, s, remaining, worker, idempotency_key="wrong-initial").status_code == 422
    finish = work(client, s, remaining, worker, work_kind="rework", idempotency_key="finish-rework")
    assert finish.status_code == 201, finish.text
    summary = client.get(base(s, True) + "/processing-records").json()["summary"]
    assert summary["completed_quantity"] == 10 and summary["rework_quantity"] == 10
    totals = client.get(base(s, True) + "/overview").json()["totals"]
    assert totals["on_hand_quantity"] == 10 and totals["on_hand_weight"] == 100


def test_historical_hold_survives_rework_and_recheck_until_manual_release(client, inspection):
    s, lot, headers, body = inspection
    hold = client.post("/api/inspections", headers=headers, json=body).json()
    from app.database import SessionLocal
    from app.models import MaterialInspection

    with SessionLocal() as db:
        db.get(MaterialInspection, hold["id"]).blocks_outbound = True
        db.commit()
    worker = client.get(base(s, True) + "/employees").json()[0]
    result = work(client, s, lot, worker, work_kind="rework", idempotency_key="held-rework")
    assert result.status_code == 201, result.text
    child = result.json()["outputs"][0]
    detail = client.get(
        base(s, True) + "/stock", params={"query": child["batch_no"], "availability": "all"}
    ).json()
    held_stock = next(row for row in detail["items"] if row["transfer"]["id"] == child["id"])
    assert held_stock["on_hand_quantity"] == 10 and held_stock["available_quantity"] == 0
    assert held_stock["on_hand_weight"] == 100 and held_stock["available_weight"] == 0
    lines = [dict(source_transfer_id=child["id"], quantity=1, weight=10)]
    assert dispatch(client, s, lines, workshop=True).status_code == 409
    trace = client.get("/api/material-trace", params={"serial_no": child["batch_no"]}).json()
    selected = next(row for row in trace["items"] if row["id"] == child["id"])
    assert selected["inspection_status"] == "held" and selected["inspection_hold_id"] == hold["id"]
    context = client.get(base(s, True) + f"/stock/{child['id']}/quantity-adjustments").json()
    assert context["quantity"] == 10
    recheck = client.post(
        "/api/inspections",
        headers=headers,
        json={
            **body,
            "parent_id": hold["id"],
            "source_transfer_id": child["id"],
            "involved_team_ids": [],
            "failed_quantity": 0,
            "problem_type_ids": [],
            "expected_revision": context["revision"],
            "idempotency_key": "root-pass",
            "checked_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    assert recheck.status_code == 201, recheck.text
    history = client.get("/api/inspections", params={"source_transfer_id": child["id"]})
    assert history.status_code == 200, history.text
    assert {row["id"] for row in history.json()["items"]} == {hold["id"], recheck.json()["id"]}
    sources = client.get(
        "/api/inspections/sources",
        params={"team_id": s["other"]["id"], "recheck_id": hold["id"]},
    ).json()
    assert [row["source_transfer_id"] for row in sources["items"]] == [child["id"]]
    assert dispatch(client, s, lines, workshop=True).status_code == 409
    released = client.post(
        f"/api/quality-feedback/{hold['id']}/decision",
        headers=headers,
        json=dict(
            expected_version=0,
            disposition="rework",
            status="closed",
            involved_team_ids=[s["other"]["id"]],
            release_legacy_hold=True,
            idempotency_key="manual-release",
        ),
    )
    assert released.status_code == 200, released.text
    assert dispatch(client, s, lines, workshop=True).status_code == 201
    trace = client.get("/api/material-trace", params={"serial_no": child["batch_no"]}).json()
    assert (
        next(row for row in trace["items"] if row["id"] == child["id"])["inspection_status"]
        == "passed"
    )


def test_rework_rejects_raw_stock_wrong_history_and_duplicate_registration(client, warehouse):
    s = warehouse
    lot, worker = setup_lot(client, s)
    assert work(client, s, lot, worker, work_kind="rework").status_code == 409
    original = work(client, s, lot, worker).json()
    source = original["outputs"][0]
    assert (
        work(
            client,
            s,
            source,
            worker,
            work_kind="rework",
            rework_of_id=9999,
            idempotency_key="wrong-ref",
        ).status_code
        == 409
    )
    context = client.get(base(s, True) + f"/stock/{source['id']}/quantity-adjustments").json()
    args = dict(
        work_kind="rework",
        quantity=10,
        completed_quantity=10,
        completed_weight=100,
        expected_revision=context["revision"],
        idempotency_key="replay",
    )
    first = work(client, s, source, worker, **args)
    assert first.status_code == 201, first.text
    assert work(client, s, source, worker, **args).json() == first.json()
    args["idempotency_key"] = "stale-new"
    assert work(client, s, source, worker, **args).status_code == 409


@pytest.mark.parametrize("code", ["FACTORY-ROLL", "FACTORY-WIRE", "FACTORY-ENGRAVE"])
def test_split_rework_records_actual_output_and_scrap_without_recounting_initial(
    client, warehouse, code
):
    s = warehouse
    lot, worker = setup_lot(client, s, code=code, quantity=1)
    original = work(
        client,
        s,
        lot,
        worker,
        quantity=10,
        input_quantity=1,
        outputs=[dict(role="produced", quantity=10, weight=100, material_type="semi_finished")],
    ).json()
    produced = original["outputs"][0]
    result = work(
        client,
        s,
        produced,
        worker,
        work_kind="rework",
        quantity=20,
        input_quantity=10,
        outputs=[
            dict(role="produced", quantity=20, weight=99, material_type="semi_finished"),
            dict(role="scrap", quantity=0, weight=1, material_type="scrap_chips"),
        ],
        idempotency_key="split-rework",
    )
    assert result.status_code == 201, result.text
    summary = client.get(base(s, True) + "/processing-records").json()["summary"]
    assert (
        summary["completed_quantity"] == 10
        and summary["rework_quantity"] == 20
        and summary["scrap_weight"] == 1
    )
    totals = client.get(base(s, True) + "/overview").json()["totals"]
    assert totals["on_hand_weight"] == 100 and totals["on_hand_quantity"] == 20


def test_return_from_another_team_keeps_original_work_and_marks_pending_rework(client, warehouse):
    from receipt_helpers import receipt_post
    from sender_helpers import sender_post
    from test_material_transfers import _leader, _team

    s = warehouse
    lot, worker = setup_lot(client, s)
    original = work(client, s, lot, worker).json()
    produced = original["outputs"][0]
    target = _team(client, "FACTORY-GRIND", "研磨返工测试")
    _, target_headers = _leader(client, "rework-grind", target["id"])
    outgoing = sender_post(
        client,
        base(s, True) + "/dispatches",
        headers=s["other_headers"],
        json=dict(
            next_team_id=target["id"],
            idempotency_key="to-grind",
            lines=[dict(source_transfer_id=produced["id"], quantity=10, weight=100)],
        ),
    )
    assert outgoing.status_code == 201, outgoing.text
    moved = outgoing.json()["items"][0]
    assert (
        receipt_post(
            client,
            f"/api/material-transfers/{moved['batch_no']}/confirm",
            headers=target_headers,
            json={"idempotency_key": "receive-grind"},
        ).status_code
        == 200
    )
    # The downstream team has also worked this piece before returning it.
    # Rework in the original team must still link that team's operation.
    downstream_worker = client.post(
        f"/api/team-materials/{target['id']}/employees", json={"name": "研磨员工"}
    ).json()
    downstream = work(
        client,
        {**s, "other": target, "other_headers": target_headers},
        moved,
        downstream_worker,
        idempotency_key="downstream-work",
    )
    assert downstream.status_code == 201, downstream.text
    moved = downstream.json()["outputs"][0]
    returned = sender_post(
        client,
        f"/api/team-materials/{target['id']}/dispatches",
        headers=target_headers,
        json=dict(
            next_team_id=s["other"]["id"],
            rework_return=True,
            idempotency_key="back-rework",
            lines=[dict(source_transfer_id=moved["id"], quantity=10, weight=100)],
        ),
    )
    assert returned.status_code == 201, returned.text
    back = returned.json()["items"][0]
    assert back["rework_pending"] is True
    assert (
        receipt_post(
            client,
            f"/api/material-transfers/{back['batch_no']}/confirm",
            headers=s["other_headers"],
            json={"idempotency_key": "back-receive"},
        ).status_code
        == 200
    )
    assert work(client, s, back, worker, idempotency_key="incorrect-initial").status_code == 422
    done = work(client, s, back, worker, work_kind="rework", idempotency_key="back-done")
    assert done.status_code == 201, done.text
    assert done.json()["rework_of_id"] == original["id"]
    assert client.get(base(s, True) + "/inventory?rework=worked").json()["total"] == 1
    assert (
        client.get(base(s, True) + "/processing-records").json()["summary"]["completed_quantity"]
        == 10
    )


def test_migration_keeps_old_rows_and_is_repeatable():
    import importlib.util
    from pathlib import Path

    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import create_engine, inspect

    engine = create_engine("sqlite://")
    try:
        with engine.begin() as conn:
            for table in (
                "teams",
                "team_employees",
                "users",
                "material_transfers",
                "material_quantity_adjustments",
            ):
                conn.exec_driver_sql(f"CREATE TABLE {table} (id INTEGER PRIMARY KEY)")
            conn.exec_driver_sql(
                "CREATE TABLE material_transfer_events (id INTEGER PRIMARY KEY, action VARCHAR(16) NOT NULL)"
            )
            conn.exec_driver_sql("INSERT INTO material_transfers VALUES (1)")
            conn.exec_driver_sql("INSERT INTO material_quantity_adjustments VALUES (1)")
            conn.exec_driver_sql("INSERT INTO material_transfer_events VALUES (1, 'created')")
            for name in ("20261019_0039_inspections", "20261019_0040_rework"):
                path = Path(__file__).parents[1] / "alembic" / "versions" / (name + ".py")
                spec = importlib.util.spec_from_file_location(name, path)
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                with Operations.context(MigrationContext.configure(conn)):
                    module.upgrade()
                    module.upgrade()
            assert conn.exec_driver_sql(
                "SELECT work_kind, rework_round FROM material_quantity_adjustments"
            ).one() == ("initial", 0)
            assert conn.exec_driver_sql(
                "SELECT rework_pending, rework_count FROM material_transfers"
            ).one() == (0, 0)
            assert inspect(conn).get_columns("material_transfer_events")[1]["type"].length == 32
            assert any(
                fk["constrained_columns"] == ["rework_of_id"]
                for fk in inspect(conn).get_foreign_keys("material_quantity_adjustments")
            )
    finally:
        engine.dispose()
