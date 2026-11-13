"""Original production reports use checks linked to the exact recorded work."""

import pytest
from app.database import SessionLocal
from app.models import MaterialTransfer
from test_inspections import create_check
from test_inspections import inspection as inspection  # noqa: F401
from test_processing_daily import setup_lot, work
from test_warehouse_classification import base
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

pytestmark = pytest.mark.usefixtures("legacy_stock")


def test_report_keeps_rechecks_separate_and_does_not_join_by_serial(client, inspection):
    s, _, _, _ = inspection
    created = create_check(client, inspection)
    assert created.status_code == 201, created.text
    first = created.json()
    recheck = create_check(
        client,
        inspection,
        parent_id=first["id"],
        failed_quantity=0,
        involved_team_ids=[],
        idempotency_key="report-recheck",
    )
    assert recheck.status_code == 201, recheck.text
    # The same serial can have another physical batch and another processing record.
    lot, employee = setup_lot(client, s, idempotency_key="report-second-lot")
    second = work(client, s, lot, employee, idempotency_key="report-second-work")
    assert second.status_code == 201, second.text
    response = client.get(base(s, True) + "/processing-records")
    assert response.status_code == 200, response.text
    rows = {row["id"]: row for row in response.json()["items"]}
    checked = rows[first["processing_record_id"]]
    assert checked["serial_no"] == rows[second.json()["id"]]["serial_no"]
    assert rows[second.json()["id"]]["report_inspections"] == []
    assert rows[second.json()["id"]]["finished_quantity"] is None
    observations = checked["report_inspections"]
    assert [item["id"] for item in observations] == [first["id"], recheck.json()["id"]]
    assert [item["sample_quantity"] for item in observations] == [5, 5]
    assert [item["passed_quantity"] for item in observations] == [4, 5]
    assert [item["failed_quantity"] for item in observations] == [1, 0]
    assert observations[0]["disposition"] == "pending"
    assert observations[0]["problem_names"] == ["表面划伤"]
    assert observations[1]["parent_id"] == first["id"]
    assert checked["completed_quantity"] == 10
    assert response.json()["summary"]["completed_quantity"] == 20
    with SessionLocal() as db:
        source = db.get(MaterialTransfer, checked["source_transfer_id"])
        source.finished_quantity = 4008
        db.commit()
    page = client.get(base(s, True) + "/processing-records", params={"page_size": 1, "page": 2})
    assert page.status_code == 200, page.text
    assert page.json()["items"][0]["finished_quantity"] == 4008
    assert len(page.json()["items"][0]["report_inspections"]) == 2


@pytest.mark.parametrize("disposition", ["scrap", "rework"])
def test_report_exposes_only_the_recorded_quality_decision(client, inspection, disposition):
    s, _, headers, _ = inspection
    created = create_check(client, inspection)
    assert created.status_code == 201, created.text
    issue = created.json()
    decision = client.post(
        f"/api/quality-feedback/{issue['id']}/decision",
        headers=headers,
        json=dict(
            expected_version=issue["feedback_version"],
            disposition=disposition,
            status="processing",
            involved_team_ids=[s["other"]["id"]],
            idempotency_key="report-decision",
        ),
    )
    assert decision.status_code == 200, decision.text
    response = client.get(base(s, True) + "/processing-records")
    assert response.status_code == 200, response.text
    row = response.json()["items"][0]
    assert row["report_inspections"][0]["disposition"] == disposition
    assert row["report_inspections"][0]["failed_quantity"] == 1
    # Quality decisions do not rewrite production or physical-stock amounts.
    assert row["completed_quantity"] == 10
    assert row["on_hand_quantity"] == 10
