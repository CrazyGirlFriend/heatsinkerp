"""Manual quality involvement drives notification visibility, never the sender."""

from app.database import SessionLocal
from app.models import MaterialInspection, QualityNotice
from app.team_constants import ENGINEERING_TEAM_CODE, ENGINEERING_TEAM_NAME
from sqlalchemy import func, select
from test_business_notices import INBOX, inbox
from test_inspections import create_check  # noqa: F401
from test_inspections import inspection as inspection
from test_material_transfers import _leader
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401


def decide(client, headers, row, **overrides):
    return client.post(
        f"/api/quality-feedback/{row['id']}/decision",
        headers=headers,
        json={
            "expected_version": row["feedback_version"],
            "disposition": "other",
            "status": "processing",
            "involved_team_ids": [row["team_id"]],
            "idempotency_key": "quality-decision",
            **overrides,
        },
    )


def test_only_selected_teams_receive_quality_messages_and_receipts_are_independent(
    client, inspection
):
    s, lot, qc_headers, _ = inspection
    response = create_check(client, inspection, involved_team_ids=[s["team"]["id"]])
    assert response.status_code == 201, response.text
    issue = response.json()
    own = inbox(client, s["headers"], category="quality")
    assert own["total"] == own["unread"] == 1
    assert inbox(client, s["other_headers"], category="quality")["total"] == 0
    assert inbox(client, qc_headers, category="quality")["total"] == 0
    item = own["items"][0]
    assert item["kind"] == "quality_reported"
    assert item["serial_no"] == lot["serial_no"] and item["batch_no"] == lot["batch_no"]
    assert "不合格 1 件" in item["message"] and "表面划伤" in item["message"]
    assert item["action_required"]
    path = f"{INBOX}/quality/{item['id']}"
    target = client.get(path + "/target", headers=s["headers"])
    assert target.status_code == 200, target.text
    assert target.json() == {
        "href": f"/team-workspaces/{s['team']['id']}?tab=quality-feedback&issue={issue['id']}",
        "section": "quality",
    }
    for suffix in ("/target", "/read"):
        request = client.get if suffix == "/target" else client.post
        assert request(path + suffix, headers=s["other_headers"]).status_code == 404
    assert client.post(path + "/read", headers=s["headers"]).status_code == 204
    assert client.post(path + "/read", headers=s["headers"]).status_code == 204
    assert inbox(client, s["headers"], category="quality")["unread"] == 0
    assert inbox(client, category="quality")["unread"] == 1
    _, another = _leader(client, "quality-another", s["team"]["id"])
    assert inbox(client, another, category="quality")["unread"] == 1
    assert create_check(client, inspection, involved_team_ids=[s["team"]["id"]]).status_code == 201
    assert inbox(client, category="quality")["total"] == 1
    # Reading a message is not replying to the quality issue.
    assert inbox(client, s["headers"], category="pending")["total"] == 1
    reply = client.post(
        f"/api/quality-feedback/{issue['id']}/reply",
        headers=s["headers"],
        json={
            "notes": "已核查，等待检验处理",
            "expected_version": 0,
            "idempotency_key": "quality-reply",
        },
    )
    assert reply.status_code == 200, reply.text
    assert inbox(client, s["headers"], category="pending")["total"] == 0
    assert inbox(client, s["headers"], category="quality")["total"] == 1


def test_changed_involvement_notifies_new_team_and_revokes_removed_team(client, inspection):
    s, _, qc_headers, _ = inspection
    issue = create_check(client, inspection).json()
    old = inbox(client, s["other_headers"], category="quality")["items"][0]
    response = decide(client, qc_headers, issue, involved_team_ids=[s["team"]["id"]])
    assert response.status_code == 200, response.text
    assert decide(client, qc_headers, issue, involved_team_ids=[s["team"]["id"]]).status_code == 200
    assert inbox(client, s["other_headers"], category="quality")["total"] == 0
    assert (
        client.get(f"{INBOX}/quality/{old['id']}/target", headers=s["other_headers"]).status_code
        == 404
    )
    assert (
        client.post(f"{INBOX}/quality/{old['id']}/read", headers=s["other_headers"]).status_code
        == 404
    )
    assert inbox(client, s["headers"], category="quality")["total"] == 1
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(QualityNotice)) == 2
    closed = decide(
        client,
        qc_headers,
        response.json(),
        involved_team_ids=[s["team"]["id"]],
        status="closed",
        idempotency_key="quality-close",
    )
    assert closed.status_code == 200, closed.text
    assert inbox(client, s["headers"], category="pending")["total"] == 0


def test_quality_read_all_is_bounded_and_successful_checks_create_no_notice(client, inspection):
    s, _, _, _ = inspection
    assert (
        create_check(client, inspection, failed_quantity=0, involved_team_ids=[]).status_code == 201
    )
    assert inbox(client, category="quality")["total"] == 0
    assert (
        create_check(client, inspection, idempotency_key="quality-failure-one").status_code == 201
    )
    loaded = inbox(client, s["other_headers"], category="quality")
    assert (
        create_check(client, inspection, idempotency_key="quality-failure-two").status_code == 201
    )
    assert (
        client.post(
            INBOX + "/read-all", headers=s["other_headers"], json=loaded["latest"]
        ).status_code
        == 204
    )
    assert inbox(client, s["other_headers"], category="quality")["unread"] == 1
    assert inbox(client, category="quality")["unread"] == 2


def test_selected_engineering_team_opens_quality_issue_without_workspace_redirect(
    client, inspection
):
    response = client.post(
        "/api/teams",
        json={"code": ENGINEERING_TEAM_CODE, "name": ENGINEERING_TEAM_NAME, "kind": "engineering"},
    )
    assert response.status_code == 201, response.text
    engineering = response.json()
    _, headers = _leader(client, "quality-engineer", engineering["id"])
    created = create_check(client, inspection, involved_team_ids=[engineering["id"]])
    assert created.status_code == 201, created.text
    issue = created.json()
    item = inbox(client, headers, category="quality")["items"][0]
    target = client.get(f"{INBOX}/quality/{item['id']}/target", headers=headers)
    assert target.status_code == 200, target.text
    with SessionLocal() as db:
        qc_id = db.get(MaterialInspection, issue["id"]).inspection_team_id
    assert target.json()["href"] == (
        f"/team-workspaces/{qc_id}?tab=quality-feedback&issue={issue['id']}"
    )
    assert client.get(f"/api/quality-feedback/{issue['id']}", headers=headers).status_code == 200
