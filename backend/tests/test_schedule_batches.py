from app.database import SessionLocal
from app.models import MaterialStockBalance, ProductionScheduleTask
from test_production_schedules import URL, get, plan
from test_warehouse_classification import dispatch
from test_warehouse_receipts import intake  # noqa: F401
from test_warehouse_receipts import warehouse as warehouse


def batch(number=1, quantity=40, **extra):
    return {
        "batch_number": number,
        "planned_start_at": "2026-12-20T08:00:00+08:00",
        "due_at": "2026-12-21T16:00:00+08:00",
        "target_quantity": quantity,
        **extra,
    }


def save(client, item, batches, headers=None):
    return client.put(
        f"{URL}/{item['id']}/batches",
        headers=headers or {},
        json={"expected_version": item["version"], "batches": batches},
    )


def writes(item):
    fields = {
        "id",
        "batch_number",
        "planned_start_at",
        "due_at",
        "target_quantity",
        "target_weight",
        "upstream_batch_ids",
    }
    return [{k: v for k, v in b.items() if k in fields} for b in item["batches"]]


def test_team_owns_batches_and_admin_owns_final_due(client, warehouse):
    s = warehouse
    item = plan(client, s, workshop=True)
    with SessionLocal() as db:
        final = db.get(ProductionScheduleTask, item["task_id"]).final_due_at
    rows = [batch(), batch(2, 60, due_at="2026-12-22T17:00:00+08:00")]
    assert save(client, item, rows, s["headers"]).status_code == 403
    response = save(client, item, rows, s["other_headers"])
    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["target_quantity"] == 100
    assert updated["due_at"] == "2026-12-22T09:00:00+00:00"
    assert [b["target_quantity"] for b in updated["batches"]] == [40, 60]
    assert updated["history"][0]["action"] == "batches_updated"
    assert len(updated["history"][0]["after"]["batches"]) == 2
    with SessionLocal() as db:
        assert db.get(ProductionScheduleTask, item["task_id"]).final_due_at == final
    assert save(client, item, rows, s["other_headers"]).status_code == 409
    # Administrator may adjust the same batch plan.
    assert save(client, updated, writes(updated)).status_code == 200
    assert (
        client.put(
            f"{URL}/{item['id']}/batches",
            headers=s["other_headers"],
            json={"expected_version": 3, "batches": rows, "final_due_at": "2099-01-01T00:00:00Z"},
        ).status_code
        == 422
    )
    assert (
        client.patch(
            f"{URL}/tasks/{item['task_id']}",
            headers=s["other_headers"],
            json={
                "expected_version": 1,
                "title": "changed",
                "final_due_at": "2099-01-01T00:00:00Z",
            },
        ).status_code
        == 403
    )


def test_validation_upstream_warnings_never_reschedule_downstream(client, warehouse):
    s = warehouse
    first = plan(client, s)
    second = plan(client, s, workshop=True, predecessor_id=first["id"])
    first = save(client, first, [batch(1, 100)], s["headers"]).json()
    bid = first["batches"][0]["id"]
    body = [
        batch(
            1,
            100,
            planned_start_at="2026-12-21T17:00:00+08:00",
            due_at="2026-12-22T17:00:00+08:00",
            upstream_batch_ids=[bid],
        )
    ]
    response = save(client, second, body, s["other_headers"])
    assert response.status_code == 200, response.text
    second = response.json()
    own_start = second["batches"][0]["planned_start_at"]
    own_due = second["batches"][0]["due_at"]
    revised = writes(first)
    revised[0]["due_at"] = "2026-12-22T16:00:00+08:00"
    assert save(client, first, revised, s["headers"]).status_code == 200
    refreshed = get(client, second)
    assert refreshed["batches"][0]["planned_start_at"] == own_start
    assert refreshed["batches"][0]["due_at"] == own_due
    assert refreshed["version"] == second["version"]
    assert any("上游" in w for w in refreshed["batches"][0]["warnings"])
    for invalid in [
        batch(planned_start_at="2026-12-22T16:00:00+08:00"),
        batch(planned_start_at="2026-12-20T08:30:00+08:00"),
        batch(planned_start_at="2026-12-20T08:00:00"),
        batch(upstream_batch_ids=[999999]),
        batch(id=bid),
    ]:
        assert save(client, second, [invalid], s["other_headers"]).status_code == 422
    assert save(client, second, [batch(), batch()], s["other_headers"]).status_code == 422
    # Referenced upstream batch cannot be removed by replacing its identity.
    current_first = get(client, first)
    assert save(client, current_first, [batch(2, 100)], s["headers"]).status_code == 409


def test_dispatch_batch_assignment_retry_void_and_no_retroactive_guess(client, warehouse):
    s = warehouse
    lot = intake(client, s).json()
    item = plan(client, s, lot)
    assert save(client, item, [batch(1, 50)], s["headers"]).status_code == 422
    old = dispatch(
        client,
        s,
        [{"source_transfer_id": lot["id"], "quantity": 10, "weight": 1}],
        idempotency_key="old",
    )
    assert old.status_code == 201, old.text
    response = save(client, item, [batch(), batch(2, 60)], s["headers"])
    assert response.status_code == 200, response.text
    item = response.json()
    assert item["dispatched_quantity"] == 10
    assert sum(b["dispatched_quantity"] for b in item["batches"]) == 0
    first, second = item["batches"]
    line = {
        "source_transfer_id": lot["id"],
        "quantity": 40,
        "weight": 4,
        "production_schedule_id": item["id"],
    }
    assert dispatch(client, s, [line], idempotency_key="missing").status_code == 422
    assert (
        dispatch(
            client, s, [{**line, "production_schedule_batch_id": 999999}], idempotency_key="invalid"
        ).status_code
        == 422
    )
    with SessionLocal() as db:
        assert db.get(MaterialStockBalance, lot["id"]).on_hand_quantity == 90
    selected = {**line, "production_schedule_batch_id": first["id"]}
    result = dispatch(client, s, [selected], idempotency_key="one-batch")
    assert result.status_code == 201, result.text
    assert dispatch(client, s, [selected], idempotency_key="one-batch").json() == result.json()
    refreshed = get(client, item)
    assert [b["dispatched_quantity"] for b in refreshed["batches"]] == [40, 0]
    assert all(b["status"] == "not_assessed" for b in refreshed["batches"])
    assert save(client, refreshed, [writes(refreshed)[1]], s["headers"]).status_code == 409
    sent = result.json()["items"][0]
    assert (
        client.delete(
            "/api/material-transfers/" + sent["batch_no"], headers=s["headers"]
        ).status_code
        == 204
    )
    assert get(client, item)["batches"][0]["dispatched_quantity"] == 0


def test_early_batch_deadline_is_visible_in_filters(client, warehouse):
    item = plan(client, warehouse, workshop=True)
    response = save(
        client,
        item,
        [
            batch(1, 40, planned_start_at="2020-01-01T00:00:00Z", due_at="2020-01-02T00:00:00Z"),
            batch(2, 60, planned_start_at="2090-01-01T00:00:00Z", due_at="2090-01-02T00:00:00Z"),
        ],
        warehouse["other_headers"],
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["status"] == result["batches"][0]["status"] == "overdue"
    assert result["batches"][1]["status"] == "pending"
    assert item["id"] in [
        p["id"] for p in client.get(URL, params={"status": "overdue"}).json()["items"]
    ]
    assert item["task_id"] in [
        p["id"] for p in client.get(URL + "/tasks", params={"scope": "attention"}).json()["items"]
    ]


def test_each_batch_must_finish_and_date_filter_matches_early_batch(client, warehouse):
    from test_quantity_adjustments import change, processing_lot

    s = warehouse
    lot = processing_lot(client, s, quantity=140, weight=14)
    assert (
        change(client, s, lot, 140, workshop=True, processing_status="complete").status_code == 201
    )
    item = plan(client, s, lot, workshop=True)
    response = save(
        client,
        item,
        [
            batch(1, 40, planned_start_at="2020-01-01T00:00:00Z", due_at="2020-01-02T00:00:00Z"),
            batch(2, 60, planned_start_at="2090-01-01T00:00:00Z", due_at="2090-01-02T00:00:00Z"),
        ],
        s["other_headers"],
    )
    assert response.status_code == 200, response.text
    item = response.json()
    first, second = item["batches"]
    date_filter = {"due_from": "2020-01-02T00:00:00Z", "due_to": "2020-01-02T23:00:00Z"}
    assert item["id"] in [p["id"] for p in client.get(URL, params=date_filter).json()["items"]]
    assert item["task_id"] in [
        p["id"] for p in client.get(URL + "/tasks", params=date_filter).json()["items"]
    ]
    sent = dispatch(
        client,
        s,
        [
            {
                "source_transfer_id": lot["id"],
                "quantity": 100,
                "weight": 10,
                "production_schedule_id": item["id"],
                "production_schedule_batch_id": second["id"],
            }
        ],
        workshop=True,
        idempotency_key="over-second-batch",
    )
    assert sent.status_code == 201, sent.text
    current = get(client, item)
    assert current["dispatched_quantity"] == 100
    assert current["remaining_quantity"] == 40
    assert current["completed_at"] is None
    assert current["status"] == "overdue"
    assert current["batches"][1]["status"] == "completed"
    sent = dispatch(
        client,
        s,
        [
            {
                "source_transfer_id": lot["id"],
                "quantity": 40,
                "weight": 4,
                "production_schedule_id": item["id"],
                "production_schedule_batch_id": first["id"],
            }
        ],
        workshop=True,
        idempotency_key="finish-first-batch",
    )
    assert sent.status_code == 201, sent.text
    current = get(client, item)
    assert current["remaining_quantity"] == 0
    assert current["status"] == "completed_late"
    assert current["completed_at"] == current["batches"][0]["completed_at"]
