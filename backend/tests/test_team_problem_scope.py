"""Team feedback is local; QC can identify an upstream operation on the same stock."""

from uuid import uuid4

import pytest
from app.database import SessionLocal
from app.models import MaterialInspection, MaterialStockBalance, Team
from app.models import MaterialQuantityAdjustment as Work
from receipt_helpers import receipt_post
from sqlalchemy import select
from test_quantity_adjustments import processing_lot
from test_team_rework_notices import prepare
from test_warehouse_classification import dispatch
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

URL = "/api/process-routes"


@pytest.fixture()
def history(client, warehouse):
    lot, body, _, _ = prepare(client, warehouse)
    body.pop("inspection_id")
    with SessionLocal.begin() as db:
        original = db.get(Work, body["rework_of_id"])
        upstream = Team(code="FACTORY-WIRE", name="线切割", kind="production", active=True)
        db.add(upstream)
        db.flush()
        fields = {
            column.name: getattr(original, column.name)
            for column in Work.__table__.columns
            if column.name != "id"
        }
        # Append representative historical work snapshots without editing the ledger.
        own = Work(
            **{
                **fields,
                "process_step_name": "第 4 道工序 · 精轧",
                "process_step_instructions": "精轧至 2.50±0.01 mm，表面不得有压痕。",
                "processing_task_name": "精轧",
                "idempotency_key": uuid4().hex,
            }
        )
        db.add(own)
        db.flush()
        body["rework_of_id"] = own.id
        fields.update(
            team_id=upstream.id,
            processor_employee_id=None,
            processor_name="上序师傅",
            equipment_id=None,
            process_step_name="第 1 道工序 · 粗切",
            process_step_instructions="按图粗切，留磨削余量。",
            processing_task_name="粗切",
            idempotency_key=uuid4().hex,
        )
        foreign = Work(**fields)
        db.add(foreign)
        db.flush()
        foreign_id = foreign.id
    return lot, body, foreign_id


@pytest.mark.parametrize(
    "code,name",
    [
        ("FACTORY-ROLL", "轧制"),
        ("FACTORY-WIRE", "线切割"),
        ("FACTORY-ENGRAVE", "雕刻"),
        ("FACTORY-ANNEAL", "退火"),
        ("FACTORY-GRIND", "研磨"),
        ("FACTORY-PLATE", "电镀"),
    ],
)
def test_team_lists_only_own_operations_and_rejects_foreign_record_submission(
    client, warehouse, history, code, name
):
    lot, body, foreign_id = history
    with SessionLocal.begin() as db:
        upstream = db.get(Team, db.get(Work, foreign_id).team_id)
        upstream.code, upstream.name = "UPSTREAM-TEST", "上序测试班组"
        db.flush()
        team = db.get(Team, warehouse["other"]["id"])
        team.code, team.name = code, name
    headers = warehouse["other_headers"]
    response = client.get(URL + "/rework-sources", params={"lot_id": lot["id"]}, headers=headers)
    assert response.status_code == 200, response.text
    records = response.json()["rework_task_records"]
    assert len(records) == 2
    assert all(row["team_id"] == warehouse["other"]["id"] for row in records)
    assert records[0]["rework_of_id"] == body["rework_of_id"]
    assert records[0]["team_id"] == warehouse["other"]["id"]
    assert records[0]["team_name"] == name
    assert records[0]["process_step_name"] == "第 4 道工序 · 精轧"
    assert records[0]["process_step_instructions"] == "精轧至 2.50±0.01 mm，表面不得有压痕。"
    assert records[0]["processing_date"] == "2026-10-15"
    assert records[0]["processor_name"] == "测试收料员"
    assert records[0]["completed_quantity"] == 10
    assert records[0]["work_kind"] == "initial"
    denied = client.post(
        URL + "/rework-requests", json={**body, "rework_of_id": foreign_id}, headers=headers
    )
    assert denied.status_code == 403 and "本班组" in denied.text
    with SessionLocal() as db:
        assert db.get(MaterialStockBalance, lot["id"]).on_hand_quantity == 10
    accepted = client.post(URL + "/rework-requests", json=body, headers=headers)
    assert accepted.status_code == 201, accepted.text


def test_no_local_work_does_not_fall_back_to_an_upstream_record(client, warehouse, history):
    _, _, foreign_id = history
    lot = processing_lot(client, warehouse, quantity=10, weight=100, idempotency_key=uuid4().hex)
    with SessionLocal.begin() as db:
        foreign = db.get(Work, foreign_id)
        fields = {
            column.name: getattr(foreign, column.name)
            for column in Work.__table__.columns
            if column.name != "id"
        }
        fields.update(source_transfer_id=lot["id"], outputs=[], idempotency_key=uuid4().hex)
        db.add(Work(**fields))
    response = client.get(
        URL + "/rework-sources", params={"lot_id": lot["id"]}, headers=warehouse["other_headers"]
    )
    assert response.status_code == 200, response.text
    assert response.json()["rework_task_records"] == []
    assert response.json()["rework_of_id"] is None


def test_qc_quality_issue_context_keeps_full_cross_team_operation_details(
    client, warehouse, history
):
    lot, body, foreign_id = history
    with SessionLocal() as db:
        issue_id = db.scalar(select(MaterialInspection.id))
    path = f"/api/quality-feedback/{issue_id}/rework-stock"
    response = client.get(
        path,
        params={"source_transfer_id": lot["id"]},
        headers=warehouse["rework_qc_headers"],
    )
    assert response.status_code == 200, response.text
    records = {row["rework_of_id"]: row for row in response.json()["rework_task_records"]}
    assert (
        records[body["rework_of_id"]]["process_step_instructions"]
        == "精轧至 2.50±0.01 mm，表面不得有压痕。"
    )
    assert records[foreign_id]["team_name"] == "线切割"
    assert records[foreign_id]["processor_name"] == "上序师傅"
    assert records[foreign_id]["processing_date"] == "2026-10-15"
    assert client.get(path, headers=warehouse["other_headers"]).status_code == 403


def test_qc_keeps_cross_team_history_and_can_report_the_upstream_operation(
    client, warehouse, history
):
    lot, body, foreign_id = history
    with SessionLocal() as db:
        qc_id = db.scalar(select(Team.id).where(Team.code == "FACTORY-QC"))
    sent = dispatch(
        client,
        warehouse,
        [dict(source_transfer_id=lot["id"], quantity=10, weight=100)],
        workshop=True,
        next_team_id=qc_id,
        idempotency_key=uuid4().hex,
    )
    assert sent.status_code == 201, sent.text
    transfer = sent.json()["items"][0]
    headers = warehouse["rework_qc_headers"]
    received = receipt_post(
        client,
        f"/api/material-transfers/{transfer['batch_no']}/confirm",
        headers=headers,
        json={"idempotency_key": uuid4().hex, "expected_version": transfer["version"]},
    )
    assert received.status_code == 200, received.text
    response = client.get(
        URL + "/rework-sources", params={"lot_id": transfer["id"]}, headers=headers
    )
    assert response.status_code == 200, response.text
    context = response.json()
    records = context["rework_task_records"]
    assert len(records) == 3
    assert {body["rework_of_id"], foreign_id} <= {row["rework_of_id"] for row in records}
    foreign = next(row for row in records if row["rework_of_id"] == foreign_id)
    assert foreign["team_name"] == "线切割"
    assert foreign["process_step_instructions"] == "按图粗切，留磨削余量。"
    result = client.post(
        URL + "/rework-requests",
        headers=headers,
        json={
            **body,
            "source_transfer_id": transfer["id"],
            "expected_revision": context["revision"],
            "rework_of_id": foreign_id,
        },
    )
    assert result.status_code == 201, result.text
