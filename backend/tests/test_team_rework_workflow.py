"""QC submissions remain available through engineering and business workspaces."""

from uuid import uuid4

from app.database import SessionLocal
from app.models import MaterialStockBalance, ProcessRoute, Team
from sqlalchemy import select
from test_engineered_rework import approved_quality_issue, save_plan
from test_engineering_team import author
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
    context = client.get(base(warehouse, True) + f"/stock/{lot['id']}/quantity-adjustments").json()
    issue_id, _ = approved_quality_issue(client, warehouse, lot, context)
    body = dict(
        inspection_id=issue_id,
        repair_team_id=warehouse["other"]["id"],
        source_transfer_id=lot["id"],
        rework_of_id=result.json()["id"],
        expected_revision=context["revision"],
        quantity=2,
        weight=20,
        reason="厚度偏大，需精磨",
        idempotency_key=uuid4().hex,
    )
    return lot, body, engineering_id, engineering_headers


def test_qc_problem_and_published_rework_remain_visible_without_messages(client, warehouse):
    lot, body, engineering_id, engineering_headers = prepare(client, warehouse)
    headers = warehouse["rework_qc_headers"]
    with SessionLocal() as db:
        team_id = db.scalar(select(Team.id).where(Team.code == "FACTORY-QC"))
    before = client.get(base(warehouse, True) + "/overview").json()["totals"]
    result = client.post("/api/process-routes/rework-requests", json=body, headers=headers)
    assert result.status_code == 201, result.text
    route = result.json()
    assert route["rework_request"]["requesting_team_id"] == team_id
    assert route["rework_request"]["requesting_team_name"] == "检验"
    assert route["rework_request"]["inspection_id"] == body["inspection_id"]
    assert route["state"] == "published"
    retry = client.post("/api/process-routes/rework-requests", json=body, headers=headers)
    assert retry.status_code == 201 and retry.json()["id"] == route["id"]
    drafts = client.get(
        "/api/process-routes",
        headers=engineering_headers,
        params={"kind": "rework", "state": "draft"},
    ).json()
    assert drafts["pending_rework_count"] == 0
    assert drafts["items"] == []
    with SessionLocal() as db:
        assert db.get(ProcessRoute, route["id"]).state == "published"
        assert db.get(MaterialStockBalance, lot["id"]).on_hand_quantity == 8
    saved = save_plan(client, warehouse, route)
    ready = client.get(f"/api/process-routes/{saved['id']}", headers=headers)
    assert ready.status_code == 200
    assert ready.json()["state"] == "published"
    assert client.get(base(warehouse, True) + "/overview").json()["totals"] == before


def test_direct_request_cannot_mutate_foreign_stock_and_failure_sends_no_message(client, warehouse):
    lot, body, engineering_id, _ = prepare(client, warehouse)
    before = client.get(base(warehouse, True) + "/overview").json()["totals"]
    for headers in (warehouse["headers"], warehouse["other_headers"]):
        result = client.post("/api/process-routes/rework-requests", json=body, headers=headers)
        assert result.status_code == 403, result.text
    for suffix in ("", f"?lot_id={lot['id']}"):
        assert (
            client.get(
                "/api/process-routes/rework-sources" + suffix, headers=warehouse["headers"]
            ).status_code
            == 403
        )
    stale = client.post(
        "/api/process-routes/rework-requests",
        json={**body, "expected_revision": body["expected_revision"] + 1},
        headers=warehouse["rework_qc_headers"],
    )
    assert stale.status_code == 409
    assert (
        client.get("/api/process-routes", params={"kind": "rework", "state": "draft"}).json()[
            "total"
        ]
        == 0
    )
    assert client.get(base(warehouse, True) + "/overview").json()["totals"] == before


def test_team_rework_list_opens_the_current_engineered_revision(client, warehouse):
    _, body, engineering_id, _ = prepare(client, warehouse)
    headers = warehouse["other_headers"]
    result = client.post(
        "/api/process-routes/rework-requests", json=body, headers=warehouse["rework_qc_headers"]
    )
    assert result.status_code == 201
    saved = save_plan(client, warehouse, result.json())
    assert (
        client.post(
            f"/api/process-routes/{saved['id']}/revise", headers=author(client)[0]
        ).status_code
        == 403
    )
    latest = saved
    rows = client.get("/api/process-routes", params={"kind": "rework"}, headers=headers).json()
    assert [row["id"] for row in rows["items"]] == [latest["id"]]
    opened = client.get(f"/api/process-routes/{latest['id']}", headers=headers)
    assert opened.status_code == 200, opened.text
    assert opened.json()["id"] == latest["id"]
    assert opened.json()["steps"][0]["instructions"] == body["reason"]
    assert opened.json()["rework_request"]["requesting_team_name"] == "检验"
