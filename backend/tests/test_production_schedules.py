"""Commitments never create stock, and each actual outbound fulfills only one node."""

from datetime import datetime
from uuid import uuid4

from app.database import SessionLocal, engine
from app.models import (
    MaterialStockBalance,
    MaterialTransfer,
    ProductionScheduleDelivery,
    TeamEmployee,
    User,
)
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from test_quantity_adjustments import change, processing_lot
from test_serial_reallocations import reallocate
from test_shared_material import shared_intake
from test_warehouse_classification import confirm, dispatch
from test_warehouse_receipts import intake
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

URL = "/api/production-schedules"


def body(s, lot=None, *, workshop=False, **extra):
    return {
        "idempotency_key": uuid4().hex,
        "serial_no": lot["serial_no"] if lot else "WAREHOUSE-001",
        "team_id": s["other" if workshop else "team"]["id"],
        "next_team_id": s["team" if workshop else "other"]["id"],
        "due_at": "2026-12-20T16:00:00+08:00",
        "target_quantity": 100,
        "sources": [{"source_transfer_id": lot["id"], "quantity": 100}] if lot else [],
        **extra,
    }


def plan(client, s, lot=None, **extra):
    response = client.post(URL, json=body(s, lot, **extra))
    assert response.status_code == 201, response.text
    return response.json()


def get(client, item):
    response = client.get(f"{URL}/{item['id']}")
    assert response.status_code == 200, response.text
    return response.json()


def test_no_stock_created_permissions_hour_precision_versions_and_audit(client, warehouse):
    s = warehouse
    with SessionLocal() as db:
        initial = db.scalar(select(func.count()).select_from(MaterialTransfer))
    assert client.post(URL, headers=s["headers"], json=body(s)).status_code == 403
    assert client.post(URL, json=body(s, due_at="2026-12-20T16:30:00+08:00")).status_code == 422
    assert client.post(URL, json=body(s, due_at="2026-12-20T16:00:00")).status_code == 422
    item = plan(client, s, notes="")
    assert item["dispatched_quantity"] == 0 and item["remaining_quantity"] == 100
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(MaterialTransfer)) == initial
    endpoint = f"{URL}/{item['id']}"
    assert client.get(endpoint, headers=s["other_headers"]).status_code == 200
    updated = {**body(s), "expected_version": 1, "due_at": "2026-12-21T17:00:00+08:00"}
    assert client.patch(endpoint, headers=s["headers"], json=updated).status_code == 403
    result = client.patch(endpoint, json=updated)
    assert result.status_code == 200, result.text
    assert result.json()["version"] == 2
    assert result.json()["history"][0]["before"]["due_at"] == "2026-12-20T08:00:00+00:00"
    assert client.patch(endpoint, json=updated).status_code == 409
    assert (
        client.post(
            endpoint + "/cancel", json={"expected_version": 2, "reason": "客户调整"}
        ).status_code
        == 200
    )
    assert get(client, item)["status"] == "cancelled"
    assert client.get(URL, params={"status": "cancelled"}).json()["total"] == 1


def test_actual_transfer_counts_before_receipt_receipt_is_separate_and_void_reverses(
    client, warehouse
):
    s = warehouse
    lot = intake(client, s).json()
    item = plan(client, s, lot)
    assert item["history"][0]["after"]["sources"][0]["batch_no"] == lot["batch_no"]
    response = dispatch(client, s, [{"source_transfer_id": lot["id"], "quantity": 40, "weight": 4}])
    assert response.status_code == 201, response.text
    sent = response.json()
    progress = get(client, item)
    assert (
        progress["dispatched_quantity"],
        progress["remaining_quantity"],
        progress["received_quantity"],
    ) == (40, 60, 0)
    assert progress["deliveries"][0]["transferred_at"] is not None
    assert confirm(client, s, sent, workshop=True).status_code == 200
    progress = get(client, item)
    assert progress["dispatched_quantity"] == progress["received_quantity"] == 40
    assert progress["deliveries"][0]["received_at"] is not None
    second = dispatch(
        client,
        s,
        [{"source_transfer_id": lot["id"], "quantity": 60, "weight": 6}],
        idempotency_key="second",
    ).json()
    assert get(client, item)["status"] == "not_assessed"
    endpoint = "/api/material-transfers/" + second["items"][0]["batch_no"]
    assert client.delete(endpoint, headers=s["headers"]).status_code == 204
    progress = get(client, item)
    assert progress["remaining_quantity"] == 60 and progress["dispatched_quantity"] == 40


def test_no_retroactive_or_same_serial_unrelated_batch_attribution(client, warehouse):
    s = warehouse
    lot = intake(client, s).json()
    old = dispatch(client, s, [{"source_transfer_id": lot["id"], "quantity": 10, "weight": 1}])
    assert old.status_code == 201
    item = plan(client, s, lot)
    other = intake(client, s, idempotency_key="another").json()
    response = dispatch(
        client,
        s,
        [{"source_transfer_id": other["id"], "quantity": 10, "weight": 1}],
        idempotency_key="unrelated",
    )
    assert response.status_code == 201
    assert get(client, item)["dispatched_quantity"] == 0


def test_same_lot_multiple_deadlines_require_explicit_assignment_and_retry_is_unique(
    client, warehouse
):
    s = warehouse
    lot = intake(client, s).json()
    first = plan(
        client,
        s,
        lot,
        target_quantity=40,
        sources=[{"source_transfer_id": lot["id"], "quantity": 40}],
    )
    second = plan(
        client,
        s,
        lot,
        target_quantity=60,
        sources=[{"source_transfer_id": lot["id"], "quantity": 60}],
        due_at="2026-12-21T16:00:00+08:00",
    )
    line = {"source_transfer_id": lot["id"], "quantity": 40, "weight": 4}
    assert dispatch(client, s, [line]).status_code == 422
    with SessionLocal() as db:
        assert db.get(MaterialStockBalance, lot["id"]).on_hand_quantity == 100
    response = dispatch(client, s, [{**line, "production_schedule_id": first["id"]}])
    assert response.status_code == 201, response.text
    assert (
        dispatch(client, s, [{**line, "production_schedule_id": first["id"]}]).json()
        == response.json()
    )
    assert get(client, first)["dispatched_quantity"] == 40
    assert get(client, second)["dispatched_quantity"] == 0
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(ProductionScheduleDelivery)) == 1


def test_predecessor_receipt_processing_split_and_return_visit_are_distinct(client, warehouse):
    s = warehouse
    origin = intake(client, s, quantity=1, weight=100).json()
    first = plan(
        client,
        s,
        origin,
        target_quantity=1,
        sources=[{"source_transfer_id": origin["id"], "quantity": 1}],
    )
    middle = plan(client, s, workshop=True, predecessor_id=first["id"], target_quantity=20)
    last = plan(client, s, predecessor_id=middle["id"], sequence_no=2, target_quantity=20)
    sent = dispatch(
        client, s, [{"source_transfer_id": origin["id"], "quantity": 1, "weight": 100}]
    ).json()
    assert confirm(client, s, sent, workshop=True).status_code == 200
    lot = sent["items"][0]
    inherited = get(client, middle)
    assert inherited["linked_batches"][0]["source_transfer_id"] == lot["id"]
    assert inherited["linked_batches"][0]["quantity"] == 1
    assert inherited["target_quantity"] == 20 and inherited["sources"] == []
    result = change(
        client,
        s,
        lot,
        20,
        workshop=True,
        processing_status="complete",
        outputs=[
            {"role": "produced", "quantity": 20, "weight": 95, "material_type": "semi_finished"},
            {"role": "scrap", "quantity": 0, "weight": 5, "material_type": "scrap_chips"},
        ],
    )
    assert result.status_code == 201, result.text
    produced, scrap = result.json()["outputs"]
    options = client.get(
        URL + "/source-options",
        params={
            "team_id": s["other"]["id"],
            "serial_no": lot["serial_no"],
            "schedule_id": middle["id"],
        },
    )
    assert options.status_code == 200, options.text
    assert [row["source_transfer_id"] for row in options.json()["items"]] == [produced["id"]]
    outbound = dispatch(
        client,
        s,
        [
            {"source_transfer_id": produced["id"], "quantity": 20, "weight": 95},
            {"source_transfer_id": scrap["id"], "quantity": 0, "weight": 5},
        ],
        workshop=True,
    )
    assert outbound.status_code == 201, outbound.text
    progress = get(client, middle)
    assert progress["dispatched_quantity"] == 20 and progress["dispatched_weight"] == 95
    assert len(progress["deliveries"]) == 1
    assert get(client, first)["dispatched_quantity"] == 1
    assert get(client, last)["dispatched_quantity"] == 0
    assert confirm(client, s, outbound.json()).status_code == 200
    returned = outbound.json()["items"][0]
    final = dispatch(
        client,
        s,
        [{"source_transfer_id": returned["id"], "quantity": 20, "weight": 95}],
        idempotency_key="return-visit",
    )
    assert final.status_code == 201, final.text
    assert get(client, last)["dispatched_quantity"] == 20
    assert get(client, first)["dispatched_quantity"] == 1


def test_create_retry_does_not_duplicate_and_allocations_cannot_exceed_node_target(
    client, warehouse
):
    s = warehouse
    lot = intake(client, s).json()
    payload = body(s, lot)
    first = client.post(URL, json=payload)
    assert first.status_code == 201, first.text
    assert client.post(URL, json=payload).json() == first.json()
    assert client.post(URL, json={**payload, "target_quantity": 101}).status_code == 409
    assert client.post(URL, json=body(s, lot, target_quantity=99)).status_code == 422
    assert (
        client.post(URL, json=body(s, lot, target_quantity=None, target_weight=10)).status_code
        == 422
    )
    assert client.get(URL).json()["total"] == 1
    assert client.get(URL, params={"query": lot["batch_no"]}).json()["total"] == 1


def test_reallocation_changes_serial_and_requires_separate_schedule_binding(client, warehouse):
    s = warehouse
    lot = intake(client, s, quantity=100, weight=20).json()
    original = plan(client, s, lot)
    response = reallocate(client, s, lot)
    assert response.status_code == 201, response.text
    moved = response.json()
    wrong = dispatch(
        client,
        s,
        [
            {
                "source_transfer_id": moved["id"],
                "quantity": 10,
                "weight": 2,
                "production_schedule_id": original["id"],
            }
        ],
    )
    assert wrong.status_code == 422
    target = plan(
        client,
        s,
        moved,
        target_quantity=30,
        sources=[{"source_transfer_id": moved["id"], "quantity": 30}],
    )
    sent = dispatch(client, s, [{"source_transfer_id": moved["id"], "quantity": 10, "weight": 2}])
    assert sent.status_code == 201, sent.text
    assert get(client, original)["dispatched_quantity"] == 0
    assert get(client, target)["dispatched_quantity"] == 10


def test_warehouse_in_transit_inventory_shows_progress_without_assessment(client, warehouse):
    s = warehouse
    lot = intake(client, s, weight=10).json()
    item = plan(client, s, lot)
    assert (
        dispatch(
            client, s, [{"source_transfer_id": lot["id"], "quantity": 100, "weight": 10}]
        ).status_code
        == 201
    )
    response = client.post(
        URL + "/inventory",
        json={
            "team_id": s["team"]["id"],
            "group_ids": [lot["id"]],
            "source_transfer_ids": [lot["id"]],
        },
    )
    assert response.status_code == 200, response.text
    for summary in response.json()["groups"] + response.json()["sources"]:
        assert summary["count"] == 1 and summary["status"] == "not_assessed"
        assert summary["items"][0]["id"] == item["id"]
        assert summary["items"][0]["received_quantity"] == 0


def test_schedule_mutations_notify_teams_and_protect_planned_team_identity(client, warehouse):
    from app.inventory_events import inventory_events
    from test_material_transfers import _team

    s = warehouse
    team = _team(client, "PLAN-ONLY", "计划班组")
    before = inventory_events.revision
    item = plan(client, s, team_id=team["id"])
    assert inventory_events.revision > before
    assert client.delete(f"/api/teams/{team['id']}").status_code == 409
    assert client.patch(f"/api/teams/{team['id']}", json={"code": "CHANGED"}).status_code == 409
    before = inventory_events.revision
    assert (
        client.post(f"{URL}/{item['id']}/cancel", json={"expected_version": 1}).status_code == 200
    )
    assert inventory_events.revision > before


def test_dispatch_rechecks_assignment_after_administrator_changes_it(client, warehouse):
    from types import SimpleNamespace

    import pytest
    from app.models import ProductionSchedule, ProductionScheduleSource
    from app.production_schedules import associate_dispatch
    from fastapi import HTTPException
    from sqlalchemy import delete

    s = warehouse
    lot = intake(client, s).json()
    item = plan(client, s, lot)
    payload = SimpleNamespace(
        next_team_id=s["other"]["id"],
        external_destination=None,
        lines=[SimpleNamespace(production_schedule_id=item["id"])],
    )
    transfer = SimpleNamespace(
        id=99999,
        serial_no=lot["serial_no"],
        source_transfer_id=lot["id"],
        material_type="semi_finished",
        shared_unallocated=False,
    )
    with SessionLocal() as stale:
        assert stale.get(ProductionSchedule, item["id"]).next_team_id == s["other"]["id"]
        assert stale.get(ProductionScheduleSource, (item["id"], lot["id"])) is not None
        with SessionLocal.begin() as other:
            other.execute(
                delete(ProductionScheduleSource).where(
                    ProductionScheduleSource.schedule_id == item["id"]
                )
            )
        with pytest.raises(HTTPException) as error:
            associate_dispatch(stale, s["team"]["id"], payload, [transfer])
        assert error.value.status_code == 422
        stale.rollback()


def test_external_shipment_counts_only_dispatched_and_keeps_initial_deadline(client, warehouse):
    s = warehouse
    lot = intake(client, s).json()
    payload = body(s, lot, next_team_id=None, external_destination="库房成品")
    response = client.post(URL, json=payload)
    assert response.status_code == 201, response.text
    item = response.json()
    result = dispatch(
        client,
        s,
        [{"source_transfer_id": lot["id"], "quantity": 100, "weight": 10}],
        next_team_id=None,
        entry_kind="warehouse_outbound",
        external_destination="库房成品",
    )
    assert result.status_code == 201, result.text
    assert get(client, item)["dispatched_quantity"] == 100
    transfer = result.json()["items"][0]
    with SessionLocal.begin() as db:
        old = db.get(MaterialTransfer, transfer["id"])
        old.status = "pending"
        old.dispatched_at = None
    assert get(client, item)["dispatched_quantity"] == 0
    updated = client.patch(
        f"{URL}/{item['id']}",
        json={**payload, "expected_version": 1, "due_at": "2026-12-25T16:00:00+08:00"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["initial_due_at"] == item["due_at"]
    assert updated.json()["due_at"] != item["due_at"]


def test_inventory_bulk_matches_batches_and_waste_is_inapplicable_defective_remains_schedulable(
    client, warehouse
):
    s = warehouse
    lot = intake(client, s).json()
    waste = intake(client, s, material_type="waste", idempotency_key="waste").json()
    bad = intake(client, s, material_type="defective", idempotency_key="bad").json()
    assert client.post(URL, json=body(s, waste)).status_code == 422
    plan(client, s, bad)
    item = plan(client, s, lot)
    response = client.post(
        URL + "/inventory",
        json={
            "team_id": s["team"]["id"],
            "group_ids": [lot["id"], waste["id"]],
            "source_transfer_ids": [lot["id"], waste["id"], bad["id"]],
        },
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["groups"][0]["items"][0]["id"] == item["id"]
    assert result["groups"][1]["status"] == "not_applicable"
    assert result["sources"][2]["count"] == 1
    options = client.get(
        URL + "/source-options", params={"team_id": s["team"]["id"], "serial_no": lot["serial_no"]}
    )
    assert options.status_code == 200, options.text
    assert {entry["source_transfer_id"] for entry in options.json()["items"]} == {
        lot["id"],
        bad["id"],
    }


def test_status_filter_uses_hour_deadline_and_actual_completion_not_late_receipt(
    client, warehouse, monkeypatch
):
    from app import production_schedules

    s = warehouse
    now = datetime(2026, 10, 22, 6)
    monkeypatch.setattr(production_schedules, "utcnow", lambda: now)
    overdue = plan(client, s, workshop=True, due_at="2026-10-22T12:00:00+08:00")
    today = plan(client, s, workshop=True, due_at="2026-10-22T16:00:00+08:00")
    future = plan(client, s, workshop=True, due_at="2026-10-23T16:00:00+08:00")
    for state, item in (("overdue", overdue), ("today", today), ("pending", future)):
        response = client.get(URL, params={"status": state, "page_size": 1})
        assert response.status_code == 200, response.text
        assert response.json()["total"] == 1 and response.json()["items"][0]["id"] == item["id"]
    lot = processing_lot(client, s)
    assert (
        change(client, s, lot, 100, workshop=True, processing_status="complete").status_code == 201
    )
    item = plan(client, s, lot, workshop=True, due_at="2026-10-22T12:00:00+08:00")
    sent = dispatch(
        client, s, [{"source_transfer_id": lot["id"], "quantity": 100, "weight": 10}], workshop=True
    ).json()
    transfer_id = sent["items"][0]["id"]
    with SessionLocal.begin() as db:
        transfer = db.get(MaterialTransfer, transfer_id)
        transfer.created_at = datetime(2026, 10, 22, 3)  # 11:00, before noon deadline.
    assert get(client, item)["status"] == "completed"
    assert confirm(client, s, sent).status_code == 200
    assert get(client, item)["status"] == "completed"
    with SessionLocal.begin() as db:
        db.get(MaterialTransfer, transfer_id).created_at = datetime(2026, 10, 22, 5)
    assert get(client, item)["status"] == "completed_late"


def test_shared_unallocated_not_attached_and_allocated_serials_do_not_cross(client, warehouse):
    s = warehouse
    lot = shared_intake(client, s).json()
    assert client.post(URL, json=body(s, lot)).status_code == 422
    a = plan(client, s, serial_no="ORDER-A")
    b = plan(client, s, serial_no="ORDER-B")
    sent = dispatch(client, s, [{"source_transfer_id": lot["id"], "quantity": 1, "weight": 100}])
    assert sent.status_code == 201
    assert get(client, a)["dispatched_quantity"] == get(client, b)["dispatched_quantity"] == 0


def test_predecessor_cycle_rejected_and_actual_identity_cannot_change(client, warehouse):
    s = warehouse
    lot = intake(client, s).json()
    first = plan(client, s, lot)
    second = plan(client, s, workshop=True, predecessor_id=first["id"])
    invalid = {**body(s, lot), "predecessor_id": second["id"], "expected_version": 1}
    assert client.patch(f"{URL}/{first['id']}", json=invalid).status_code == 422
    assert (
        dispatch(
            client, s, [{"source_transfer_id": lot["id"], "quantity": 10, "weight": 1}]
        ).status_code
        == 201
    )
    invalid = {**body(s, lot), "serial_no": "OTHER", "expected_version": 1}
    assert client.patch(f"{URL}/{first['id']}", json=invalid).status_code == 409


def test_full_business_reset_deletes_schedule_dependencies_and_preserves_people(client, warehouse):
    from app.reset_business_data import business_counts, reset_business_data

    lot = intake(client, warehouse).json()
    first = plan(client, warehouse, lot)
    plan(client, warehouse, workshop=True, predecessor_id=first["id"])
    response = dispatch(
        client, warehouse, [{"source_transfer_id": lot["id"], "quantity": 10, "weight": 1}]
    )
    assert response.status_code == 201, response.text
    users = select(User.id, User.username, User.password_hash, User.team_id).order_by(User.id)
    employees = select(TeamEmployee.id, TeamEmployee.name, TeamEmployee.team_id).order_by(
        TeamEmployee.id
    )
    with engine.connect() as connection, Session(bind=connection) as db:
        people_before = (list(db.execute(users)), list(db.execute(employees)))
        previous = connection.exec_driver_sql("PRAGMA foreign_keys").scalar()
        db.commit()
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        connection.commit()
        try:
            removed = reset_business_data(db)
            assert removed["production_schedules"] == 2
            assert removed["production_schedule_sources"] == 1
            assert removed["production_schedule_deliveries"] == 1
            assert removed["production_schedule_events"] == 2
            assert all(count == 0 for count in business_counts(db).values())
            assert (list(db.execute(users)), list(db.execute(employees))) == people_before
        finally:
            db.rollback()
            connection.exec_driver_sql(f"PRAGMA foreign_keys={int(previous)}")
            connection.commit()
