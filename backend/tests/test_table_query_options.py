"""Excel-style filters operate on the authorized complete result before paging."""

import json
from datetime import datetime

import pytest
from app.database import SessionLocal
from app.models import MaterialTransfer
from test_material_transfers import _team


@pytest.fixture()
def rows(client):
    team = _team(client, "OPTIONS", "筛选班组")
    other = _team(client, "OPTIONS-OTHER", "另一个班组")
    with SessionLocal.begin() as db:
        for index, name in enumerate([None, "", "铜,钼", "铜%_料", "铜板", "钢板", "铜,钼"]):
            db.add(
                MaterialTransfer(
                    batch_no=f"FILTER-{index}",
                    serial_no=f"ORDER-{index}",
                    material_name=name,
                    quantity=index,
                    weight=max(1, index),
                    status="received",
                    material_type="semi_finished",
                    source_team_id=other["id"],
                    source_team_code=other["code"],
                    source_team_name=other["name"],
                    next_team_id=team["id"],
                    next_team_code=team["code"],
                    next_team_name=team["name"],
                    stock_tracked=True,
                    received_at=datetime(2026, 11, 15, 16),
                    created_at=datetime(2026, 11, 15, 15 if index == 0 else 16),
                    created_by="测试",
                )
            )
        db.add(
            MaterialTransfer(
                batch_no="OTHER",
                entry_kind="opening_stock",
                serial_no="OUTSIDE",
                material_name="范围外",
                quantity=1,
                weight=1,
                status="received",
                stock_tracked=True,
                next_team_id=other["id"],
                next_team_code=other["code"],
                next_team_name=other["name"],
                created_by="测试",
            )
        )
    return team


def query(client, team, filters=None, options=None, **params):
    response = client.get(
        "/api/material-transfers",
        params={
            "next_team_id": team["id"],
            "page_size": 1,
            "table_query": json.dumps(
                {"filters": filters or [], **({"options": options} if options else {})}
            ),
            **params,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_options_use_complete_scoped_result_and_other_filters_but_not_own_column(client, rows):
    filters = [
        {"field": "material_name", "operator": "eq", "value": "铜板"},
        {"field": "quantity", "kind": "number", "operator": "gte", "value": "2"},
    ]
    first = query(client, rows, filters, {"field": "material_name", "limit": 2})
    second = query(
        client,
        rows,
        filters,
        {"field": "material_name", "limit": 2, "offset": first["next_offset"]},
    )
    assert first["has_more"] is True and second["has_more"] is False
    assert set(first["values"] + second["values"]) == {"铜,钼", "铜%_料", "铜板", "钢板"}
    assert query(client, rows, options={"field": "material_name", "search": "%_"})["values"] == [
        "铜%_料"
    ]
    assert query(client, rows, options={"field": "material_name"})["values"].count(None) == 1
    # Opening an option list must not leak its temporary scope into the next list request.
    assert query(client, rows, filters)["total"] == 1
    assert query(client, rows)["total"] == 7


@pytest.mark.parametrize(
    "condition,expected",
    [
        ({"operator": "in", "values": ["铜,钼"]}, 2),
        ({"operator": "in", "values": [None, "铜板"]}, 3),
        ({"operator": "in", "values": []}, 0),
        ({"operator": "not_in", "values": ["铜,钼"]}, 5),
        ({"operator": "blank"}, 2),
        ({"operator": "not_blank"}, 5),
        ({"operator": "contains", "value": "%_"}, 1),
        ({"operator": "not_contains", "value": "铜"}, 1),
        ({"operator": "starts_with", "value": "铜"}, 4),
        ({"operator": "ends_with", "value": "板"}, 2),
        ({"operator": "eq", "value": "铜板"}, 1),
        ({"operator": "ne", "value": "铜板"}, 4),
    ],
)
def test_text_selection_and_blank_conditions(client, rows, condition, expected):
    assert query(client, rows, [{"field": "material_name", **condition}])["total"] == expected


def test_numbers_dates_and_factory_local_calendar(client, rows):
    assert (
        query(
            client, rows, [{"field": "quantity", "kind": "number", "operator": "eq", "value": "0"}]
        )["total"]
        == 1
    )
    assert (
        query(
            client, rows, [{"field": "quantity", "kind": "number", "operator": "gt", "value": "4"}]
        )["total"]
        == 2
    )
    day = {"field": "created_at", "kind": "date", "operator": "eq", "value": "2026-11-16"}
    assert query(client, rows, [day])["total"] == 6
    assert query(client, rows, [{**day, "operator": "lt"}])["total"] == 1
    assert (
        query(client, rows, [{**day, "operator": "in", "value": "", "values": ["2026-11-16"]}])[
            "total"
        ]
        == 6
    )
    assert query(client, rows, options={"field": "created_at", "kind": "date"})["values"] == [
        "2026-11-15",
        "2026-11-16",
    ]
    for search in ["2026", "2026-11", "2026-11-16"]:
        values = query(
            client, rows, options={"field": "created_at", "kind": "date", "search": search}
        )["values"]
        assert "2026-11-16" in values
    assert query(
        client, rows, options={"field": "created_at", "kind": "date", "search": "2026-11-16"}
    )["values"] == ["2026-11-16"]


def test_invalid_fields_and_unauthorized_requests_are_rejected(client, rows):
    for payload in [
        {"options": {"field": "password"}},
        {"filters": [{"field": "quantity", "kind": "number", "operator": "gt", "value": "NaN"}]},
        {
            "filters": [
                {"field": "created_at", "kind": "date", "operator": "eq", "value": "2026-99-01"}
            ]
        },
    ]:
        assert (
            client.get(
                "/api/material-transfers", params={"table_query": json.dumps(payload)}
            ).status_code
            == 422
        )
    client.headers.pop("Authorization")
    assert (
        client.get(
            "/api/material-transfers",
            params={"table_query": json.dumps({"options": {"field": "material_name"}})},
        ).status_code
        == 401
    )


def test_options_available_in_shared_list_adapters(client):
    team = _team(client, "FACTORY-ROLL", "轧制")
    warehouse = client.post(
        "/api/teams", json={"code": "FACTORY-WAREHOUSE", "name": "库房", "kind": "warehouse"}
    ).json()
    prefix = f"/api/team-materials/{team['id']}"
    endpoints = [
        ("/api/production-schedules/business-people", "name", {}),
        ("/api/production-schedules/tasks", "locked", {}),
        ("/api/production-schedules", "handover_status", {}),
        ("/api/process-routes", "serial_nos", {}),
        ("/api/quality-feedback", "feedback_status", {}),
        ("/api/inspections", "inspector_name", {}),
        (prefix + "/processing-records", "processor_name", {}),
        (prefix + "/inventory", "batch_no", {}),
        (prefix + "/inventory", "previous_batch_no", {}),
        (prefix + "/stock", "batch_no", {}),
        (prefix + "/losses", "batch_no", {}),
        (prefix + "/serial-reallocations", "source_serial_no", {}),
        (prefix + "/dispatches", "serial_no", {}),
        (prefix + "/outbound-batches", "batch_no", {}),
        (prefix + "/receipts", "batch_no", {}),
        ("/api/warehouse-locations/inventory", "assignment", {"team_id": warehouse["id"]}),
        ("/api/serial-inventory/stock", "previous_batch_no", {}),
    ]
    for url, field, params in endpoints:
        response = client.get(
            url, params={**params, "table_query": json.dumps({"options": {"field": field}})}
        )
        assert response.status_code == 200, (url, response.text)
        assert isinstance(response.json().get("values"), list), (url, response.text)
