"""Final delivery ordering uses the displayed deadline before paginating tasks."""

from datetime import datetime
from uuid import uuid4

import pytest
from app.database import SessionLocal
from app.models import ProductionSchedule, ProductionScheduleTask
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

URL = "/api/production-schedules/tasks"


def task(db, team_id, serial, first_day, last_day, final_day=None, cancelled_day=None):
    item = ProductionScheduleTask(
        title=serial,
        serial_no=serial,
        final_due_at=datetime(2040, 1, final_day) if final_day else None,
        idempotency_key=uuid4().hex,
        request_hash=uuid4().hex,
    )
    db.add(item)
    db.flush()
    days = [first_day, last_day] + ([cancelled_day] if cancelled_day else [])
    for index, day in enumerate(days, 1):
        db.add(
            ProductionSchedule(
                task_id=item.id,
                serial_no=serial,
                team_id=team_id,
                external_destination="交货",
                sequence_no=index,
                due_at=datetime(2040, 1, day),
                initial_due_at=datetime(2040, 1, day),
                target_quantity=100,
                cancelled_at=datetime(2039, 1, 1) if index == 3 else None,
                idempotency_key=uuid4().hex,
                request_hash=uuid4().hex,
            )
        )
    return item.id


@pytest.mark.parametrize("status", [None, "pending"])
@pytest.mark.parametrize("sort_order", ["asc", "desc"])
def test_final_delivery_sort_respects_search_status_and_pagination(
    client, warehouse, status, sort_order
):
    team_id = warehouse["other"]["id"]
    with SessionLocal.begin() as db:
        late = task(db, team_id, "SORT-A", 1, 9, final_day=12)
        early = task(db, team_id, "SORT-B", 8, 9, final_day=10)
        legacy = task(db, team_id, "SORT-C", 3, 11, cancelled_day=30)
        tied = task(db, team_id, "SORT-D", 2, 9, final_day=11)
        task(db, team_id, "OTHER", 1, 2, final_day=2)
    expected = [early, legacy, tied, late] if sort_order == "asc" else [late, legacy, tied, early]
    params = dict(query="SORT-", team_id=team_id, sort_order=sort_order, page_size=2)
    if status:
        params["status"] = status
    items = []
    for page in (1, 2):
        response = client.get(URL, params={**params, "page": page})
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["total"] == 4
        items.extend(result["items"])
    assert [item["id"] for item in items] == expected
    assert next(item for item in items if item["id"] == legacy)["final_due_at"].startswith(
        "2040-01-11"
    )
    assert client.get(URL, params={"sort_order": "invalid"}).status_code == 422
