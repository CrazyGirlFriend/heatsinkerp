"""Card catalog filtering paginates current physical placements and live form locks."""

from datetime import datetime, timedelta

from app.database import SessionLocal
from app.models import WarehouseLocation, utcnow
from test_shared_warehouse_locations import reserve
from test_warehouse_location_locks import claim, create_slot, production_source, return_rows
from test_warehouse_locations import dispatch, location
from test_warehouse_receipts import intake
from test_warehouse_receipts import warehouse as warehouse


def catalog(client, **params):
    result = client.get("/api/warehouse-locations", params=params)
    assert result.status_code == 200, result.text
    return result.json()


def test_fifty_card_pages_and_filtering_before_pagination(client, warehouse):
    with SessionLocal.begin() as db:
        db.add_all(
            WarehouseLocation(team_id=warehouse["team"]["id"], name=f"A-{number:02d}")
            for number in range(1, 56)
        )
    first = catalog(client, page_size=50)
    second = catalog(client, page_size=50, page=2)
    assert first["total"] == second["total"] == 55
    assert len(first["items"]) == 50
    assert [row["name"] for row in second["items"]] == [f"A-{n:02d}" for n in range(51, 56)]
    with SessionLocal.begin() as db:
        for row in db.query(WarehouseLocation).filter(WarehouseLocation.name < "A-51"):
            row.active = False
    filtered = catalog(client, state="available", page_size=3, page=2)
    assert filtered["total"] == 5
    assert [row["name"] for row in filtered["items"]] == ["A-54", "A-55"]
    assert catalog(client, state="disabled", page_size=50)["total"] == 50
    assert client.get("/api/warehouse-locations", params={"state": "unknown"}).status_code == 422
    assert client.get("/api/warehouse-locations", params={"page_size": 101}).status_code == 422
    assert client.get("/api/warehouse-locations", headers=warehouse["other_headers"]).status_code == 403


def test_current_stock_pending_documents_and_form_locks_remain_distinct(client, warehouse):
    stocked = create_slot(client, "A-有料")
    first = intake(
        client, warehouse, idempotency_key="physical", **reserve(client, warehouse, stocked)
    ).json()
    reserve(client, warehouse, stocked)
    pending_slot = create_slot(client, "B-待签收")
    source = production_source(client, warehouse)
    pending_lease = claim(client, pending_slot, warehouse["other_headers"]).json()
    outgoing = return_rows(client, warehouse, source, "pending", {
        "warehouse_location": pending_slot["name"],
        "warehouse_location_reservation_key": pending_lease["key"],
    })
    assert outgoing.status_code == 201, outgoing.text
    draft = create_slot(client, "C-填写中")
    assert claim(client, draft, warehouse["headers"]).status_code == 200
    expired = create_slot(client, "D-到期")
    assert claim(client, expired, warehouse["headers"]).status_code == 200
    disabled = create_slot(client, "E-停用")
    with SessionLocal.begin() as db:
        db.get(WarehouseLocation, expired["id"]).reserved_until = utcnow() - timedelta(seconds=1)
        db.get(WarehouseLocation, disabled["id"]).active = False
    free = create_slot(client, "F-空仓")
    for state, expected in {
        "occupied": [stocked["id"]],
        "pending": [pending_slot["id"]],
        "draft": [stocked["id"], draft["id"]],
        "disabled": [disabled["id"]],
        "available": [expired["id"], free["id"]],
    }.items():
        page = catalog(client, state=state, page_size=50)
        assert page["total"] == len(expected)
        assert [row["id"] for row in page["items"]] == expected
    current = catalog(client, state="occupied")["items"][0]
    assert current["has_stock"] and current["draft_locked"]
    for key in ("created_at", "received_at"):
        assert datetime.fromisoformat(current["batches"][0][key]) == datetime.fromisoformat(first[key])
    incoming = catalog(client, state="pending")["items"][0]
    assert not incoming["has_stock"] and not incoming["draft_locked"]
    assert incoming["batches"][0]["received_at"] is None
    assert datetime.fromisoformat(incoming["batches"][0]["created_at"]) == datetime.fromisoformat(
        outgoing.json()["items"][0]["created_at"]
    )


def test_search_matches_current_material_and_batch_but_not_historical_positions(client, warehouse):
    chosen = location(client, warehouse, "Z-目标仓")
    response = intake(client, warehouse, material_name="材料%1", **chosen)
    assert response.status_code == 201, response.text
    first = response.json()
    create_slot(client, "A-空仓")
    for query in ("WAREHOUSE-001", "材料%1", first["batch_no"], "Z-目标"):
        result = catalog(client, query=query, page_size=1)
        assert result["total"] == 1
        assert result["items"][0]["name"] == "Z-目标仓"
    assert catalog(client, query="材料_1")["total"] == 0
    dispatch(client, warehouse, first, "all-moved")
    for query in ("WAREHOUSE-001", "材料%1", first["batch_no"]):
        assert catalog(client, query=query)["total"] == 0
    assert catalog(client, query="Z-目标")["items"][0]["batches"] == []
