"""Verify the physical outsourced batch and its classified QC result through the public APIs."""

from uuid import uuid4

from app.database import SessionLocal
from app.models import MaterialTransfer
from test_material_transfers import _team
from test_processing_daily import work
from test_warehouse_classification import base, confirm, dispatch
from test_warehouse_receipts import intake
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401


def test_outsourced_receipt_dispatch_check_and_inspection_directed_repair(
    client, warehouse, legacy_stock
):
    s = warehouse
    qc_id = s["other"]["id"]
    assert client.patch(f"/api/teams/{qc_id}", json={"code": "FACTORY-QC"}).status_code == 200
    grinder = _team(client, "FACTORY-GRIND", "研磨")
    receipt = intake(client, s, is_outsourced=True, quantity=10, weight=100)
    assert receipt.status_code == 201 and receipt.json()["is_outsourced"]
    shipped = dispatch(
        client, s, [dict(source_transfer_id=receipt.json()["id"], quantity=10, weight=100)]
    )
    assert shipped.status_code == 201, shipped.text
    assert shipped.json()["items"][0]["is_outsourced"]
    received = confirm(client, s, shipped.json(), workshop=True)
    assert received.status_code == 200 and received.json()["is_outsourced"]
    lot = received.json()
    employee = client.get(base(s, True) + "/employees").json()[0]
    lines = [
        dict(category="划伤", quantity=2, disposition="scrap"),
        dict(category="划伤", quantity=3, disposition="rework", repair_team_id=grinder["id"]),
    ]
    check = dict(
        scope="full",
        sample_quantity=10,
        failed_quantity=5,
        methods=["visual"],
        items=["appearance"],
        failure_lines=lines,
    )
    operation = work(client, s, lot, employee, inspection=check, report_template="QC-SANDBLAST")
    assert operation.status_code == 201, operation.text
    path = base(s, True) + "/processing-records"
    for sheet, count in (("QC-SANDBLAST", 1), ("FACTORY-QC", 0), ("QC-DEBURR", 0)):
        page = client.get(path, params={"report_template": sheet, "page_size": 1}).json()
        assert page["total"] == count
        if count:
            detail = page["items"][0]["report_inspections"][0]
            assert detail["failure_lines"][1]["repair_column"] == "研磨"
    issue = client.get("/api/inspections").json()["items"][0]
    assert issue["is_outsourced"] and issue["failure_lines"][1]["repair_team_name"] == "研磨"
    output_id = issue["source_transfer_id"]
    ctx = client.get(
        f"/api/quality-feedback/{issue['id']}/rework-stock",
        params={"source_transfer_id": output_id},
        headers=s["other_headers"],
    ).json()
    body = dict(
        source_transfer_id=output_id,
        inspection_id=issue["id"],
        expected_revision=ctx["revision"],
        repair_team_id=grinder["id"],
        quantity=3,
        weight=30,
        reason="划伤",
        idempotency_key=uuid4().hex,
    )
    url = "/api/process-routes/rework-requests"
    assert client.post(url, json=body, headers=s["headers"]).status_code == 403
    for changes in ({"quantity": 4}, {"repair_team_id": qc_id}):
        assert client.post(url, json=body | changes, headers=s["other_headers"]).status_code == 422
    repair = client.post(url, json=body, headers=s["other_headers"])
    assert repair.status_code == 201, repair.text
    plan = repair.json()
    assert plan["state"] == "published" and [step["team_id"] for step in plan["steps"]] == [
        grinder["id"]
    ]
    assert client.post(url, json=body, headers=s["other_headers"]).json()["id"] == plan["id"]
    with SessionLocal() as db:
        assert db.get(MaterialTransfer, plan["rework_request"]["source_transfer_id"]).is_outsourced


def test_qc_assigns_unprocessed_outsourced_lot_without_a_work_record(
    client, warehouse, legacy_stock
):
    from datetime import datetime, timezone

    s = warehouse
    owner = s["other"]["id"]
    assert client.patch(f"/api/teams/{owner}", json={"code": "FACTORY-QC"}).status_code == 200
    receipt = intake(client, s, is_outsourced=True, quantity=10, weight=100).json()
    sent = dispatch(
        client, s, [dict(source_transfer_id=receipt["id"], quantity=10, weight=100)]
    ).json()
    lot = confirm(client, s, sent, workshop=True).json()
    sources = client.get(
        "/api/inspections/sources", params={"kind": "inspection", "team_id": owner}
    ).json()["items"]
    assert len(sources) == 1 and sources[0]["is_outsourced"]
    employee = client.get(base(s, True) + "/employees").json()[0]
    body = dict(
        kind="inspection",
        source_transfer_id=lot["id"],
        expected_revision=sources[0]["revision"],
        checked_at=datetime.now(timezone.utc).isoformat(),
        inspector_employee_id=employee["id"],
        scope="sample",
        sample_quantity=3,
        failed_quantity=2,
        methods=["visual"],
        items=["appearance"],
        failure_lines=[
            dict(
                category="坑",
                quantity=2,
                disposition="rework",
                repair_team_id=owner,
                repair_column="修毛刺",
            )
        ],
        idempotency_key=uuid4().hex,
    )
    issue = client.post("/api/inspections", headers=s["other_headers"], json=body)
    assert issue.status_code == 201, issue.text
    assert issue.json()["processing_record_id"] is None
    result = client.post(
        "/api/process-routes/rework-requests",
        headers=s["other_headers"],
        json={
            "source_transfer_id": lot["id"],
            "inspection_id": issue.json()["id"],
            "repair_team_id": owner,
            "expected_revision": sources[0]["revision"],
            "quantity": 2,
            "weight": 20,
            "reason": "去毛刺",
            "idempotency_key": uuid4().hex,
        },
    )
    assert result.status_code == 201, result.text
    child = {"id": result.json()["rework_request"]["source_transfer_id"]}
    repaired = work(
        client, s, child, employee, work_kind="rework", completed_quantity=2, completed_weight=20
    )
    assert repaired.status_code == 201, repaired.text
    assert repaired.json()["rework_of_id"] is None


def test_same_task_recorded_on_separate_original_reports_before_pagination(
    client, warehouse, legacy_stock
):
    from test_processing_daily import setup_lot

    lot, person = setup_lot(client, warehouse, code="FACTORY-QC")
    team_url = base(warehouse, True)
    task = client.post(team_url + "/processing-tasks", json={"name": "打标"}).json()
    for sheet in ("QC-SANDBLAST", "FACTORY-QC", "QC-DEBURR", "FACTORY-QC"):
        record = work(
            client,
            warehouse,
            lot,
            person,
            processing_task_id=task["id"],
            report_template=sheet,
            completed_quantity=2,
            completed_weight=20,
            idempotency_key=uuid4().hex,
        )
        assert record.status_code == 201, record.text
        lot = next(row for row in record.json()["outputs"] if row["role"] == "remaining")
    records = team_url + "/processing-records"
    for sheet, total in (("FACTORY-QC", 2), ("QC-SANDBLAST", 1), ("QC-DEBURR", 1)):
        filters = {"report_template": sheet, "page_size": 1}
        page = client.get(records, params=filters).json()
        assert page["total"] == total and len(page["items"]) == 1
        assert page["summary"]["completed_quantity"] == total * 2
        second = client.get(records, params={**filters, "page": 2}).json()
        assert len(second["items"]) == total - 1

    # An older client could register a shared task without naming its daily sheet.
    legacy = work(
        client,
        warehouse,
        lot,
        person,
        processing_task_id=task["id"],
        completed_quantity=2,
        completed_weight=20,
        idempotency_key=uuid4().hex,
    )
    assert legacy.status_code == 201, legacy.text
    assert client.get(records).json()["total"] == 5
    for sheet, total in (("FACTORY-QC", 2), ("QC-SANDBLAST", 1), ("QC-DEBURR", 1)):
        assert client.get(records, params={"report_template": sheet}).json()["total"] == total


def test_inspection_can_assign_legacy_pending_repair_without_splitting_again(
    client, warehouse, legacy_stock
):
    from app.models import MaterialInspection, MaterialStockBalance, ProcessRoute
    from sqlalchemy import select
    from test_team_problem_workflow import request

    lot, route, _, engineering = request(client, warehouse)
    with SessionLocal.begin() as db:
        old = db.get(ProcessRoute, route["id"])
        issue_id = db.scalar(
            select(MaterialInspection.id).where(MaterialInspection.source_transfer_id == lot["id"])
        )
        old.rework_inspection_id = issue_id
        stock_before = db.get(MaterialStockBalance, lot["id"]).on_hand_quantity
    url = f"/api/quality-feedback/{issue_id}"
    qc = warehouse["rework_qc_headers"]
    pending = client.get(url, headers=qc).json()["pending_repairs"]
    assert [r["id"] for r in pending] == [route["id"]]
    endpoint = url + f"/pending-repairs/{route['id']}/assign"
    params = {"repair_team_id": warehouse["other"]["id"]}
    assert client.post(endpoint, params=params, headers=engineering).status_code == 403
    assigned = client.post(endpoint, params=params, headers=qc)
    assert assigned.status_code == 200, assigned.text
    assert assigned.json()["pending_repairs"] == []
    assert client.post(endpoint, params=params, headers=qc).status_code == 200
    with SessionLocal() as db:
        assert db.get(MaterialStockBalance, lot["id"]).on_hand_quantity == stock_before
