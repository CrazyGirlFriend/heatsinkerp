"""The workbench shows route summaries and an unfiltered, permission-scoped backlog."""

from app.database import SessionLocal
from app.models import ProcessRoute, ProcessRouteArchive, ProcessRouteDrawing
from test_engineering_team import engineering as engineering  # noqa: F401
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

URL = "/api/process-routes"


def route(db, serial, *, kind="normal", state="published", parent_id=None):
    row = ProcessRoute(
        title=serial,
        serial_nos=[serial],
        route_kind=kind,
        state=state,
        parent_id=parent_id,
        filename="工艺.docx",
        source_sha256="word",
        source_file=b"original-word",
        source_data={"tables": [], "issues": []},
        steps=[],
        created_by="admin",
    )
    db.add(row)
    db.flush()
    return row


def test_list_uses_confirmed_material_and_retains_every_operation_without_full_documents(client):
    with SessionLocal.begin() as db:
        row = route(db, "SUMMARY-001")
        row.source_data = {
            "word_fields": {"material_name": {"value": "Mo70Cu30"}},
            "receipt_fields": {"material_name": {"value": "Mo80Cu20"}},
            "tables": [["do-not-send-original"]],
        }
        row.steps = [
            {"sequence_no": i, "name": name, "instructions": "do-not-send-instructions"}
            for i, name in enumerate(["库房", "退火", "研磨", "退火"])
        ]
        db.add(
            ProcessRouteDrawing(
                route_id=row.id,
                filename="图纸.pdf",
                content=b"do-not-send-pdf",
                sha256="pdf",
                size_bytes=15,
            )
        )
        row_id = row.id
    response = client.get(URL)
    assert response.status_code == 200, response.text
    item = response.json()["items"][0]
    assert item["id"] == row_id
    assert item["material_name"] == "Mo80Cu20"
    assert item["step_summary"] == [
        {"sequence_no": i, "name": name, "team_id": None}
        for i, name in enumerate(["库房", "退火", "研磨", "退火"])
    ]
    assert item["drawings"][0]["filename"] == "图纸.pdf"
    assert item["drawings"][0]["size_bytes"] == 15
    assert "steps" not in item and "source_data" not in item
    assert "do-not-send" not in response.text and "original-word" not in response.text


def test_list_without_optional_summary_data_keeps_empty_values(client):
    with SessionLocal.begin() as db:
        route(db, "EMPTY-001")
    item = client.get(URL).json()["items"][0]
    assert item["material_name"] == ""
    assert item["step_summary"] == []
    assert item["drawings"] == []


def test_pending_count_ignores_list_search_page_and_kind_but_excludes_archived_revisions(client):
    with SessionLocal.begin() as db:
        original = route(db, "NORMAL-001")
        route(db, "NORMAL-DRAFT", state="draft")
        first = route(db, "REWORK-1", kind="rework", state="draft")
        route(db, "REWORK-2", kind="rework", state="draft")
        route(db, "REWORK-DONE", kind="rework")
        archived = route(db, "REWORK-ARCHIVED", kind="rework", state="draft")
        db.add(ProcessRouteArchive(route_id=archived.id, current_route_id=first.id))
        route(db, "REVISION-DRAFT", kind="rework", state="draft", parent_id=original.id)
        first_id = first.id
    for params in ({}, {"query": "NORMAL-001"}, {"query": "NO-MATCH", "page": 2}):
        response = client.get(URL, params=params)
        assert response.status_code == 200, response.text
        assert response.json()["pending_rework_count"] == 2
    with SessionLocal.begin() as db:
        db.get(ProcessRoute, first_id).state = "published"
    assert client.get(URL).json()["pending_rework_count"] == 1


def test_only_administrators_and_engineering_can_see_the_pending_count(
    client, warehouse, engineering
):
    with SessionLocal.begin() as db:
        route(db, "REWORK-PRIVATE", kind="rework", state="draft")
    assert client.get(URL).json()["pending_rework_count"] == 1
    assert client.get(URL, headers=engineering["headers"]).json()["pending_rework_count"] == 1
    response = client.get(URL, headers=warehouse["headers"])
    assert response.status_code == 200, response.text
    assert response.json()["pending_rework_count"] == 0
