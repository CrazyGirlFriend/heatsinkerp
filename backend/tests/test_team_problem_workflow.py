"""One team report remains linked through quality, engineering and physical rework."""

import json
from uuid import uuid4

import pytest
from app.database import SessionLocal
from app.models import MaterialStockBalance, ProcessRoute, ProcessRouteDrawing, Team
from test_processing_daily import work
from test_team_rework_workflow import prepare
from test_warehouse_classification import base
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

URL = "/api/process-routes"
QUALITY = "/api/quality-feedback"
pytestmark = pytest.mark.usefixtures("legacy_stock")


def request(client, setup):
    lot, body, engineering_id, headers = prepare(client, setup)
    body.pop("inspection_id")
    body.pop("repair_team_id")
    with SessionLocal.begin() as db:
        team = db.get(Team, setup["other"]["id"])
        team.code, team.name = "FACTORY-ROLL", "轧制"
    result = client.post(URL + "/rework-requests", json=body, headers=setup["other_headers"])
    assert result.status_code == 201, result.text
    retry = client.post(URL + "/rework-requests", json=body, headers=setup["other_headers"])
    assert retry.json()["id"] == result.json()["id"]
    return lot, result.json(), engineering_id, headers


def publish(client, setup, route, engineering_id, headers):
    path = QUALITY + f"/team-problems/{route['id']}/assign"
    team = {"repair_team_id": setup["other"]["id"]}
    assert client.post(path, params=team, headers=headers).status_code == 403
    assigned = client.post(path, params=team, headers=setup["rework_qc_headers"])
    assert assigned.status_code == 200, assigned.text
    return client.get(URL + f"/{route['id']}").json()


def test_rolling_report_is_visible_to_quality_and_engineering_then_selectable_for_rework(
    client, warehouse
):
    lot, route, engineering_id, engineering_headers = request(client, warehouse)
    team_headers = warehouse["other_headers"]
    route_id = route["id"]
    detail_url = QUALITY + f"/team-problems/{route_id}"
    for headers in (
        client.headers,
        team_headers,
        warehouse["rework_qc_headers"],
        engineering_headers,
    ):
        response = client.get(QUALITY, headers=headers, params={"kind": "team_report"})
        assert response.status_code == 200, response.text
        assert response.json()["total"] == 1
        row = response.json()["items"][0]
        assert (row["id"], row["route_state"], row["feedback_status"]) == (
            route_id,
            "draft",
            "pending",
        )
        assert row["team_name"] == "轧制" and row["notes"] == route["rework_request"]["reason"]
        assert row["failed_quantity"] == 2
        assert client.get(detail_url, headers=headers).json()["id"] == route_id
    # An unrelated team cannot learn about another team's report or engineering draft.
    assert (
        client.get(QUALITY, headers=warehouse["headers"], params={"kind": "team_report"}).json()[
            "total"
        ]
        == 0
    )
    assert client.get(detail_url, headers=warehouse["headers"]).status_code == 404
    drafts = client.get(
        URL, headers=engineering_headers, params={"kind": "rework", "state": "draft"}
    ).json()
    assert drafts["items"][0]["id"] == route_id
    drafts = client.get(
        "/api/process-routes",
        headers=engineering_headers,
        params={"kind": "rework", "state": "draft"},
    ).json()
    assert drafts["pending_rework_count"] == 1
    assert drafts["items"][0]["id"] == route["id"]

    source_id = route["rework_request"]["source_transfer_id"]
    context_path = base(warehouse, True) + f"/stock/{source_id}/quantity-adjustments"
    assert client.get(context_path, headers=team_headers).json()["rework_route_ready"] is False
    publish(client, warehouse, route, engineering_id, engineering_headers)
    detail = client.get(detail_url, headers=team_headers).json()
    assert detail["route_state"] == "published"
    assert detail["feedback_status"] == "processing"
    assert detail["rework_progress"]["state"] == "processing"
    context = client.get(context_path, headers=team_headers).json()
    assert context["rework_route_ready"] is True
    assert context["process_route"]["id"] == route_id
    assert context["process_route"]["instructions"] == route["rework_request"]["reason"]
    sources = client.get(base(warehouse, True) + "/processing-stock", headers=team_headers)
    assert sources.status_code == 200, sources.text
    source = next(r for r in sources.json()["items"] if r["transfer"]["id"] == source_id)
    assert source["transfer"]["rework_route_ready"] is True
    employee = client.get(base(warehouse, True) + "/employees").json()[0]
    completed = work(
        client,
        warehouse,
        {"id": source_id},
        employee,
        work_kind="rework",
        rework_of_id=route["rework_request"]["rework_of_id"],
        quantity=2,
        input_quantity=2,
        completed_quantity=2,
        completed_weight=20,
        outputs=[
            dict(
                role="produced",
                material_type="semi_finished",
                quantity=2,
                weight=20,
                transfer_specification="20 × 10 × 2.5 mm",
            )
        ],
        idempotency_key=uuid4().hex,
    )
    assert completed.status_code == 201, completed.text
    assert completed.json()["process_route_id"] == route_id
    assert completed.json()["process_step_instructions"] == route["rework_request"]["reason"]
    progress = client.get(detail_url, headers=team_headers).json()["rework_progress"]
    assert progress["completed_quantity"] == 2 and progress["state"] == "awaiting_inspection"
    with SessionLocal() as db:
        assert db.get(MaterialStockBalance, lot["id"]).on_hand_quantity == 8


def test_mixed_quality_list_filters_and_pages_before_hydration(client, warehouse):
    _, route, _, _ = request(client, warehouse)
    rows = client.get(QUALITY, params={"page_size": 1}).json()
    assert rows["total"] == 2 and rows["pending_count"] == 2
    assert rows["items"][0]["kind"] == "team_report"
    second = client.get(QUALITY, params={"page_size": 1, "page": 2}).json()
    assert second["items"][0]["kind"] != "team_report"
    filters = {"filters": [{"field": "kind", "kind": "select", "value": "team_report"}]}
    filtered = client.get(QUALITY, params={"table_query": json.dumps(filters)}).json()
    assert filtered["total"] == 1 and filtered["items"][0]["id"] == route["id"]
    assert (
        client.get(QUALITY, params={"kind": "team_report", "status": "processing"}).json()["total"]
        == 0
    )
    assert (
        client.get(QUALITY, params={"query": "厚度偏大"}).json()["items"][0]["kind"]
        == "team_report"
    )
    filters = {"filters": [{"field": "route_state", "kind": "select", "value": "draft"}]}
    filtered = client.get(QUALITY, params={"table_query": json.dumps(filters)}).json()
    assert filtered["total"] == 1 and filtered["items"][0]["id"] == route["id"]


def test_reporting_team_sees_its_pending_rework_without_access_to_unpublished_instructions(
    client, warehouse
):
    _, route, engineering_id, engineering_headers = request(client, warehouse)
    route_id = route["id"]
    team_headers = warehouse["other_headers"]
    params = {"kind": "rework", "rework_scope": "open", "state": "draft"}
    for headers in (team_headers, engineering_headers, client.headers):
        response = client.get(URL, headers=headers, params=params)
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["total"] == result["pending_rework_count"] == 1
        assert result["items"][0]["id"] == route_id
        assert result["items"][0]["state"] == "draft"
        assert result["items"][0]["rework_progress"]["state"] == "awaiting_route"
    for headers in (warehouse["headers"], warehouse["rework_qc_headers"]):
        result = client.get(URL, headers=headers, params=params).json()
        assert result["total"] == result["pending_rework_count"] == 0

    # Saving a partial draft must not expose unapproved operations or attachments.
    with SessionLocal.begin() as db:
        db.get(ProcessRoute, route_id).steps = [
            {"sequence_no": 1, "name": "尚未审核的工序", "team_id": warehouse["other"]["id"]}
        ]
        drawing = ProcessRouteDrawing(
            route_id=route_id,
            filename="未发布图纸.pdf",
            sha256="1" * 64,
            size_bytes=1,
            content=b"x",
        )
        db.add(drawing)
        db.flush()
        drawing_id = drawing.id
    result = client.get(URL, headers=team_headers, params=params).json()["items"][0]
    assert result["step_summary"] == result["drawings"] == []
    assert result["rework_request"]["execution_team_names"] == []
    assert result["rework_request"]["reason"] == route["rework_request"]["reason"]
    for suffix in ("", "/source", f"/drawings/{drawing_id}"):
        assert client.get(f"{URL}/{route_id}{suffix}", headers=team_headers).status_code == 403
    for method, suffix, body in (
        ("PUT", "", {key: route[key] for key in ("title", "serial_nos", "steps", "version")}),
        ("POST", "/publish", {"version": route["version"]}),
        ("POST", "/revise", {}),
    ):
        assert (
            client.request(
                method, f"{URL}/{route_id}{suffix}", headers=team_headers, json=body
            ).status_code
            == 403
        )
    problem = client.get(QUALITY + f"/team-problems/{route_id}", headers=team_headers)
    assert problem.status_code == 200
    assert problem.json()["route_state"] == "draft"

    publish(client, warehouse, route, engineering_id, engineering_headers)
    result = client.get(URL, headers=team_headers, params={"kind": "rework"}).json()
    assert result["total"] == 1 and result["pending_rework_count"] == 0
    assert result["items"][0]["state"] == "published"
    assert client.get(f"{URL}/{route_id}", headers=team_headers).status_code == 200


def test_quality_shows_one_report_with_the_latest_published_rework_revision(client, warehouse):
    _, route, engineering_id, headers = request(client, warehouse)
    published = publish(client, warehouse, route, engineering_id, headers)
    response = client.post(URL + f"/{route['id']}/revise", headers=headers)
    assert response.status_code == 403, response.text
    rows = client.get(QUALITY, params={"kind": "team_report", "status": "processing"}).json()
    assert rows["total"] == 1 and rows["items"][0]["id"] == published["id"]
    assert rows["items"][0]["rework_round"] == 1
