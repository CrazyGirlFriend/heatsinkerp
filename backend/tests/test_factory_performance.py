"""Reported work, measured quality and overlapping issue tags have separate meanings."""

from datetime import date, datetime
from itertools import count

import pytest
from app.database import SessionLocal
from app.models import (
    InspectionFeedbackTeam,
    InspectionProblem,
    InspectionProblemType,
    MaterialInspection,
    MaterialQuantityAdjustment,
    Team,
    TeamEmployee,
)
from test_material_transfers import _leader, _team
from test_processing_daily import setup_lot
from test_warehouse_classification import dispatch
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401


@pytest.fixture()
def facts(client, warehouse):
    lot, employee = setup_lot(client, warehouse, "FACTORY-ROLL", quantity=100)
    qc = _team(client, "FACTORY-QC", "检验")
    _, qc_headers = _leader(client, "quality-stats", qc["id"])
    grind = _team(client, "FACTORY-GRIND", "研磨")
    _, grind_headers = _leader(client, "grind-stats", grind["id"])
    with SessionLocal() as db:
        inspector = TeamEmployee(team_id=qc["id"], name="检验员")
        problem1 = InspectionProblemType(team_id=qc["id"], name="外观划伤")
        problem2 = InspectionProblemType(team_id=qc["id"], name="尺寸超差")
        db.add_all([inspector, problem1, problem2])
        db.commit()
        return dict(
            **warehouse,
            lot=lot,
            employee=employee,
            qc=qc,
            qc_headers=qc_headers,
            grind=grind,
            grind_headers=grind_headers,
            inspector_id=inspector.id,
            problems=[problem1.id, problem2.id],
            counter=count(),
        )


def processing(facts, **changes):
    with SessionLocal() as db:
        row = MaterialQuantityAdjustment(
            **{
                "source_transfer_id": facts["lot"]["id"],
                "team_id": facts["other"]["id"],
                "before_quantity": 100,
                "after_quantity": 100,
                "processor_name": facts["employee"]["name"],
                "processor_employee_id": facts["employee"]["id"],
                "processing_date": date(2026, 10, 20),
                "processing_mode": "split",
                "processing_status": "complete",
                "completed_quantity": 100,
                "completed_weight": 10,
                "scrap_quantity": 0,
                "scrap_weight": 0,
                "weight_snapshot": 100,
                "stock_revision_before": 0,
                "reason": "",
                "idempotency_key": f"stats-work-{next(facts['counter'])}",
                "request_hash": "stats",
                "created_by": "测试",
                **changes,
            }
        )
        db.add(row)
        db.commit()
        return row.id


def inspection(facts, *, members=(), problems=(), **changes):
    with SessionLocal() as db:
        row = MaterialInspection(
            **{
                "source_transfer_id": facts["lot"]["id"],
                "team_id": facts["other"]["id"],
                "inspection_team_id": facts["qc"]["id"],
                "inspector_employee_id": facts["inspector_id"],
                "inspector_name": "检验员",
                "checked_at": datetime(2026, 10, 19, 16),
                "batch_quantity": 100,
                "sample_quantity": 10,
                "failed_quantity": 1,
                "kind": "patrol",
                "scope": "sample",
                "blocks_outbound": False,
                "idempotency_key": f"stats-check-{next(facts['counter'])}",
                "request_hash": "stats",
                "created_by": "测试",
                **changes,
            }
        )
        db.add(row)
        db.flush()
        db.add_all(
            InspectionFeedbackTeam(inspection_id=row.id, team_id=team_id) for team_id in members
        )
        db.add_all(
            InspectionProblem(
                inspection_id=row.id,
                problem_type_id=problem_id,
                name=db.get(InspectionProblemType, problem_id).name,
            )
            for problem_id in problems
        )
        db.commit()
        return row.id


def report(client, **params):
    response = client.get(
        "/api/factory-performance",
        params={"date_from": "2026-10-20", "date_to": "2026-10-20", **params},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_actual_work_is_not_stock_delta_and_rework_remains_separate(client, facts):
    processing(facts, processing_task_name="粗磨", completed_quantity=100, completed_weight=10)
    processing(facts, processing_task_name="精磨", completed_quantity=100, completed_weight=9.8)
    processing(
        facts, work_kind="rework", completed_quantity=10, completed_weight=0.98, scrap_weight=0.02
    )
    processing(facts, processor_employee_id=None, completed_quantity=999)
    processing(facts, completed_quantity=None)
    processing(facts, idempotency_key="outbound-clear:stats", completed_quantity=999)
    processing(facts, processing_date=date(2026, 10, 19), completed_quantity=999)
    production = report(client)["production"]
    assert production["totals"] == {
        "record_count": 3,
        "initial_record_count": 2,
        "rework_record_count": 1,
        "completed_quantity": 200,
        "completed_weight": 19.8,
        "rework_quantity": 10,
        "rework_weight": 0.98,
        "work_quantity": 210,
        "work_weight": 20.78,
        "scrap_quantity": 0,
        "scrap_weight": 0.02,
    }
    assert production["trend"] == [{"date": "2026-10-20", **production["totals"]}]
    rolling = next(row for row in production["teams"] if row["team_id"] == facts["other"]["id"])
    assert rolling["work_quantity"] == 210
    assert (
        report(client, team_id=facts["grind"]["id"])["production"]["totals"]["work_quantity"] == 0
    )
    shipped = dispatch(
        client,
        facts,
        [dict(source_transfer_id=facts["lot"]["id"], quantity=10, weight=10)],
        workshop=True,
    )
    assert shipped.status_code == 201, shipped.text
    assert report(client)["production"] == production


def test_weighted_rates_separate_scope_kind_and_reinspection(client, facts):
    root = inspection(facts, sample_quantity=1, failed_quantity=1)
    inspection(facts, sample_quantity=99, failed_quantity=0)
    inspection(facts, scope="full", sample_quantity=100, failed_quantity=20)
    inspection(facts, kind="inspection", sample_quantity=10, failed_quantity=5)
    inspection(facts, parent_id=root, sample_quantity=1, failed_quantity=0)
    data = report(client)
    groups = {(row["kind"], row["scope"], row["phase"]): row for row in data["quality"]["groups"]}
    assert len(groups) == 4
    first = groups[("patrol", "sample", "first")]
    assert first["record_count"] == 2
    assert first["checked_quantity"] == 100
    assert first["passed_quantity"] == 99
    assert first["pass_rate"] == 99
    assert groups[("patrol", "sample", "recheck")]["pass_rate"] == 100
    assert groups[("patrol", "full", "first")]["pass_rate"] == 80
    assert groups[("inspection", "sample", "first")]["pass_rate"] == 50
    # First-check defects remain facts; a passed recheck does not erase the original.
    assert data["issues"]["summary"]["total"] == 3
    assert data["issues"]["problems"] == [
        dict(problem_type_id=None, name="历史未分类", issue_count=3, unresolved_count=3)
    ]


def test_issue_totals_deduplicate_tags_and_team_associations(client, facts):
    members = [facts["other"]["id"], facts["grind"]["id"]]
    root = inspection(facts, members=members, problems=facts["problems"])
    inspection(
        facts,
        members=[facts["other"]["id"]],
        problems=[facts["problems"][0]],
        feedback_status="closed",
    )
    inspection(
        facts,
        parent_id=root,
        members=members,
        problems=facts["problems"],
        checked_at=datetime(2026, 10, 20, 6),
    )
    with SessionLocal() as db:
        problem = db.get(InspectionProblemType, facts["problems"][0])
        problem.name, problem.active = "表面划伤", False
        db.commit()
    issues = report(client)["issues"]
    assert issues["summary"] == dict(total=2, pending=1, processing=0, closed=1, unresolved=1)
    assert issues["problems"] == [
        dict(
            problem_type_id=facts["problems"][0],
            name="表面划伤",
            issue_count=2,
            unresolved_count=1,
        ),
        dict(
            problem_type_id=facts["problems"][1],
            name="尺寸超差",
            issue_count=1,
            unresolved_count=1,
        ),
    ]
    assert sum(row["issue_count"] for row in issues["teams"]) == 3
    assert issues["trend"] == [dict(date="2026-10-20", total=2, unresolved=1)]
    selected = report(client, team_id=facts["grind"]["id"])
    assert selected["issues"]["summary"]["total"] == 1
    assert selected["issues"]["teams"] == [
        dict(team_id=facts["grind"]["id"], team_name="研磨", issue_count=1, unresolved_count=1)
    ]
    # Responsibility membership is not an observation on grinding stock.
    assert selected["quality"]["groups"] == []


def test_issue_visibility_cannot_be_bypassed_with_team_filter(client, facts):
    inspection(facts, members=[facts["other"]["id"]], problems=[facts["problems"][0]])
    inspection(facts, members=[facts["grind"]["id"]], problems=[facts["problems"][1]])
    client.headers.update(facts["other_headers"])
    visible = report(client)["issues"]
    assert visible["summary"]["total"] == 1
    assert [row["problem_type_id"] for row in visible["problems"]] == [facts["problems"][0]]
    assert report(client, team_id=facts["grind"]["id"])["issues"]["summary"]["total"] == 0
    client.headers.update(facts["qc_headers"])
    assert report(client)["issues"]["summary"]["total"] == 2


def test_local_day_boundaries_empty_data_and_inactive_history(client, facts):
    inspection(facts, checked_at=datetime(2026, 10, 19, 15, 59, 59))
    inspection(facts, checked_at=datetime(2026, 10, 19, 16))
    inspection(facts, checked_at=datetime(2026, 10, 20, 15, 59, 59))
    inspection(facts, checked_at=datetime(2026, 10, 20, 16))
    with SessionLocal() as db:
        db.get(Team, facts["other"]["id"]).active = False
        db.commit()
    data = report(client)
    assert data["quality"]["groups"][0]["record_count"] == 2
    assert data["quality"]["trend"][0]["date"] == "2026-10-20"
    assert data["issues"]["summary"]["total"] == 2
    assert not next(row for row in data["teams"] if row["id"] == facts["other"]["id"])["active"]
    empty = report(client, date_from="2026-10-22", date_to="2026-10-23")
    assert empty["quality"] == {"groups": [], "trend": []}
    assert empty["production"]["totals"]["work_quantity"] == 0
    assert empty["issues"]["summary"]["total"] == 0
    assert empty["issues"]["problems"] == []
    assert len(empty["production"]["trend"]) == len(empty["issues"]["trend"]) == 2


@pytest.mark.parametrize(
    "params",
    [
        {"date_from": "2026-10-21", "date_to": "2026-10-20"},
        {"date_from": "2025-01-01", "date_to": "2026-10-20"},
        {"date_to": "0001-01-01"},
        {"date_to": "9999-12-31"},
        {"team_id": 0},
    ],
)
def test_invalid_unbounded_ranges_are_rejected(client, params):
    assert client.get("/api/factory-performance", params=params).status_code == 422


def test_requires_login_and_valid_team(client):
    assert client.get("/api/factory-performance", params={"team_id": 99999}).status_code == 404
    client.headers.pop("Authorization")
    assert client.get("/api/factory-performance").status_code == 401


def test_complete_year_is_bounded_and_fills_zero_work_days(client):
    data = report(client, date_from="2025-10-20", date_to="2026-10-20")
    assert len(data["production"]["trend"]) == 366
    assert len(data["issues"]["trend"]) == 366
    assert data["quality"]["groups"] == []
