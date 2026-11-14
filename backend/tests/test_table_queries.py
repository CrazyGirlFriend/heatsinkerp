"""Column operations run before paging, within the existing authorization scope."""

import json
from datetime import datetime

from app.database import SessionLocal
from app.models import MaterialTransfer, ProductionScheduleTask
from test_schedule_task_sorting import task
from test_warehouse_receipts import intake
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401


def query(field=None, value="", end="", kind="text", sort=None):
    return json.dumps(
        {
            "filters": [{"field": field, "value": value, "end": end, "kind": kind}]
            if field
            else [],
            **({"sort": sort} if sort else {}),
        }
    )


def test_task_and_team_lists_default_to_creation_before_due_date(client, warehouse):
    team = warehouse["other"]["id"]
    with SessionLocal.begin() as db:
        older = task(db, team, "OLD", 1, 2)
        newer = task(db, team, "NEW", 20, 25)
        db.get(ProductionScheduleTask, older).created_at = datetime(2026, 1, 1)
        db.get(ProductionScheduleTask, newer).created_at = datetime(2026, 1, 2)
    tasks = client.get("/api/production-schedules/tasks", params={"page_size": 1}).json()
    assert tasks["items"][0]["id"] == newer
    nodes = client.get("/api/production-schedules", params={"team_id": team, "page_size": 1}).json()
    assert nodes["items"][0]["task_id"] == newer
    response = client.get(
        "/api/production-schedules",
        params={"team_id": team, "table_query": query("serial_no", "OLD"), "page_size": 1},
    )
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 2
    assert response.json()["items"][0]["task_id"] == older


def test_column_filters_cover_all_pages_and_reset(client, warehouse):
    for index, qty in enumerate([100, 5, 30]):
        response = intake(
            client,
            warehouse,
            serial_no=f"FILTER-{index}",
            quantity=qty,
            idempotency_key=f"column-{index}",
        )
        assert response.status_code == 201, response.text
    url = f"/api/team-materials/{warehouse['team']['id']}/receipts"
    params = {
        "page_size": 1,
        "table_query": query(
            "quantity", "20", "100", "number", {"field": "quantity", "direction": "asc"}
        ),
    }
    page1 = client.get(url, params=params)
    assert page1.status_code == 200, page1.text
    assert page1.json()["total"] == 2
    assert page1.json()["items"][0]["quantity"] == 30
    page2 = client.get(url, params={**params, "page": 2}).json()
    assert page2["items"][0]["quantity"] == 100
    assert client.get(url).json()["total"] == 3
    assert (
        client.get(url, params={"table_query": query("quantity", "100", "2", "number")}).status_code
        == 422
    )
    assert client.get(url, params={"table_query": query("password_hash", "x")}).status_code == 422
    assert client.get(url, params={"table_query": query("serial_no", "%")}).json()["total"] == 0
    other = f"/api/team-materials/{warehouse['other']['id']}/receipts"
    assert client.get(other, params=params).json()["total"] == 0


def test_catalog_sorts_slots_and_unassigned_before_paging(client, warehouse):
    from app.models import WarehouseLocation

    receipt = intake(
        client, warehouse, serial_no="CAT-NEW", quantity=70, idempotency_key="catalog-column"
    ).json()
    with SessionLocal.begin() as db:
        db.add(
            WarehouseLocation(
                team_id=warehouse["team"]["id"], name="CAT-OLD", created_at=datetime(2020, 1, 1)
            )
        )
        db.get(MaterialTransfer, receipt["id"]).created_at = datetime(2026, 1, 1)
    url = "/api/warehouse-locations/inventory"
    result = client.get(url, params={"query": "CAT-", "page_size": 1})
    assert result.status_code == 200, result.text
    assert result.json()["total"] == 2
    assert result.json()["items"][0]["stock"]["transfer"]["id"] == receipt["id"]
    second = client.get(url, params={"query": "CAT-", "page_size": 1, "page": 2}).json()
    assert second["items"][0]["location"]["name"] == "CAT-OLD"
    filtered = client.get(url, params={"table_query": query("quantity", "50", "80", "number")})
    assert filtered.status_code == 200, filtered.text
    assert filtered.json()["total"] == 1
    assert filtered.json()["items"][0]["stock"]["unassigned_quantity"] == 70


def test_inventory_quantity_and_local_calendar_filters_match_visible_rows(client, warehouse):
    for index, quantity in enumerate([10, 20, 30]):
        receipt = intake(
            client,
            warehouse,
            serial_no=f"TABLE-{index}",
            quantity=quantity,
            idempotency_key=f"inventory-{index}",
        )
        assert receipt.status_code == 201, receipt.text
        with SessionLocal.begin() as db:
            row = db.get(MaterialTransfer, receipt.json()["id"])
            row.created_at = row.received_at = datetime(2026, 3, 1, 15 + index, 0)
    receipt_url = f"/api/team-materials/{warehouse['team']['id']}/receipts"
    dates = {"table_query": query("created_at", "2026-03-02", "2026-03-02", "date")}
    response = client.get(receipt_url, params=dates)
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 2
    assert [row["serial_no"] for row in response.json()["items"]] == ["TABLE-2", "TABLE-1"]
    for url in [
        f"/api/team-materials/{warehouse['team']['id']}/inventory",
        "/api/serial-inventory/stock",
    ]:
        result = client.get(
            url,
            params={
                "page_size": 1,
                "table_query": query(
                    "on_hand_quantity",
                    "15",
                    "35",
                    "number",
                    {"field": "on_hand_quantity", "direction": "asc"},
                ),
            },
        )
        assert result.status_code == 200, result.text
        assert result.json()["total"] == 2
        assert result.json()["items"][0]["on_hand_quantity"] == 20


def test_task_quantity_and_batch_columns_match_displayed_fallbacks(client, warehouse):
    with SessionLocal.begin() as db:
        legacy = task(db, warehouse["other"]["id"], "LEGACY", 1, 2)
        split = task(db, warehouse["other"]["id"], "SPLIT", 1, 2)
        db.get(ProductionScheduleTask, split).delivery_batches = [
            {"batch_number": 1, "target_quantity": 70, "due_at": "2040-01-01T00:00:00"},
            {"batch_number": 2, "target_quantity": 50, "due_at": "2040-01-02T00:00:00"},
        ]
    url = "/api/production-schedules/tasks"
    result = client.get(
        url,
        params={
            "page_size": 1,
            "table_query": query(
                "quantity", "110", "130", "number", {"field": "quantity", "direction": "asc"}
            ),
        },
    )
    assert result.status_code == 200, result.text
    assert result.json()["total"] == 1
    assert result.json()["items"][0]["id"] == split
    for batch_count, expected in [(1, legacy), (2, split)]:
        result = client.get(
            url,
            params={
                "table_query": query(
                    "delivery_batches", str(batch_count), str(batch_count), "number"
                )
            },
        )
        assert result.status_code == 200, result.text
        assert result.json()["total"] == 1
        assert result.json()["items"][0]["id"] == expected


def test_catalog_filters_preserve_physical_stock_and_draft_locks(client, warehouse):
    from test_shared_warehouse_locations import reserve
    from test_warehouse_location_locks import create_slot

    slot = create_slot(client, "FILTER-SLOT")
    response = intake(client, warehouse, quantity=40, **reserve(client, warehouse, slot))
    assert response.status_code == 201, response.text
    receipt = response.json()
    reserve(client, warehouse, slot)
    url = "/api/warehouse-locations/inventory"
    for params in [
        {"state": "occupied"},
        {"state": "draft"},
        {"query": receipt["batch_no"]},
        {"table_query": query("assignment", "assigned", kind="select")},
        {"table_query": query("status", "draft", kind="select")},
    ]:
        result = client.get(url, params=params)
        assert result.status_code == 200, result.text
        assert result.json()["total"] == 1
        assert result.json()["items"][0]["location"]["id"] == slot["id"]
        assert (
            sum(row["quantity"] for row in result.json()["items"][0]["location"]["batches"]) == 40
        )
    assert client.get(url, params={"state": "unassigned"}).json()["total"] == 0
    assert client.get(url, headers=warehouse["other_headers"]).status_code == 403
