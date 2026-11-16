"""Administrators execute business workflows with their own audit identity."""

import pytest
from app.database import SessionLocal
from app.models import MaterialQuantityAdjustment, ProcessRoute
from sender_helpers import sending_employee_id
from test_engineering_team import engineering as engineering  # noqa: F401
from test_inspections import create_check, decide
from test_inspections import inspection as inspection  # noqa: F401
from test_material_transfers import _create, _setup_three_teams
from test_process_route_creation import manual, upload
from test_processing_daily import work
from test_team_business import open_payload
from test_transfer_amendments import handoff as handoff  # noqa: F401
from test_transfer_amendments import request as request_amendment
from test_warehouse_classification import base, confirm, dispatch
from test_warehouse_receipts import intake
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

pytestmark = pytest.mark.usefixtures("legacy_stock")
URL = "/api/process-routes"


def test_admin_creates_updates_publishes_and_revises_engineering(client, warehouse, engineering):
    admin = client.get("/api/auth/me").json()
    actor = {**engineering, "headers": dict(client.headers)}
    route = manual(client, warehouse, actor)
    drawing = upload(client, route, actor)
    assert drawing.status_code == 201, drawing.text
    route = drawing.json()
    write = {key: route[key] for key in ("title", "version", "serial_nos", "steps", "review_note")}
    write.update(title="管理员维护工艺", engineering_employee_id=engineering["people"][0]["id"])
    saved = client.put(f"{URL}/{route['id']}", json=write)
    assert saved.status_code == 200, saved.text
    published = client.post(
        f"{URL}/{route['id']}/publish",
        json={"version": saved.json()["version"], "confirmed_imports": True},
    )
    assert published.status_code == 200, published.text
    revised = client.post(
        f"{URL}/{route['id']}/revise", json={"version": published.json()["version"]}
    )
    assert revised.status_code == 201, revised.text
    with SessionLocal() as db:
        assert db.get(ProcessRoute, route["id"]).created_by_user_id == admin["id"]
    assert revised.json()["parent_id"] == route["id"]


def test_admin_intake_handoff_processing_and_rework_keep_team_and_actor(client, warehouse):
    admin = client.get("/api/auth/me").json()
    setup = {**warehouse, "headers": dict(client.headers), "other_headers": dict(client.headers)}
    assert (
        client.patch(
            f"/api/teams/{warehouse['other']['id']}", json={"code": "FACTORY-ANNEAL"}
        ).status_code
        == 200
    )
    origin = intake(client, setup, quantity=10, weight=100)
    assert origin.status_code == 201, origin.text
    sent = dispatch(
        client, setup, [{"source_transfer_id": origin.json()["id"], "quantity": 10, "weight": 100}]
    )
    assert sent.status_code == 201, sent.text
    received = confirm(client, setup, sent.json(), workshop=True)
    assert received.status_code == 200, received.text
    lot = sent.json()["items"][0]
    employee = client.get(base(setup, True) + "/employees").json()[0]
    done = work(client, setup, lot, employee)
    assert done.status_code == 201, done.text
    with SessionLocal() as db:
        record = db.get(MaterialQuantityAdjustment, done.json()["id"])
        assert record.created_by_user_id == admin["id"]
        assert record.team_id == warehouse["other"]["id"]
    produced = done.json()["outputs"][0]
    context = client.get(f"{URL}/rework-sources", params={"lot_id": produced["id"]})
    assert context.status_code == 200, context.text
    sources = client.get(f"{URL}/rework-sources", params={"team_id": warehouse["other"]["id"]})
    assert sources.status_code == 200 and sources.json()["total"] > 0
    data = context.json()
    payload = dict(
        source_transfer_id=produced["id"],
        rework_of_id=done.json()["id"],
        expected_revision=data["revision"],
        quantity=data["quantity"],
        weight=data["weight"],
        reason="管理员登记尺寸偏差",
        idempotency_key="admin-rework",
    )
    requested = client.post(f"{URL}/rework-requests", json=payload)
    assert requested.status_code == 201, requested.text
    assert requested.json()["rework_request"]["requesting_team_id"] == warehouse["other"]["id"]
    assert (
        client.post(f"{URL}/rework-requests", json=payload).json()["id"] == requested.json()["id"]
    )
    assert client.get("/api/quality-feedback").json()["total"] == 1
    assert client.get(URL, params={"kind": "rework"}).json()["total"] == 1


def test_admin_handles_quality_decisions_and_replies_for_selected_team(client, inspection):
    setup, _, _, _ = inspection
    row = create_check(client, inspection).json()
    feedback = client.post(
        f"/api/quality-feedback/{row['id']}/reply",
        json=dict(
            team_id=setup["other"]["id"],
            expected_version=row["feedback_version"],
            notes="管理员代班组核实",
            idempotency_key="admin-reply",
        ),
    )
    assert feedback.status_code == 200, feedback.text
    assert (
        feedback.json()["events"][-1]["actor"] == client.get("/api/auth/me").json()["display_name"]
    )
    selected = decide(client, {}, feedback.json())
    assert selected.status_code == 200, selected.text
    assert selected.json()["disposition"] == "other"
    assert selected.json()["events"][-1]["kind"] == "decision"


def test_admin_intake_still_requires_location_and_valid_quantities(client, warehouse):
    setup = {**warehouse, "headers": dict(client.headers)}
    missing = intake(client, setup, warehouse_location=None)
    assert missing.status_code == 422, missing.text
    assert "仓位" in missing.json()["detail"]
    saved = intake(client, setup)
    assert saved.status_code == 201, saved.text
    lot = saved.json()
    bad = client.post(
        base(setup) + "/losses",
        json=dict(
            source_transfer_id=lot["id"],
            quantity=lot["quantity"] + 1,
            weight=lot["weight"] + 1,
            reason="数量检查",
            idempotency_key="admin-invalid-loss",
        ),
    )
    assert bad.status_code == 409, bad.text


def test_admin_manual_handoff_selects_source_without_giving_teams_cross_team_access(client):
    setup = _setup_three_teams(client)
    employee_id = sending_employee_id(client, setup["source_headers"])
    denied = _create(
        client, setup, source_team_id=setup["third"]["id"], sent_employee_id=employee_id
    )
    assert denied.status_code == 403, denied.text
    actor = {**setup, "source_headers": dict(client.headers)}
    missing = _create(client, actor, sent_employee_id=employee_id)
    assert missing.status_code == 422, missing.text
    created = _create(
        client, actor, source_team_id=setup["source"]["id"], sent_employee_id=employee_id
    )
    assert created.status_code == 201, created.text
    lot = created.json()
    assert lot["source_team"]["id"] == setup["source"]["id"]
    assert set(lot["allowed_actions"]) == {"edit", "void", "confirm"}
    same = _create(
        client, actor, source_team_id=setup["source"]["id"], sent_employee_id=employee_id
    )
    assert same.status_code == 201 and same.json()["id"] == lot["id"]
    edited = client.patch(
        f"/api/material-transfers/{lot['batch_no']}",
        json={"expected_version": lot["version"], "notes": "管理员复核"},
    )
    assert edited.status_code == 200, edited.text
    receiver = sending_employee_id(client, setup["target_headers"])
    received = client.post(
        f"/api/material-transfers/{lot['batch_no']}/confirm",
        json={
            "expected_version": edited.json()["version"],
            "received_employee_id": receiver,
            "idempotency_key": "admin-manual-receive",
        },
    )
    assert received.status_code == 200, received.text
    assert received.json()["received_by_user_id"] == client.get("/api/auth/me").json()["id"]


def test_admin_opening_stock_works_without_team_enablement_and_replay_stays_in_team(client):
    setup = _setup_three_teams(client)
    url = f"/api/team-materials/{setup['target']['id']}/opening-stock"
    state = client.get(url).json()
    assert state["can_submit"] and not state["enabled"]
    created = client.post(url, json=open_payload())
    assert created.status_code == 201, created.text
    replay = client.post(url, json=open_payload())
    assert replay.status_code == 201 and replay.json() == created.json()
    other = client.post(
        f"/api/team-materials/{setup['third']['id']}/opening-stock", json=open_payload()
    )
    assert other.status_code == 409, other.text
    denied = client.post(
        url,
        headers=setup["target_headers"],
        json={**open_payload(), "idempotency_key": "disabled-team-attempt"},
    )
    assert denied.status_code == 403, denied.text


def test_admin_can_approve_transfer_amendment(client, handoff):
    setup, _, lot = handoff
    pending = request_amendment(client, setup, lot)
    assert pending.status_code == 201, pending.text
    amendment = pending.json()
    allowed = client.get(f"/api/transfer-amendments/{amendment['id']}")
    assert set(allowed.json()["allowed_actions"]) == {"approve", "reject", "cancel"}
    approved = client.post(f"/api/transfer-amendments/{amendment['id']}/approve")
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"
