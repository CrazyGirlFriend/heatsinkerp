"""Rework requires engineering instructions and preserves normal physical inventory."""

from datetime import datetime, timezone
from uuid import uuid4

from app.database import SessionLocal
from app.models import MaterialTransfer
from test_process_route_intake import publish_payload, route_payload
from test_processing_daily import setup_lot, work
from test_warehouse_classification import base, confirm, dispatch
from test_warehouse_receipts import intake
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

URL = "/api/process-routes"


def approved_quality_issue(client, setup, lot, context):
    from app.material_lineage import relatives
    from app.models import InspectionProblemType, MaterialInspection, Team, TeamEmployee
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
            )
            .order_by(MaterialInspection.id.desc())
        )
        issue_id = issue.id if issue else None
    if issue_id is None:
        result = client.post(
            "/api/inspections",
            headers=headers,
            json=dict(
                source_transfer_id=lot["id"],
                expected_revision=context["revision"],
                inspector_employee_id=person_id,
                checked_at=datetime.now(timezone.utc).isoformat(),
                sample_quantity=1,
                failed_quantity=1,
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
            notes="确认需要返工，由工艺制定要求",
            idempotency_key=uuid4().hex,
        ),
    )
    assert result.status_code == 200, result.text
    return issue_id, headers


def request_plan(client, s, lot, original, quantity=None, weight=None):
    ctx = client.get(base(s, True) + f"/stock/{lot['id']}/quantity-adjustments").json()
    issue_id, headers = approved_quality_issue(client, s, lot, ctx)
    body = dict(
        source_transfer_id=lot["id"],
        rework_of_id=original["id"],
        inspection_id=issue_id,
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


def save_plan(client, s, route, *, instructions="返工精磨至2.50±0.01mm", team=None, repeated=False):
    from app.models import Team, TeamEmployee

    with SessionLocal() as db:
        engineering = db.query(Team).filter_by(code="FACTORY-PROCESS").first()
        if not engineering:
            engineering = Team(code="FACTORY-PROCESS", name="工艺", kind="engineering", active=True)
            db.add(engineering)
            db.flush()
        person = db.query(TeamEmployee).filter_by(team_id=engineering.id, name="工艺张工").first()
        if not person:
            person = TeamEmployee(team_id=engineering.id, name="工艺张工", active=True)
            db.add(person)
        db.commit()
        person_id = person.id
    team = team or s["other"]["id"]
    task_base = f"/api/team-materials/{team}"
    task = next(
        (
            row
            for row in client.get(task_base + "/processing-tasks").json()
            if row["name"] == "返工精磨"
        ),
        None,
    )
    if not task:
        task = client.post(task_base + "/processing-tasks", json={"name": "返工精磨"}).json()
    purpose = next(
        (row for row in client.get(task_base + "/purposes").json() if row["name"] == "返工处理"),
        None,
    )
    if not purpose:
        purpose = client.post(task_base + "/purposes", json={"name": "返工处理"}).json()
    body = {key: route[key] for key in ("title", "serial_nos", "version")}
    body.update(
        engineering_employee_id=person_id,
        modified_employee_id=person_id,
        review_note="",
        steps=[
            dict(
                sequence_no=1,
                name="返工精磨",
                instructions=instructions,
                team_id=team,
                processing_task_id=task["id"],
                purpose_id=purpose["id"],
            )
        ],
    )
    if repeated:
        body["steps"].append(
            {
                **body["steps"][0],
                "sequence_no": 2,
                "name": "返工复磨",
                "instructions": "复磨后检查表面，不得叠放",
            }
        )
    result = client.put(URL + f"/{route['id']}", json=body)
    assert result.status_code == 200, result.text
    published = client.post(
        URL + f"/{route['id']}/publish", json={"version": result.json()["version"]}
    )
    assert published.status_code == 200, published.text
    return published.json()


def test_rework_is_blocked_without_engineering_and_partial_request_isolates_stock(
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
    assert denied.status_code == 422 and "工艺" in denied.text
    plan = request_plan(client, s, current, original, quantity=4, weight=40)
    scope = plan["rework_request"]
    assert (scope["quantity"], scope["weight"]) == (4, 40)
    child = {"id": scope["source_transfer_id"]}
    assert (
        work(
            client, s, child, employee, work_kind="rework", idempotency_key=uuid4().hex
        ).status_code
        == 422
    )
    plan = save_plan(client, s, plan)
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
    assert row["process_step_instructions"] == "返工精磨至2.50±0.01mm"
    assert row["processing_task_name"] == "返工精磨"
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
    assert dispatch(client, s, [line]).status_code == 422
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
    skipped = client.put(
        URL + f"/{request['id']}",
        json={
            "title": request["title"],
            "serial_nos": request["serial_nos"],
            "steps": [normal["steps"][1]],
            "version": request["version"],
            "resume_step_index": 2,
        },
    )
    assert skipped.status_code == 422, skipped.text
    plan = save_plan(client, s, request, repeated=True)
    current = {"id": request["rework_request"]["source_transfer_id"]}
    for index, instruction in enumerate(("返工精磨至2.50±0.01mm", "复磨后检查表面，不得叠放")):
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
    assert [row["id"] for row in pending.json()["items"]] == [request["id"]]
    assert request["id"] not in {row["id"] for row in client.get(URL).json()["items"]}
    visible = client.get(URL, params={"kind": "all"}, headers=s["other_headers"])
    assert request["id"] not in {row["id"] for row in visible.json()["items"]}
    save_plan(client, s, request)
    visible = client.get(URL, params={"kind": "all"}, headers=s["other_headers"])
    assert request["id"] in {row["id"] for row in visible.json()["items"]}


def test_rework_instruction_can_be_revised_only_before_any_execution(client, warehouse):
    s = warehouse
    lot, employee = setup_lot(client, s)
    original = work(client, s, lot, employee).json()
    request = request_plan(client, s, original["outputs"][0], original)
    saved = save_plan(client, s, request)
    revision = client.post(URL + f"/{saved['id']}/revise")
    assert revision.status_code == 201, revision.text
    revision = revision.json()
    assert revision["route_kind"] == "rework"
    assert (
        revision["rework_request"]["source_transfer_id"]
        == request["rework_request"]["source_transfer_id"]
    )
    steps = [{**saved["steps"][0], "instructions": "修订要求：厚度2.48±0.01mm"}]
    payload = {
        key: revision[key] for key in ("title", "serial_nos", "version", "engineering_employee_id")
    }
    payload.update(steps=steps, modified_employee_id=saved["engineering_employee_id"])
    changed = client.put(URL + f"/{revision['id']}", json=payload)
    assert changed.status_code == 200, changed.text
    changed = client.post(
        URL + f"/{revision['id']}/publish", json={"version": changed.json()["version"]}
    )
    assert changed.status_code == 200, changed.text
    current = {"id": request["rework_request"]["source_transfer_id"]}
    processed = work(client, s, current, employee, work_kind="rework", idempotency_key=uuid4().hex)
    assert processed.status_code == 201, processed.text
    assert processed.json()["process_step_instructions"] == "修订要求：厚度2.48±0.01mm"
    assert (
        client.get(URL + f"/{saved['id']}").json()["steps"][0]["instructions"]
        == "返工精磨至2.50±0.01mm"
    )
    assert client.post(URL + f"/{revision['id']}/revise").status_code == 409


def test_rework_inherits_bound_drawing_version_allows_pdf_upload_but_not_word(client, warehouse):
    from hashlib import sha256

    from app.models import ProcessRouteDrawing
    from test_process_route_creation import pdf
    from test_process_route_import import HEADERS, docx
    from test_processing_route_methods import routed_lot

    s = warehouse
    lot, employee, normal = routed_lot(client, s, second=False)
    original_pdf = pdf()
    with SessionLocal() as db:
        drawing = ProcessRouteDrawing(
            route_id=normal["id"],
            filename="原图纸.pdf",
            content=original_pdf,
            sha256=sha256(original_pdf).hexdigest(),
            size_bytes=len(original_pdf),
        )
        db.add(drawing)
        db.commit()
        original_id = drawing.id
    original = work(client, s, lot, employee).json()
    route = request_plan(client, s, original["outputs"][0], original)
    assert route["filename"] == "" and route["source_data"] == {"tables": [], "issues": []}
    copied = route["drawings"][0]
    assert copied["id"] != original_id and copied["filename"] == "原图纸.pdf"
    assert client.get(f"{URL}/{route['id']}/drawings/{copied['id']}").content == original_pdf
    word = docx([["流水号", "WAREHOUSE-001"], HEADERS, [1, "返工", "手工要求", 1, 10]])
    rejected = client.post(
        f"{URL}/{route['id']}/source",
        data={"version": route["version"]},
        files={"file": ("返工.docx", word)},
    )
    assert rejected.status_code == 422 and "手工填写" in rejected.text
    uploaded = client.post(
        f"{URL}/{route['id']}/drawings",
        data={"version": route["version"]},
        files={"file": ("补充图纸.pdf", pdf(2))},
    )
    assert uploaded.status_code == 201, uploaded.text
    route = uploaded.json()
    assert len(route["drawings"]) == 2
    saved = save_plan(client, s, route)
    revision = client.post(f"{URL}/{saved['id']}/revise").json()
    assert len(revision["drawings"]) == 2
    assert {drawing["id"] for drawing in revision["drawings"]}.isdisjoint(
        drawing["id"] for drawing in saved["drawings"]
    )
    assert client.get(f"{URL}/{normal['id']}/drawings/{original_id}").content == original_pdf
