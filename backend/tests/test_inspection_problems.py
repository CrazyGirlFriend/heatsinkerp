"""Only QC leaders define problem choices; history survives catalog changes."""

import pytest
from app.database import SessionLocal
from app.models import InspectionProblemType
from test_inspections import create_check
from test_inspections import inspection as inspection
from test_warehouse_receipts import warehouse  # noqa: F401


def catalog(client, context):
    _, _, headers, body = context
    with SessionLocal() as db:
        problem = db.get(InspectionProblemType, body["problem_type_ids"][0])
        return f"/api/team-materials/{problem.team_id}/inspection-problems", problem.id, headers


def test_catalog_permissions_versions_and_duplicate_names(client, inspection):
    url, problem_id, headers = catalog(client, inspection)
    s, _, _, _ = inspection
    assert client.post(url, json={"name": "缺口"}).status_code == 403
    assert client.post(url, headers=s["other_headers"], json={"name": "缺口"}).status_code == 403
    row = client.post(url, headers=headers, json={"name": "  缺口  "})
    assert row.status_code == 201, row.text
    assert row.json()["name"] == "缺口"
    assert client.post(url, headers=headers, json={"name": "缺口"}).status_code == 409
    assert client.post(url, headers=headers, json={"name": "   "}).status_code == 422
    assert client.get(url, headers=s["other_headers"]).status_code == 200
    assert (
        client.patch(
            f"{url}/{problem_id}", headers=headers, json={"name": "刮伤", "expected_version": 99}
        ).status_code
        == 409
    )
    assert (
        client.post(
            f"/api/team-materials/{s['other']['id']}/inspection-problems",
            headers=headers,
            json={"name": "越权"},
        ).status_code
        == 403
    )


@pytest.mark.parametrize("ids", [[], [999999], [1, 1], [-1]])
def test_failed_check_must_select_valid_distinct_problem(client, inspection, ids):
    response = create_check(client, inspection, problem_type_ids=ids)
    assert response.status_code == 422, response.text
    assert client.get("/api/inspections").json()["total"] == 0


def test_problem_snapshot_filters_disable_and_idempotent_replay(client, inspection):
    url, problem_id, headers = catalog(client, inspection)
    second = client.post(url, headers=headers, json={"name": "尺寸超差"}).json()
    saved = create_check(client, inspection, problem_type_ids=[problem_id, second["id"]])
    assert saved.status_code == 201, saved.text
    assert saved.json()["problems"] == [
        {"id": problem_id, "name": "表面划伤"},
        {"id": second["id"], "name": "尺寸超差"},
    ]
    change = client.patch(
        f"{url}/{problem_id}",
        headers=headers,
        json={"name": "表面刮伤", "active": False, "expected_version": 1},
    )
    assert change.status_code == 200, change.text
    assert (
        create_check(client, inspection, problem_type_ids=[problem_id, second["id"]]).json()
        == saved.json()
    )
    assert create_check(client, inspection, idempotency_key="disabled-problem").status_code == 422
    for path in ("/api/inspections", "/api/quality-feedback"):
        listed = client.get(path, params={"problem_type_id": problem_id}).json()
        assert listed["total"] == 1
        assert listed["items"][0]["problems"][0]["name"] == "表面划伤"
        assert client.get(path, params={"problem_type_id": 999999}).json()["total"] == 0
    detail = client.get(f"/api/quality-feedback/{saved.json()['id']}").json()
    assert detail["problems"] == saved.json()["problems"]


def test_pass_cannot_carry_problems_and_failed_recheck_requires_selection(client, inspection):
    _, _, _, body = inspection
    assert (
        create_check(
            client,
            inspection,
            failed_quantity=0,
            involved_team_ids=[],
            problem_type_ids=body["problem_type_ids"],
        ).status_code
        == 422
    )
    root = create_check(client, inspection).json()
    assert (
        create_check(
            client,
            inspection,
            parent_id=root["id"],
            involved_team_ids=[],
            problem_type_ids=[],
            idempotency_key="bad-recheck",
        ).status_code
        == 422
    )
    passed = create_check(
        client,
        inspection,
        parent_id=root["id"],
        involved_team_ids=[],
        failed_quantity=0,
        idempotency_key="passed-recheck",
    )
    assert passed.status_code == 201, passed.text
    assert passed.json()["problems"] == []
