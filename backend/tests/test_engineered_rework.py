"""Inspection assigns rework and preserves normal physical inventory."""

from datetime import datetime, timezone
from uuid import uuid4

from app.database import SessionLocal
from app.models import MaterialTransfer
from test_engineering_team import author
from test_inspections import historical_check
from test_process_route_intake import publish_payload, route_payload
from test_processing_daily import setup_lot, work
from test_warehouse_classification import base, confirm, dispatch
from test_warehouse_receipts import intake
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

URL = "/api/process-routes"


def approved_quality_issue(client, setup, lot, context):
    from app.material_lineage import relatives
    from app.models import (
        InspectionProblemType,
        MaterialInspection,
        ProcessRoute,
        Team,
        TeamEmployee,
    )
    from sqlalchemy import select
    from test_material_transfers import _leader, _team

    with SessionLocal() as db:
        qc = db.scalar(select(Team).where(Team.code == "FACTORY-QC"))
        qc_id = qc.id if qc else None
    if qc_id is None:
        qc_id = _team(client, "FACTORY-QC", "检验")["id"]
    if "rework_qc_headers" not in setup:
        _, setup["rework_qc_headers"] = _leader(client, "rework-qc-leader", qc_id)
    headers = setup["rework_qc_headers"]
    with SessionLocal.begin() as db:
        person = db.scalar(select(TeamEmployee).where(TeamEmployee.team_id == qc_id))
        if person is None:
            person = TeamEmployee(team_id=qc_id, name="返工检验员", active=True)
            db.add(person)
        problem = db.scalar(
            select(InspectionProblemType).where(InspectionProblemType.team_id == qc_id)
        )
        if problem is None:
            problem = InspectionProblemType(team_id=qc_id, name="返工检查问题", active=True)
            db.add(problem)
        db.flush()
        person_id, problem_id = person.id, problem.id
        ancestors = relatives([lot["id"]], ancestors=True, name="test_quality_rework_ancestors")
        issue = db.scalar(
            select(MaterialInspection)
            .where(
                MaterialInspection.source_transfer_id.in_(select(ancestors.c.id)),
                MaterialInspection.parent_id.is_(None),
                MaterialInspection.failed_quantity > 0,
                ~select(ProcessRoute.id)
                .where(ProcessRoute.rework_inspection_id == MaterialInspection.id)
                .exists(),
            )
            .order_by(MaterialInspection.id.desc())
        )
        issue_id = issue.id if issue else None
    if issue_id is None:
        result = historical_check(
            client,
            headers=headers,
            json=dict(
                source_transfer_id=lot["id"],
                expected_revision=context["revision"],
                inspector_employee_id=person_id,
                checked_at=datetime.now(timezone.utc).isoformat(),
                sample_quantity=context["quantity"],
                failed_quantity=context["quantity"],
                methods=["visual"],
                items=["appearance"],
                involved_team_ids=[setup["other"]["id"]],
                problem_type_ids=[problem_id],
                idempotency_key=uuid4().hex,
            ),
        )
        assert result.status_code == 201, result.text
        issue_id = result.json()["id"]
    issue = client.get(f"/api/quality-feedback/{issue_id}", headers=headers).json()
    result = client.post(
        f"/api/quality-feedback/{issue_id}/decision",
        headers=headers,
        json=dict(
            expected_version=issue["feedback_version"],
            disposition="rework",
            status="processing",
            involved_team_ids=[setup["other"]["id"]],
            notes="检验确认返修",
            idempotency_key=uuid4().hex,
        ),
    )
    assert result.status_code == 200, result.text
    return issue_id, headers


def request_plan(client, s, lot, original, quantity=None, weight=None, team=None):
    ctx = client.get(base(s, True) + f"/stock/{lot['id']}/quantity-adjustments").json()
    issue_id, headers = approved_quality_issue(client, s, lot, ctx)
    body = dict(
        source_transfer_id=lot["id"],
        rework_of_id=original["id"],
        inspection_id=issue_id,
        repair_team_id=team or s["other"]["id"],
        expected_revision=ctx["revision"],
        quantity=quantity or ctx["quantity"],
        weight=weight or ctx["weight"],
        reason="尺寸偏差，重新精磨",
        idempotency_key=uuid4().hex,
    )
    response = client.post(URL + "/rework-requests", json=body, headers=headers)
    assert response.status_code == 201, response.text
    retry = client.post(URL + "/rework-requests", json=body, headers=headers)
    assert retry.status_code == 201 and retry.json()["id"] == response.json()["id"]
    return response.json()


def save_plan(client, s, route, *, team=None):
    """Assign a reported batch through quality management as the QC administrator."""
    team = team or s["other"]["id"]
    if route["state"] == "draft":
        result = client.post(
            f"/api/quality-feedback/team-problems/{route['id']}/assign",
            params={"repair_team_id": team},
        )
        assert result.status_code == 200, result.text
    saved = client.get(URL + f"/{route['id']}").json()
    assert saved["state"] == "published" and saved["steps"][0]["team_id"] == team
    return saved


def historical_two_steps(route):
    # Previously published multi-step plans must still execute and resume normally.
    from app.models import ProcessRoute, ProcessRoutePath

    with SessionLocal.begin() as db:
        row = db.get(ProcessRoute, route["id"])
        first = row.steps[0]
        second = {
            **first,
            "sequence_no": 2,
            "name": "复磨",
            "instructions": "复磨后检查表面，不得叠放",
        }
        row.steps = [first, second]
        for serial in dict.fromkeys(["", *row.serial_nos]):
            db.add(
                ProcessRoutePath(
                    route_id=row.id, serial_no=serial, step_index=1, team_id=first["team_id"]
                )
            )


def test_rework_is_blocked_without_inspection_assignment_and_partial_request_isolates_stock(
    client, warehouse
):
    s = warehouse
    lot, employee = setup_lot(client, s)
    original = work(client, s, lot, employee).json()
    current = original["outputs"][0]
    denied = work(
        client,
        s,
        current,
        employee,
        work_kind="rework",
        rework_of_id=original["id"],
        idempotency_key=uuid4().hex,
    )
    assert denied.status_code == 422 and "检验" in denied.text
    plan = request_plan(client, s, current, original, quantity=4, weight=40)
    scope = plan["rework_request"]
    assert (scope["quantity"], scope["weight"]) == (4, 40)
    child = {"id": scope["source_transfer_id"]}
    result = work(
        client,
        s,
        child,
        employee,
        work_kind="rework",
        rework_of_id=original["id"],
        completed_quantity=4,
        completed_weight=40,
        idempotency_key=uuid4().hex,
    )
    assert result.status_code == 201, result.text
    row = result.json()
    assert row["process_route_id"] == plan["id"]
    assert row["process_step_instructions"] == "尺寸偏差，重新精磨"
    assert plan["steps"][0]["team_id"] == s["other"]["id"]
    totals = client.get(base(s, True) + "/overview").json()["totals"]
    assert (totals["on_hand_quantity"], totals["on_hand_weight"]) == (10, 100)
    summary = client.get(base(s, True) + "/processing-records").json()["summary"]
    assert (summary["completed_quantity"], summary["rework_quantity"]) == (10, 4)
    done = row["outputs"][0]
    ctx = client.get(base(s, True) + f"/stock/{done['id']}/quantity-adjustments").json()
    resumed = client.post(
        URL + f"/rework-lots/{done['id']}/resume",
        headers=s["other_headers"],
        json={"expected_revision": ctx["revision"]},
    )
    assert resumed.status_code == 200, resumed.text
    with SessionLocal() as db:
        assert db.get(MaterialTransfer, current["id"]).rework_route_id is None
        assert db.get(MaterialTransfer, done["id"]).process_route_id is None


def test_warehouse_can_bind_route_atomically_at_dispatch_and_invalid_dispatch_rolls_back(
    client, warehouse
):
    s = warehouse
    route = publish_payload(client, route_payload(client, s))
    receipt = intake(client, s).json()
    line = dict(source_transfer_id=receipt["id"], quantity=10, weight=100)
    assert dispatch(client, s, [{**line, "quantity": 0, "weight": 0}]).status_code == 422
    line.update(process_route_id=route["id"], process_route_version=route["version"])
    bad = dispatch(client, s, [{**line, "process_route_version": 999}])
    assert bad.status_code == 409
    with SessionLocal() as db:
        assert db.get(MaterialTransfer, receipt["id"]).process_route_id is None
    good = dispatch(client, s, [line])
    assert good.status_code == 201, good.text
    assert good.json()["items"][0]["process_route"]["id"] == route["id"]
    assert confirm(client, s, good.json(), workshop=True).status_code == 200


def test_two_rework_steps_keep_one_round_and_require_manual_return_to_normal_route(
    client, warehouse
):
    from test_processing_route_methods import routed_lot

    s = warehouse
    lot, employee, normal = routed_lot(client, s, second=False)
    original = work(client, s, lot, employee).json()
    request = request_plan(client, s, original["outputs"][0], original)
    headers, _ = author(client)
    skipped = client.put(
        URL + f"/{request['id']}",
        headers=headers,
        json={
            "title": request["title"],
            "serial_nos": request["serial_nos"],
            "steps": [normal["steps"][1]],
            "version": request["version"],
            "resume_step_index": 2,
        },
    )
    assert skipped.status_code in (403, 422), skipped.text
    plan = request
    historical_two_steps(plan)
    current = {"id": request["rework_request"]["source_transfer_id"]}
    for index, instruction in enumerate(("尺寸偏差，重新精磨", "复磨后检查表面，不得叠放")):
        result = work(client, s, current, employee, work_kind="rework", idempotency_key=uuid4().hex)
        assert result.status_code == 201, result.text
        assert result.json()["process_step_index"] == index
        assert result.json()["process_step_instructions"] == instruction
        assert result.json()["rework_round"] == 1
        current = result.json()["outputs"][0]
        with SessionLocal() as db:
            assert db.get(MaterialTransfer, current["id"]).rework_count == (0 if index == 0 else 1)
        context = client.get(base(s, True) + f"/stock/{current['id']}/quantity-adjustments").json()
        assert context["rework_round"] == 1
        resumed = client.post(
            URL + f"/rework-lots/{current['id']}/resume",
            headers=s["other_headers"],
            json={"expected_revision": context["revision"]},
        )
        assert resumed.status_code == (422 if index == 0 else 200), resumed.text
    with SessionLocal() as db:
        row = db.get(MaterialTransfer, current["id"])
        assert row.process_route_id == normal["id"] and row.process_step_index == 1
        assert row.rework_count == 1
    assert (
        client.get(URL + f"/{plan['id']}").json()["rework_request"]["rework_of_id"]
        == original["id"]
    )
    trace = client.get("/api/material-trace", params={"serial_no": current["batch_no"]})
    assert trace.status_code == 200, trace.text
    assert any(item["entry_kind"] == "rework_split" for item in trace.json()["items"])


def test_rework_request_permissions_stale_stock_and_foreign_history(client, warehouse):
    s = warehouse
    lot, employee = setup_lot(client, s)
    original = work(client, s, lot, employee).json()
    current = original["outputs"][0]
    context = client.get(base(s, True) + f"/stock/{current['id']}/quantity-adjustments").json()
    issue_id, headers = approved_quality_issue(client, s, current, context)
    body = dict(
        source_transfer_id=current["id"],
        rework_of_id=original["id"],
        inspection_id=issue_id,
        repair_team_id=s["other"]["id"],
        expected_revision=context["revision"],
        quantity=10,
        weight=100,
        reason="表面划伤",
        idempotency_key=uuid4().hex,
    )
    assert client.post(URL + "/rework-requests", json=body, headers=s["headers"]).status_code == 403
    for change, status in (
        ({"rework_of_id": 999999}, 422),
        ({"expected_revision": 999}, 409),
        ({"inspection_id": 999999}, 404),
        ({"quantity": 5}, 422),
    ):
        result = client.post(URL + "/rework-requests", json={**body, **change}, headers=headers)
        assert result.status_code == status, result.text
    before = client.get(base(s, True) + "/overview").json()["totals"]
    plan = request_plan(client, s, current, original)
    denied = client.put(
        URL + f"/{plan['id']}",
        json={
            "title": plan["title"],
            "serial_nos": plan["serial_nos"],
            "steps": [],
            "version": plan["version"],
        },
        headers=s["other_headers"],
    )
    assert denied.status_code == 403
    after = client.get(base(s, True) + "/overview").json()["totals"]
    assert (before["received_quantity"], before["dispatched_quantity"]) == (
        after["received_quantity"],
        after["dispatched_quantity"],
    )


def test_route_main_list_combines_types_and_filters_pending_scopes_without_exposing_drafts(
    client, warehouse
):
    from test_processing_route_methods import routed_lot

    s = warehouse
    lot, employee, normal = routed_lot(client, s, second=False)
    original = work(client, s, lot, employee).json()
    request = request_plan(client, s, original["outputs"][0], original)
    response = client.get(URL, params={"kind": "all"})
    assert response.status_code == 200, response.text
    combined = {row["id"]: row for row in response.json()["items"]}
    assert combined[normal["id"]]["route_kind"] == "normal"
    assert combined[request["id"]]["route_kind"] == "rework"
    batch = request["rework_request"]["batch_no"]
    assert combined[request["id"]]["rework_batch_no"] == batch
    pending = client.get(URL, params={"kind": "rework", "state": "draft", "query": batch})
    assert pending.json()["items"] == []
    assert request["id"] not in {row["id"] for row in client.get(URL).json()["items"]}
    visible = client.get(URL, params={"kind": "all"}, headers=s["other_headers"])
    assert request["id"] in {row["id"] for row in visible.json()["items"]}


def test_engineering_cannot_revise_an_inspection_assignment(client, warehouse):
    lot, employee = setup_lot(client, warehouse)
    original = work(client, warehouse, lot, employee).json()
    plan = request_plan(client, warehouse, original["outputs"][0], original)
    headers, _ = author(client)
    assert client.post(URL + f"/{plan['id']}/revise", headers=headers).status_code == 403
    assert client.get(URL + f"/{plan['id']}").json()["steps"] == plan["steps"]


def test_rework_keeps_inherited_drawing_and_blocks_engineering_uploads(client, warehouse):
    from test_process_route_creation import pdf
    from test_process_route_import import HEADERS, docx
    from test_processing_route_methods import routed_lot

    s = warehouse
    lot, employee, normal = routed_lot(client, s, second=False)
    drawing = client.get(f"{URL}/{normal['id']}").json()["drawings"][0]
    original_id = drawing["id"]
    original_pdf = client.get(f"{URL}/{normal['id']}/drawings/{original_id}").content
    original = work(client, s, lot, employee).json()
    route = request_plan(client, s, original["outputs"][0], original)
    assert route["filename"] == "" and route["source_data"]["assigned_by_inspection"]
    copied = route["drawings"][0]
    assert copied["id"] != original_id and copied["filename"] == drawing["filename"]
    assert client.get(f"{URL}/{route['id']}").json()["drawings"] == route["drawings"]
    assert client.get(f"{URL}/{route['id']}/drawings/{copied['id']}").content == original_pdf
    word = docx([["流水号", "WAREHOUSE-001"], HEADERS, [1, "返工", "手工要求", 1, 10]])
    headers, _ = author(client)
    rejected = client.post(
        f"{URL}/{route['id']}/source",
        headers=headers,
        data={"version": route["version"]},
        files={"file": ("返工.docx", word)},
    )
    assert rejected.status_code in (403, 422), rejected.text
    uploaded = client.post(
        f"{URL}/{route['id']}/drawings",
        headers=headers,
        data={"version": route["version"]},
        files={"file": ("补充图纸.pdf", pdf(2))},
    )
    assert uploaded.status_code == 403, uploaded.text
    assert client.get(f"{URL}/{normal['id']}/drawings/{original_id}").content == original_pdf
