"""Legacy published rows remain visible but cannot bypass required route files."""

from types import SimpleNamespace

import pytest
from app.database import SessionLocal
from app.models import ProcessRoute, ProcessRouteDrawing, ProductionScheduleTask
from app.process_routes import validate_schedule
from fastapi import HTTPException
from route_document_helpers import add_documents
from sqlalchemy import delete, func, select
from test_dispatch_planning import dispatcher as dispatcher  # noqa: F401
from test_dispatch_planning import submit
from test_process_routes import published
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

URL = "/api/process-routes"


@pytest.mark.parametrize("missing", ["word", "drawing", "both", "empty_drawing"])
def test_incomplete_published_route_is_readable_but_not_selectable_or_executable(
    client, warehouse, dispatcher, missing
):
    route = published(client, warehouse)
    route_id = route["id"]
    with SessionLocal.begin() as db:
        if missing in ("word", "both"):
            db.get(ProcessRoute, route_id).source_file = b""
        if missing in ("drawing", "both"):
            db.execute(delete(ProcessRouteDrawing).where(ProcessRouteDrawing.route_id == route_id))
        if missing == "empty_drawing":
            drawing = db.scalar(
                select(ProcessRouteDrawing).where(ProcessRouteDrawing.route_id == route_id)
            )
            drawing.content = b""
    expected = (["工艺原件"] if missing in ("word", "both") else []) + (
        ["图纸"] if missing != "word" else []
    )
    detail = client.get(f"{URL}/{route_id}")
    assert detail.status_code == 200
    assert detail.json()["state"] == "published"
    assert detail.json()["missing_documents"] == expected
    listing = client.get(URL).json()
    assert listing["total"] == 1
    assert listing["items"][0]["missing_documents"] == expected
    options = client.get(
        "/api/production-schedules/route-options", params={"serial_no": "WAREHOUSE-001"}
    )
    assert options.status_code == 200 and options.json() == []
    for path, method, kwargs in (
        (URL + "/resolve", "get", {"params": {"serial_no": "WAREHOUSE-001"}}),
        (f"{URL}/{route_id}/publish", "post", {"json": {"version": route["version"]}}),
    ):
        response = getattr(client, method)(path, **kwargs)
        assert response.status_code == 422, response.text
        assert response.json()["detail"] == "缺少：" + "、".join(expected)
    person = client.post("/api/production-schedules/business-people", json={"name": "业务甲"})
    response = submit(
        client,
        dict(
            serial_no="WAREHOUSE-001",
            route_id=route_id,
            route_version=route["version"],
            final_due_at="2026-12-30T16:00:00+08:00",
            business_person_ids=[person.json()["id"]],
            idempotency_key="missing-files",
        ),
        dispatcher,
    )
    assert response.status_code == 409, response.text
    with SessionLocal() as db:
        with pytest.raises(HTTPException) as error:
            validate_schedule(
                db,
                SimpleNamespace(
                    process_route_id=route_id, process_step_index=0, serial_no="WAREHOUSE-001"
                ),
            )
        assert error.value.status_code == 422
        assert db.scalar(select(func.count()).select_from(ProductionScheduleTask)) == 0
        assert db.get(ProcessRoute, route_id).state == "published"


def test_restored_documents_clear_the_warning_without_replacing_the_route(client, warehouse):
    route = published(client, warehouse)
    with SessionLocal.begin() as db:
        db.get(ProcessRoute, route["id"]).source_file = b""
        db.execute(delete(ProcessRouteDrawing).where(ProcessRouteDrawing.route_id == route["id"]))
    assert client.get(f"{URL}/{route['id']}").json()["missing_documents"]
    add_documents(route["id"])
    detail = client.get(f"{URL}/{route['id']}").json()
    assert detail["missing_documents"] == []
    assert detail["id"] == route["id"] and detail["version"] == route["version"]
    assert detail["steps"] == route["steps"]
    options = client.get(
        "/api/production-schedules/route-options", params={"serial_no": "WAREHOUSE-001"}
    ).json()
    assert [item["id"] for item in options] == [route["id"]]
    resolved = client.get(URL + "/resolve", params={"serial_no": "WAREHOUSE-001"})
    assert resolved.status_code == 200 and resolved.json()["missing_documents"] == []
