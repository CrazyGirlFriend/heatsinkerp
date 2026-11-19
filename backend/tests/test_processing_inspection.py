"""QC registration persists work and its quality results as one operation."""

import pytest
from app.database import SessionLocal
from app.models import InspectionProblemType, MaterialInspection, MaterialQuantityAdjustment
from sqlalchemy import func, select
from test_processing_daily import setup_lot, work
from test_warehouse_classification import base
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

pytestmark = pytest.mark.usefixtures("legacy_stock")


def results(s, problem_id=None, **overrides):
    return (
        dict(
            scope="full",
            sample_quantity=6,
            failed_quantity=1 if problem_id else 0,
            methods=["visual"],
            items=["appearance"],
            involved_team_ids=[s["team"]["id"]] if problem_id else [],
            problem_type_ids=[problem_id] if problem_id else [],
            failure_lines=[dict(category="划伤", disposition="scrap", quantity=1)]
            if problem_id
            else [],
            notes="表面划伤" if problem_id else "",
        )
        | overrides
    )


def problem(s):
    with SessionLocal() as db:
        row = InspectionProblemType(team_id=s["other"]["id"], name="划伤")
        db.add(row)
        db.commit()
        return row.id


def test_partial_qc_work_links_results_quality_and_daily_report_once(client, warehouse):
    s = warehouse
    lot, employee = setup_lot(client, s, "FACTORY-QC")
    context = client.get(base(s, True) + f"/stock/{lot['id']}/quantity-adjustments").json()
    assert context["inspection_enabled"]
    body = dict(completed_quantity=6, completed_weight=60, inspection=results(s, problem(s)))
    response = work(client, s, lot, employee, **body)
    assert response.status_code == 201, response.text
    record = response.json()
    output = next(item for item in record["outputs"] if item["role"] == "produced")
    remaining = next(item for item in record["outputs"] if item["role"] == "remaining")
    assert remaining["quantity"] == 4
    checks = client.get("/api/inspections").json()
    assert checks["total"] == 1
    check = checks["items"][0]
    assert check["source_transfer_id"] == output["id"]
    assert check["processing_record_id"] == record["id"]
    assert (check["sample_quantity"], check["passed_quantity"], check["failed_quantity"]) == (
        6,
        5,
        1,
    )
    issues = client.get("/api/quality-feedback", headers=s["headers"]).json()
    assert issues["total"] == 1
    assert issues["items"][0]["involved_teams"][0]["team_id"] == s["team"]["id"]
    report = client.get(base(s, True) + "/processing-records").json()["items"][0]
    assert report["report_inspections"][0]["passed_quantity"] == 5
    replay = work(
        client, s, lot, employee, expected_revision=context["revision"], quantity=10, **body
    )
    assert replay.status_code == 201, replay.text
    assert replay.json()["id"] == record["id"]
    assert client.get("/api/inspections").json()["total"] == 1


@pytest.mark.parametrize(
    "overrides",
    [
        {"sample_quantity": 7},
        {"sample_quantity": 5},
        {"failed_quantity": 7},
        {"problem_type_ids": [999999]},
        {"involved_team_ids": [999999]},
        {"failure_lines": []},
        {"failure_lines": [dict(category="划伤", disposition="rework", quantity=1)]},
    ],
)
def test_invalid_results_do_not_leave_work_or_consumed_stock(client, warehouse, overrides):
    s = warehouse
    lot, employee = setup_lot(client, s, "FACTORY-QC")
    response = work(
        client,
        s,
        lot,
        employee,
        completed_quantity=6,
        completed_weight=60,
        inspection=results(s, problem(s), **overrides),
    )
    assert response.status_code == 422, response.text
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(MaterialQuantityAdjustment)) == 0
        assert db.scalar(select(func.count()).select_from(MaterialInspection)) == 0
    context = client.get(base(s, True) + f"/stock/{lot['id']}/quantity-adjustments").json()
    assert context["quantity"] == 10


def test_sample_passes_without_creating_quality_problem(client, warehouse):
    s = warehouse
    lot, employee = setup_lot(client, s, "FACTORY-QC")
    response = work(
        client, s, lot, employee, inspection=results(s, scope="sample", sample_quantity=3)
    )
    assert response.status_code == 201, response.text
    check = client.get("/api/inspections").json()["items"][0]
    assert (check["batch_quantity"], check["passed_quantity"], check["failed_quantity"]) == (
        10,
        3,
        0,
    )
    assert client.get("/api/quality-feedback").json()["total"] == 0


def test_other_teams_cannot_submit_qc_results(client, warehouse):
    s = warehouse
    lot, employee = setup_lot(client, s)
    context = client.get(base(s, True) + f"/stock/{lot['id']}/quantity-adjustments").json()
    assert not context["inspection_enabled"]
    response = work(client, s, lot, employee, inspection=results(s, sample_quantity=10))
    assert response.status_code == 422, response.text
    assert "仅检验班组" in response.text
