"""Team feedback defaults to local work; upstream work requires an explicit team choice."""

from uuid import uuid4

import pytest
from app.database import SessionLocal
from app.models import MaterialInspection, MaterialStockBalance, Team
from app.models import MaterialQuantityAdjustment as Work
from receipt_helpers import receipt_post
from sqlalchemy import select
from test_engineered_rework import save_plan
from test_material_transfers import _leader
from test_quantity_adjustments import processing_lot
from test_team_rework_workflow import prepare
from test_warehouse_classification import dispatch
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

URL = "/api/process-routes"


@pytest.fixture()
def history(client, warehouse):
    lot, body, _, _ = prepare(client, warehouse)
    body.pop("inspection_id")
    body.pop("repair_team_id")
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
    teams = response.json()["rework_problem_teams"]
    upstream = next(team for team in teams if team["name"] == "线切割")
    response = client.get(
        URL + "/rework-sources",
        params={"lot_id": lot["id"], "problem_team_id": upstream["id"]},
        headers=warehouse["other_headers"],
    )
    assert response.status_code == 200, response.text
    assert response.json()["rework_problem_team_id"] == upstream["id"]
    assert len(response.json()["rework_task_records"]) == 1
    assert response.json()["rework_task_records"][0]["team_name"] == "线切割"


def test_explicit_upstream_report_links_quality_and_engineering_then_transfers_by_route(
    client, warehouse, history
):
    lot, body, foreign_id = history
    headers = warehouse["other_headers"]
    with SessionLocal() as db:
        upstream_id = db.get(Work, foreign_id).team_id
    response = client.get(
        URL + "/rework-sources",
        params={"lot_id": lot["id"], "problem_team_id": upstream_id},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    assert [r["rework_of_id"] for r in response.json()["rework_task_records"]] == [foreign_id]
    payload = {**body, "rework_of_id": foreign_id, "problem_team_id": upstream_id}
    response = client.post(URL + "/rework-requests", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    route = response.json()
    assert route["rework_request"]["requesting_team_id"] == warehouse["other"]["id"]
    assert route["rework_request"]["problem_teams"] == [{"id": upstream_id, "name": "线切割"}]
    assert (
        client.post(URL + "/rework-requests", json=payload, headers=headers).json()["id"]
        == route["id"]
    )
    detail_url = f"/api/quality-feedback/team-problems/{route['id']}"
    for reader in (headers, client.headers, warehouse["rework_qc_headers"]):
        detail = client.get(detail_url, headers=reader).json()
        assert detail["team_id"] == warehouse["other"]["id"]
        assert detail["involved_teams"][0]["team_id"] == upstream_id
        assert detail["route_state"] == "draft"
    rows = client.get(URL, params={"kind": "rework", "state": "draft"}, headers=headers).json()
    assert rows["items"][0]["id"] == route["id"]
    assert rows["pending_rework_count"] == 1
    child_id = route["rework_request"]["source_transfer_id"]
    lines = [dict(source_transfer_id=child_id, quantity=2, weight=20)]
    blocked = dispatch(
        client,
        warehouse,
        lines,
        workshop=True,
        next_team_id=upstream_id,
        idempotency_key=uuid4().hex,
    )
    assert blocked.status_code == 422 and "检验" in blocked.text
    save_plan(client, warehouse, route, team=upstream_id)
    assert client.get(detail_url, headers=headers).json()["route_state"] == "published"
    wrong_team = dispatch(client, warehouse, lines, workshop=True, idempotency_key=uuid4().hex)
    assert wrong_team.status_code == 422, wrong_team.text
    sent = dispatch(
        client,
        warehouse,
        lines,
        workshop=True,
        next_team_id=upstream_id,
        idempotency_key=uuid4().hex,
    )
    assert sent.status_code == 201, sent.text
    transfer = sent.json()["items"][0]
    _, upstream_headers = _leader(client, "upstream-rework-leader", upstream_id)
    received = receipt_post(
        client,
        f"/api/material-transfers/{transfer['batch_no']}/confirm",
        headers=upstream_headers,
        json={"idempotency_key": uuid4().hex, "expected_version": transfer["version"]},
    )
    assert received.status_code == 200, received.text
    context = client.get(
        f"/api/team-materials/{upstream_id}/stock/{transfer['id']}/quantity-adjustments",
        headers=upstream_headers,
    ).json()
    assert context["rework_route_ready"] is True
    assert context["process_route"]["id"] == route["id"]
    assert context["process_route"]["instructions"] == payload["reason"]
    with SessionLocal() as db:
        assert db.get(MaterialStockBalance, lot["id"]).on_hand_quantity == 8


def test_explicit_team_choice_cannot_bypass_batch_and_record_checks(client, warehouse, history):
    lot, body, foreign_id = history
    headers = warehouse["other_headers"]
    wrong = client.get(
        URL + "/rework-sources",
        params={"lot_id": lot["id"], "problem_team_id": warehouse["team"]["id"]},
        headers=headers,
    )
    assert wrong.status_code == 422
    mismatch = client.post(
        URL + "/rework-requests",
        json={**body, "rework_of_id": foreign_id, "problem_team_id": warehouse["other"]["id"]},
        headers=headers,
    )
    assert mismatch.status_code == 422 and "不一致" in mismatch.text
    other_lot = processing_lot(
        client, warehouse, quantity=10, weight=100, idempotency_key=uuid4().hex
    )
    with SessionLocal() as db:
        upstream_id = db.get(Work, foreign_id).team_id
    context = client.get(
        URL + "/rework-sources", params={"lot_id": other_lot["id"]}, headers=headers
    ).json()
    unrelated = client.post(
        URL + "/rework-requests",
        json={
            **body,
            "source_transfer_id": other_lot["id"],
            "expected_revision": context["revision"],
            "rework_of_id": foreign_id,
            "problem_team_id": upstream_id,
        },
        headers=headers,
    )
    assert unrelated.status_code == 422 and "不属于本批" in unrelated.text
    with SessionLocal() as db:
        assert db.get(MaterialStockBalance, lot["id"]).on_hand_quantity == 10
        assert db.get(MaterialStockBalance, other_lot["id"]).on_hand_quantity == 10


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
