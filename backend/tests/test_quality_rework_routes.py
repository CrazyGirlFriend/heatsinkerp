"""Teams explicitly request engineering for real stock without a QC approval gate."""

from uuid import uuid4

from app.database import SessionLocal
from app.models import ProcessRoute
from sqlalchemy import func, select
from test_engineered_rework import save_plan
from test_inspections import create_check
from test_inspections import inspection as inspection  # noqa: F401
from test_processing_daily import work
from test_warehouse_classification import base
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401


def decide(client, headers, issue, disposition="rework", **extra):
    return client.post(
        f"/api/quality-feedback/{issue['id']}/decision",
        headers=headers,
        json={
            "expected_version": issue["feedback_version"],
            "disposition": disposition,
            "status": "processing",
            "involved_team_ids": [issue["team_id"]],
            "idempotency_key": uuid4().hex,
            **extra,
        },
    )


def request_body(context, issue_id):
    return dict(
        source_transfer_id=context["source_transfer_id"],
        rework_of_id=context["rework_of_id"],
        inspection_id=issue_id,
        expected_revision=context["revision"],
        quantity=1,
        weight=10,
        reason="划伤，需研磨处理",
        idempotency_key=uuid4().hex,
    )


def test_qc_decision_does_not_automatically_create_engineering_or_move_stock(client, inspection):
    s, lot, headers, _ = inspection
    issue = create_check(client, inspection).json()
    path = f"/api/quality-feedback/{issue['id']}/rework-stock"
    assert client.get(path, headers=headers).status_code == 200
    before = client.get(base(s, True) + "/overview").json()["totals"]
    chosen = decide(client, headers, issue, disposition="rework").json()
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(ProcessRoute)) == 0
    assert client.get(base(s, True) + "/overview").json()["totals"] == before
    assert chosen["disposition"] == "rework"
    assert client.get(path, headers=s["other_headers"]).status_code == 403
    assert client.get(path).status_code == 403


def test_qc_submits_scoped_problem_engineering_authors_and_team_executes(client, inspection):
    s, lot, headers, _ = inspection
    issue = create_check(client, inspection, notes="表面划伤明显").json()
    path = f"/api/quality-feedback/{issue['id']}/rework-stock"
    stock = client.get(path, headers=headers).json()
    assert stock["total"] == 1 and stock["items"][0]["id"] == lot["id"]
    context = client.get(path, params={"source_transfer_id": lot["id"]}, headers=headers).json()
    assert context["rework_of_id"] == issue["processing_record_id"]
    body = request_body(context, issue["id"])
    result = client.post("/api/process-routes/rework-requests", json=body, headers=headers)
    assert result.status_code == 201, result.text
    route = result.json()
    retry = client.post("/api/process-routes/rework-requests", json=body, headers=headers)
    assert retry.status_code == 201 and retry.json()["id"] == route["id"]
    assert route["state"] == "draft" and route["steps"] == [] and route["filename"] == ""
    unchanged = client.get(f"/api/quality-feedback/{issue['id']}", headers=headers).json()
    assert unchanged["disposition"] == issue["disposition"] == "pending"
    assert unchanged["feedback_status"] == issue["feedback_status"]
    assert unchanged["blocks_outbound"] == issue["blocks_outbound"]
    scope = route["rework_request"]
    assert scope["problem_names"] == ["表面划伤"]
    assert scope["problem_notes"] == "表面划伤明显"
    assert scope["problem_teams"] == [{"id": s["other"]["id"], "name": s["other"]["name"]}]
    assert scope["execution_team_names"] == []
    for query in ("表面划伤", "划伤，需研磨处理", scope["batch_no"]):
        rows = client.get("/api/process-routes", params={"kind": "rework", "query": query}).json()
        assert [row["id"] for row in rows["items"]] == [route["id"]]
        assert rows["items"][0]["rework_request"]["problem_names"] == ["表面划伤"]
    saved = save_plan(client, s, route, instructions="轻磨除划伤，不得减薄超过0.01mm")
    for team_id, actor in (
        (scope["requesting_team_id"], headers),
        (s["other"]["id"], s["other_headers"]),
    ):
        inbox = client.get(f"/api/rework-notices?team_id={team_id}", headers=actor).json()
        assert inbox["total"] == inbox["unread"] == 1
        message = inbox["items"][0]
        assert message["kind"] == "ready" and message["submitting_team"] == "检验"
        opened = client.get(f"/api/rework-notices/{message['id']}/route", headers=actor)
        assert opened.status_code == 200 and opened.json()["id"] == saved["id"]
    rows = client.get("/api/process-routes", params={"kind": "rework"}).json()["items"]
    assert rows[0]["rework_request"]["execution_team_names"] == [s["other"]["name"]]
    employee = client.get(base(s, True) + "/employees").json()[0]
    processed = work(
        client,
        s,
        {"id": scope["source_transfer_id"]},
        employee,
        work_kind="rework",
        completed_quantity=1,
        completed_weight=10,
        idempotency_key=uuid4().hex,
    )
    assert processed.status_code == 201, processed.text
    assert processed.json()["process_route_id"] == saved["id"]
    assert processed.json()["process_step_instructions"] == "轻磨除划伤，不得减薄超过0.01mm"
    assert client.get(base(s, True) + "/overview").json()["totals"]["on_hand_quantity"] == 10


def test_qc_cannot_submit_unrelated_stock_or_closed_issue(client, inspection):
    s, lot, headers, _ = inspection
    issue = create_check(client, inspection).json()
    decision = decide(client, headers, issue, disposition="rework").json()
    path = f"/api/quality-feedback/{issue['id']}/rework-stock"
    assert (
        client.get(
            path, params={"source_transfer_id": lot["id"] + 10000}, headers=headers
        ).status_code
        == 409
    )
    context = client.get(path, params={"source_transfer_id": lot["id"]}, headers=headers).json()
    body = request_body(context, issue["id"])
    changed = decide(client, headers, decision, disposition="other", status="closed")
    assert changed.status_code == 200
    assert client.get(path, headers=headers).status_code == 409
    denied = client.post("/api/process-routes/rework-requests", json=body, headers=headers)
    assert denied.status_code == 409
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(ProcessRoute)) == 0


def test_stock_holder_can_directly_submit_its_problem_without_qc_confirmation(client, inspection):
    s, lot, headers, _ = inspection
    context = client.get(base(s, True) + f"/stock/{lot['id']}/quantity-adjustments").json()
    body = request_body(context, None)
    for actor in (s["headers"], client.headers):
        denied = client.post("/api/process-routes/rework-requests", headers=actor, json=body)
        assert denied.status_code == 403, denied.text
    result = client.post(
        "/api/process-routes/rework-requests", headers=s["other_headers"], json=body
    )
    assert result.status_code == 201, result.text
    assert result.json()["rework_request"]["requesting_team_id"] == s["other"]["id"]
