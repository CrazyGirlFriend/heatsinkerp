from datetime import datetime, timezone
from uuid import uuid4

from app.database import SessionLocal
from app.models import (
    InspectionProblemType,
    MaterialInspection,
    MaterialStockBalance,
    MaterialTransfer,
    Team,
    TeamEmployee,
)
from receipt_helpers import receipt_post
from sqlalchemy import select
from test_engineered_rework import save_plan
from test_processing_daily import work
from test_team_rework_notices import prepare
from test_warehouse_classification import base, dispatch
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

URL = "/api/process-routes"


def direct(client, s, lot, original, quantity=2, weight=20):
    context = client.get(
        URL + "/rework-sources", params={"lot_id": lot["id"]}, headers=s["other_headers"]
    )
    assert context.status_code == 200, context.text
    body = dict(
        source_transfer_id=lot["id"],
        rework_of_id=original,
        expected_revision=context.json()["revision"],
        quantity=quantity,
        weight=weight,
        reason="研磨自查：厚度偏差",
        idempotency_key=uuid4().hex,
    )
    result = client.post(URL + "/rework-requests", json=body, headers=s["other_headers"])
    assert result.status_code == 201, result.text
    assert (
        client.post(URL + "/rework-requests", json=body, headers=s["other_headers"]).json()["id"]
        == result.json()["id"]
    )
    return result.json()


def complete(client, s, route):
    plan = save_plan(client, s, route)
    employee = client.get(base(s, True) + "/employees").json()[0]
    result = work(
        client,
        s,
        {"id": plan["rework_request"]["source_transfer_id"]},
        employee,
        work_kind="rework",
        idempotency_key=uuid4().hex,
    )
    assert result.status_code == 201, result.text
    lot = result.json()["outputs"][0]
    context = client.get(base(s, True) + f"/stock/{lot['id']}/quantity-adjustments").json()
    resumed = client.post(
        URL + f"/rework-lots/{lot['id']}/resume",
        headers=s["other_headers"],
        json={"expected_revision": context["revision"]},
    )
    assert resumed.status_code == 200, resumed.text
    return lot, result.json()["id"]


def inspect(client, s, lot, *, quantity=2, failed=0, scope="full"):
    with SessionLocal() as db:
        qc = db.scalar(select(Team).where(Team.code == "FACTORY-QC"))
        person = db.scalar(select(TeamEmployee.id).where(TeamEmployee.team_id == qc.id))
        problem = db.scalar(
            select(InspectionProblemType.id).where(InspectionProblemType.team_id == qc.id)
        )
        revision = db.get(MaterialStockBalance, lot["id"]).revision
        kind = (
            "inspection" if db.get(MaterialTransfer, lot["id"]).next_team_id == qc.id else "patrol"
        )
    response = client.post(
        "/api/inspections",
        headers=s["rework_qc_headers"],
        json=dict(
            source_transfer_id=lot["id"],
            expected_revision=revision,
            kind=kind,
            inspector_employee_id=person,
            checked_at=datetime.now(timezone.utc).isoformat(),
            sample_quantity=quantity,
            failed_quantity=failed,
            scope=scope,
            methods=["visual"],
            items=["dimension"],
            involved_team_ids=[s["other"]["id"]] if failed else [],
            problem_type_ids=[problem] if failed else [],
            idempotency_key=uuid4().hex,
        ),
    )
    assert response.status_code == 201, response.text
    return response.json()


def rounds(client, route):
    result = client.get(URL + f"/{route['id']}/rework-rounds")
    assert result.status_code == 200, result.text
    return result.json()


def test_team_submits_own_stock_without_qc_and_cannot_execute_before_instructions(
    client, warehouse
):
    s = warehouse
    lot, body, engineering_id, engineering_headers = prepare(client, s)
    body.pop("inspection_id")
    for actor in (s["headers"], s["rework_qc_headers"], client.headers):
        denied = client.post(URL + "/rework-requests", json=body, headers=actor)
        assert denied.status_code == 403, denied.text
    route = direct(client, s, lot, body["rework_of_id"])
    scope = route["rework_request"]
    assert scope["inspection_id"] is None
    assert scope["requesting_team_id"] == scope["team_id"] == s["other"]["id"]
    assert scope["round"] == 1
    assert route["steps"] == [] and route["filename"] == ""
    assert (
        client.get(
            f"/api/rework-notices?team_id={engineering_id}", headers=engineering_headers
        ).json()["unread"]
        == 1
    )
    child = {"id": scope["source_transfer_id"]}
    employee = client.get(base(s, True) + "/employees").json()[0]
    for kind in ("initial", "rework"):
        denied = work(client, s, child, employee, work_kind=kind, idempotency_key=uuid4().hex)
        assert denied.status_code == 422 and "工艺" in denied.text
    denied = dispatch(
        client, s, [dict(source_transfer_id=child["id"], quantity=2, weight=20)], workshop=True
    )
    assert denied.status_code == 422 and "工艺" in denied.text
    assert (
        client.put(
            URL + f"/{route['id']}",
            headers=s["other_headers"],
            json={k: route[k] for k in ("title", "serial_nos", "steps", "version")},
        ).status_code
        == 403
    )
    save_plan(client, s, route)
    notice = client.get(
        f"/api/rework-notices?team_id={s['other']['id']}", headers=s["other_headers"]
    ).json()
    assert notice["total"] == 1 and notice["items"][0]["kind"] == "ready"
    with SessionLocal() as db:
        assert db.get(MaterialTransfer, child["id"]).next_team_id == s["other"]["id"]
        assert db.get(MaterialStockBalance, lot["id"]).on_hand_quantity == 8


def test_rounds_follow_selected_material_not_other_portions_of_same_serial(client, warehouse):
    s = warehouse
    lot, body, _, _ = prepare(client, s)
    first = direct(client, s, lot, body["rework_of_id"])
    done, work_id = complete(client, s, first)
    assert rounds(client, first)[0]["progress"]["state"] == "awaiting_inspection"
    inspect(client, s, done, failed=1)
    second = direct(client, s, done, work_id, quantity=1, weight=10)
    sibling = direct(client, s, lot, body["rework_of_id"])
    rows = rounds(client, second)
    assert [r["request"]["round"] for r in rows] == [1, 2]
    assert [r["request"]["quantity"] for r in rows] == [2, 1]
    assert rows[0]["progress"]["state"] == "failed"
    assert rows[1]["progress"]["state"] == "awaiting_route"
    assert rows[0]["steps"][0]["instructions"] == "返工精磨至2.50±0.01mm"
    assert [r["route_id"] for r in rounds(client, sibling)] == [sibling["id"]]
    assert sibling["rework_request"]["round"] == 1
    # A third request on the reserved portion is refused; unrelated stock stays usable.
    denied = client.get(
        URL + "/rework-sources",
        params={"lot_id": second["rework_request"]["source_transfer_id"]},
        headers=s["other_headers"],
    )
    assert denied.status_code == 409


def test_processing_sample_pass_and_full_reinspection_are_distinct_and_filterable(
    client, warehouse
):
    s = warehouse
    lot, body, _, _ = prepare(client, s)
    route = direct(client, s, lot, body["rework_of_id"])
    assert rounds(client, route)[0]["progress"]["completed_quantity"] == 0
    done, _ = complete(client, s, route)
    inspect(client, s, done, quantity=1, scope="sample")
    progress = rounds(client, route)[0]["progress"]
    assert progress["completed_quantity"] == 2 and progress["state"] == "awaiting_inspection"
    assert progress["passed_quantity"] == 0
    assert progress["inspections"][0]["scope"] == "sample"
    assert client.get(URL, params={"kind": "rework", "rework_scope": "open"}).json()["total"] == 1
    inspect(client, s, done)
    progress = rounds(client, route)[0]["progress"]
    assert progress["state"] == "passed" and progress["passed_quantity"] == 2
    assert len(progress["inspections"]) == 2
    assert client.get(URL, params={"kind": "rework", "rework_scope": "open"}).json()["total"] == 0
    assert client.get(URL, params={"kind": "rework", "rework_scope": "ended"}).json()["total"] == 1


def test_direct_request_respects_stock_revision_and_legacy_quality_hold(client, warehouse):
    s = warehouse
    lot, body, _, _ = prepare(client, s)
    issue_id = body.pop("inspection_id")
    stale = client.post(
        URL + "/rework-requests",
        headers=s["other_headers"],
        json={**body, "expected_revision": 999},
    )
    assert stale.status_code == 409
    with SessionLocal.begin() as db:
        db.get(MaterialInspection, issue_id).blocks_outbound = True
    held = client.post(URL + "/rework-requests", headers=s["other_headers"], json=body)
    assert held.status_code == 409 and "检验锁定" in held.text
    with SessionLocal() as db:
        assert db.get(MaterialStockBalance, lot["id"]).on_hand_quantity == 10


def test_revision_is_not_a_new_round_and_partial_work_remains_open(client, warehouse):
    s = warehouse
    lot, body, _, _ = prepare(client, s)
    route = save_plan(client, s, direct(client, s, lot, body["rework_of_id"]))
    revision = client.post(URL + f"/{route['id']}/revise").json()
    revised = save_plan(client, s, revision, instructions="精磨至2.40mm")
    rows = rounds(client, revised)
    assert len(rows) == 1 and rows[0]["request"]["round"] == 1
    assert rows[0]["steps"][0]["instructions"] == "精磨至2.40mm"
    employee = client.get(base(s, True) + "/employees").json()[0]
    processed = work(
        client,
        s,
        {"id": route["rework_request"]["source_transfer_id"]},
        employee,
        work_kind="rework",
        completed_quantity=1,
        completed_weight=10,
        idempotency_key=uuid4().hex,
    )
    assert processed.status_code == 201, processed.text
    inspect(client, s, processed.json()["outputs"][0], quantity=1)
    progress = rounds(client, revised)[0]["progress"]
    assert progress["state"] == "processing"
    assert (progress["completed_quantity"], progress["passed_quantity"], progress["quantity"]) == (
        1,
        1,
        2,
    )


def test_full_check_of_remaining_stock_does_not_cover_already_transferred_portion(
    client, warehouse
):
    s = warehouse
    lot, body, _, _ = prepare(client, s)
    route = direct(client, s, lot, body["rework_of_id"])
    done, _ = complete(client, s, route)
    with SessionLocal() as db:
        qc_id = db.scalar(select(Team.id).where(Team.code == "FACTORY-QC"))
    sent = dispatch(
        client,
        s,
        [dict(source_transfer_id=done["id"], quantity=1, weight=10)],
        workshop=True,
        next_team_id=qc_id,
        idempotency_key=uuid4().hex,
    )
    assert sent.status_code == 201, sent.text
    transfer = sent.json()["items"][0]
    received = receipt_post(
        client,
        f"/api/material-transfers/{transfer['batch_no']}/confirm",
        headers=s["rework_qc_headers"],
        json={"idempotency_key": uuid4().hex, "expected_version": transfer["version"]},
    )
    assert received.status_code == 200, received.text
    inspect(client, s, done, quantity=1)
    progress = rounds(client, route)[0]["progress"]
    assert progress["state"] == "awaiting_inspection" and progress["passed_quantity"] == 1
    inspect(client, s, transfer, quantity=1)
    progress = rounds(client, route)[0]["progress"]
    assert progress["state"] == "passed" and progress["passed_quantity"] == 2
    assert len(progress["inspections"]) == 2
