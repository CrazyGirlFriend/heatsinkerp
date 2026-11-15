"""Administrators can inspect engineering but cannot author or replace its content."""

import pytest
from app.database import SessionLocal
from app.models import ProcessRoute, ProcessRouteDrawing
from route_document_helpers import add_documents
from sqlalchemy import func, select
from test_engineering_team import engineering as engineering  # noqa: F401
from test_process_route_creation import create_with_documents, manual
from test_process_route_intake import route_payload
from test_processing_daily import setup_lot, work
from test_warehouse_classification import base
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

URL = "/api/process-routes"


@pytest.mark.parametrize("kind", ["normal", "rework"])
@pytest.mark.usefixtures("legacy_stock")
def test_admin_can_read_but_cannot_change_routes_or_attachments(client, warehouse, kind):
    if kind == "normal":
        payload = route_payload(client, warehouse)
    else:
        lot, worker = setup_lot(client, warehouse)
        processed = work(client, warehouse, lot, worker)
        assert processed.status_code == 201, processed.text
        output = processed.json()["outputs"][0]
        context = client.get(
            base(warehouse, True) + f"/stock/{output['id']}/quantity-adjustments"
        ).json()
        requested = client.post(
            URL + "/rework-requests",
            headers=warehouse["other_headers"],
            json={
                "source_transfer_id": output["id"],
                "rework_of_id": processed.json()["id"],
                "expected_revision": context["revision"],
                "quantity": context["quantity"],
                "weight": context["weight"],
                "reason": "尺寸偏差，重新加工",
                "idempotency_key": "permission-rework",
            },
        )
        assert requested.status_code == 201, requested.text
        payload = {
            key: requested.json()[key]
            for key in ("id", "version", "title", "serial_nos", "steps", "review_note")
        }
    route_id = payload["id"]
    add_documents(route_id)
    detail = client.get(f"{URL}/{route_id}")
    assert detail.status_code == 200, detail.text
    original = detail.json()
    drawing_id = original["drawings"][0]["id"]
    files = {}
    for path in ("source", "order", f"drawings/{drawing_id}"):
        response = client.get(f"{URL}/{route_id}/{path}")
        assert response.status_code == 200, response.text
        files[path] = response.content

    write = {key: value for key, value in payload.items() if key != "id"}
    mutations = [
        ("PUT", f"/{route_id}", {"json": {**write, "title": "未授权修改"}}),
        ("POST", f"/{route_id}/publish", {"json": {"version": original["version"]}}),
        ("POST", f"/{route_id}/revise", {}),
        (
            "DELETE",
            f"/{route_id}/drawings/{drawing_id}",
            {"params": {"version": original["version"]}},
        ),
    ]
    for path, filename in (
        ("source", "工艺.docx"),
        ("order", "订单.xlsx"),
        ("drawings", "图纸.pdf"),
    ):
        mutations.append(
            (
                "POST",
                f"/{route_id}/{path}",
                {
                    "data": {"version": original["version"]},
                    "files": {"file": (filename, b"unauthorized replacement")},
                },
            )
        )
    for method, path, options in mutations:
        response = client.request(method, URL + path, **options)
        assert response.status_code == 403, (method, path, response.text)
        assert response.json()["detail"] == "仅工艺班组可以维护工艺"

    assert client.get(f"{URL}/{route_id}").json() == original
    for path, content in files.items():
        assert client.get(f"{URL}/{route_id}/{path}").content == content
    with SessionLocal() as db:
        assert db.scalar(select(func.count(ProcessRoute.id))) == 1
        assert db.scalar(select(func.count(ProcessRouteDrawing.id))) == 1


def test_admin_cannot_create_import_or_parse_engineering(client, warehouse):
    payload = route_payload(client, warehouse)
    write = {key: value for key, value in payload.items() if key != "id"}
    created = create_with_documents(client, write)
    assert created.status_code == 403, created.text
    for path in ("import", "parse", "parse-order", "drawing-preview"):
        response = client.post(URL + "/" + path, files={"file": ("工艺.docx", b"original")})
        assert response.status_code == 403, (path, response.text)
    with SessionLocal() as db:
        assert db.scalar(select(func.count(ProcessRoute.id))) == 1


def test_admin_cannot_revise_or_republish_published_engineering(client, warehouse, engineering):
    route = manual(client, warehouse, engineering)
    published = client.post(
        f"{URL}/{route['id']}/publish",
        headers=engineering["headers"],
        json={"version": route["version"], "confirmed_imports": True},
    )
    assert published.status_code == 200, published.text
    original = published.json()
    for path in ("revise", "publish"):
        denied = client.post(f"{URL}/{route['id']}/{path}", json={"version": original["version"]})
        assert denied.status_code == 403, denied.text
    assert client.get(f"{URL}/{route['id']}").json() == original
