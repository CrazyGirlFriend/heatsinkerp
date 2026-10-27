"""Team submissions and engineering replies are durable, scoped and stock-neutral."""

from uuid import uuid4

from app.database import SessionLocal
from app.models import MaterialStockBalance, ProcessRoute, ReworkNotice, Team
from sqlalchemy import select
from test_engineered_rework import save_plan
from test_material_transfers import _leader
from test_processing_daily import setup_lot, work
from test_warehouse_classification import base
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401


def prepare(client, warehouse):
    lot, employee = setup_lot(client, warehouse)
    result = work(client, warehouse, lot, employee)
    assert result.status_code == 201, result.text
    lot = result.json()["outputs"][0]
    with SessionLocal.begin() as db:
        team = Team(code="FACTORY-PROCESS", name="工艺", kind="engineering", active=True)
        db.add(team)
        db.flush()
        engineering_id = team.id
    _, engineering_headers = _leader(client, "process-notice-leader", engineering_id)
    context = client.get(
        f"/api/process-routes/rework-sources?lot_id={lot['id']}", headers=warehouse["other_headers"]
    ).json()
    body = dict(
        source_transfer_id=lot["id"],
        rework_of_id=result.json()["id"],
        expected_revision=context["revision"],
        quantity=2,
        weight=20,
        reason="厚度偏大，需精磨",
        idempotency_key=uuid4().hex,
    )
    return lot, body, engineering_id, engineering_headers


def test_team_problem_notifies_engineering_then_authoring_notifies_submitter(client, warehouse):
    lot, body, engineering_id, engineering_headers = prepare(client, warehouse)
    headers = warehouse["other_headers"]
    team_id = warehouse["other"]["id"]
    before = client.get(base(warehouse, True) + "/overview").json()["totals"]
    result = client.post("/api/process-routes/rework-requests", json=body, headers=headers)
    assert result.status_code == 201, result.text
    route = result.json()
    assert route["rework_request"]["requesting_team_id"] == team_id
    assert route["rework_request"]["requesting_team_name"] == warehouse["other"]["name"]
    assert route["rework_request"]["inspection_id"] is None
    assert route["state"] == "draft"
    retry = client.post("/api/process-routes/rework-requests", json=body, headers=headers)
    assert retry.status_code == 201 and retry.json()["id"] == route["id"]
    path = f"/api/rework-notices?team_id={engineering_id}"
    inbox = client.get(path, headers=engineering_headers).json()
    assert inbox["unread"] == inbox["total"] == 1
    notice = inbox["items"][0]
    assert notice["kind"] == "requested" and notice["problem"] == body["reason"]
    assert notice["submitting_team"] == warehouse["other"]["name"]
    assert (
        client.get(f"/api/rework-notices/{notice['id']}/route", headers=headers).status_code == 403
    )
    assert client.get(path, headers=headers).status_code == 403
    assert (
        client.post(f"/api/rework-notices/{notice['id']}/read", headers=headers).status_code == 403
    )
    for _ in range(2):
        assert (
            client.post(
                f"/api/rework-notices/{notice['id']}/read", headers=engineering_headers
            ).status_code
            == 200
        )
    assert client.get(path, headers=engineering_headers).json()["unread"] == 0
    with SessionLocal() as db:
        assert db.get(ProcessRoute, route["id"]).state == "draft"
        assert db.get(MaterialStockBalance, lot["id"]).on_hand_quantity == 8
    saved = save_plan(client, warehouse, route)
    # Publishing/retrying does not send duplicate messages or physically transfer anything.
    repeat = client.post(
        f"/api/process-routes/{saved['id']}/publish", json={"version": saved["version"]}
    )
    assert repeat.status_code == 200, repeat.text
    team_inbox = client.get(f"/api/rework-notices?team_id={team_id}", headers=headers).json()
    assert team_inbox["unread"] == team_inbox["total"] == 1
    assert team_inbox["items"][0]["kind"] == "ready"
    assert client.get(base(warehouse, True) + "/overview").json()["totals"] == before
    with SessionLocal() as db:
        assert len(list(db.scalars(select(ReworkNotice)))) == 2


def test_direct_request_cannot_mutate_foreign_stock_and_failure_sends_no_message(client, warehouse):
    lot, body, engineering_id, _ = prepare(client, warehouse)
    before = client.get(base(warehouse, True) + "/overview").json()["totals"]
    for headers in (warehouse["headers"], client.headers):
        result = client.post("/api/process-routes/rework-requests", json=body, headers=headers)
        assert result.status_code == 403, result.text
    picker = client.get("/api/process-routes/rework-sources", headers=warehouse["headers"]).json()
    assert all(row["id"] != lot["id"] for row in picker["items"])
    assert (
        client.get(
            f"/api/process-routes/rework-sources?lot_id={lot['id']}", headers=warehouse["headers"]
        ).status_code
        == 409
    )
    stale = client.post(
        "/api/process-routes/rework-requests",
        json={**body, "expected_revision": body["expected_revision"] + 1},
        headers=warehouse["other_headers"],
    )
    assert stale.status_code == 409
    assert client.get(f"/api/rework-notices?team_id={engineering_id}").json()["total"] == 0
    assert client.get(base(warehouse, True) + "/overview").json()["totals"] == before


def test_existing_message_opens_the_current_engineered_revision(client, warehouse):
    _, body, engineering_id, _ = prepare(client, warehouse)
    headers = warehouse["other_headers"]
    result = client.post("/api/process-routes/rework-requests", json=body, headers=headers)
    assert result.status_code == 201
    saved = save_plan(client, warehouse, result.json())
    messages = client.get(
        f"/api/rework-notices?team_id={warehouse['other']['id']}", headers=headers
    ).json()
    notice_id = messages["items"][0]["id"]
    revision = client.post(f"/api/process-routes/{saved['id']}/revise").json()
    latest = save_plan(client, warehouse, revision, instructions="最新修订的要求")
    opened = client.get(f"/api/rework-notices/{notice_id}/route", headers=headers)
    assert opened.status_code == 200, opened.text
    assert opened.json()["id"] == latest["id"]
    assert opened.json()["steps"][0]["instructions"] == "最新修订的要求"
    assert opened.json()["rework_request"]["requesting_team_id"] == warehouse["other"]["id"]
