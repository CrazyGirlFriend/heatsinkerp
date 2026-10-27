from uuid import uuid4

from app.database import SessionLocal
from app.models import MaterialTransfer
from test_processing_daily import work
from test_processing_route_methods import routed_lot
from test_production_schedules import URL, get, plan
from test_warehouse_classification import base, confirm, dispatch
from test_warehouse_receipts import intake
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401


def commitment(client, s, lot, route, quantity, index=2):
    return plan(
        client,
        s,
        lot,
        workshop=True,
        target_quantity=quantity,
        sources=[{"source_transfer_id": lot["id"], "quantity": quantity}],
        process_route_id=route["id"],
        process_step_index=index,
    )


def test_partial_work_links_exact_team_visit_and_dispatch_without_reselection(client, warehouse):
    s = warehouse
    lot, worker, route = routed_lot(client, s)
    first = commitment(client, s, lot, route, 3)
    second = commitment(client, s, lot, route, 7)
    context = client.get(base(s, True) + f"/stock/{lot['id']}/quantity-adjustments").json()
    assert {p["id"] for p in context["processing_schedules"]} == {first["id"], second["id"]}
    assert context["production_schedule_id"] is None
    missing = work(client, s, lot, worker)
    assert missing.status_code == 422, missing.text
    response = work(
        client,
        s,
        lot,
        worker,
        production_schedule_id=first["id"],
        completed_quantity=3,
        completed_weight=30,
    )
    assert response.status_code == 201, response.text
    result = response.json()
    assert result["production_schedule_id"] == first["id"]
    produced = next(item for item in result["outputs"] if item["role"] == "produced")
    remaining = next(item for item in result["outputs"] if item["role"] == "remaining")
    with SessionLocal() as db:
        assert db.get(MaterialTransfer, produced["id"]).processing_schedule_id == first["id"]
        assert db.get(MaterialTransfer, remaining["id"]).processing_schedule_id is None
    # The intermediate operation is not counted again as final team output.
    assert get(client, first)["processed_quantity"] == 0
    ctx = client.get(base(s, True) + f"/stock/{produced['id']}/quantity-adjustments").json()
    assert ctx["process_route"]["step_index"] == 2
    assert ctx["production_schedule_id"] == first["id"]
    wrong = work(
        client,
        s,
        produced,
        worker,
        production_schedule_id=second["id"],
        idempotency_key=uuid4().hex,
    )
    assert wrong.status_code == 422, wrong.text
    final = work(client, s, produced, worker, idempotency_key=uuid4().hex)
    assert final.status_code == 201, final.text
    output = final.json()["outputs"][0]
    assert get(client, first)["processed_quantity"] == 3
    assert get(client, first)["dispatched_quantity"] == 0
    candidates = client.get(
        URL + "/candidates",
        params={
            "team_id": s["other"]["id"],
            "source_transfer_ids": str(output["id"]),
            "next_team_id": s["team"]["id"],
        },
    ).json()
    assert [p["id"] for p in candidates["items"][0]["schedules"]] == [first["id"]]
    wrong = dispatch(
        client,
        s,
        [
            {
                "source_transfer_id": output["id"],
                "quantity": 3,
                "weight": 30,
                "production_schedule_id": second["id"],
            }
        ],
        workshop=True,
    )
    assert wrong.status_code == 422, wrong.text
    sent = dispatch(
        client,
        s,
        [{"source_transfer_id": output["id"], "quantity": 3, "weight": 30}],
        workshop=True,
    )
    assert sent.status_code == 201, sent.text
    assert get(client, first)["dispatched_quantity"] == 3
    assert get(client, second)["dispatched_quantity"] == 0


def test_plan_for_another_lot_or_route_is_rejected(client, warehouse):
    s = warehouse
    lot, worker, route = routed_lot(client, s, second=False)
    chosen = commitment(client, s, lot, route, 10, index=1)
    receipt = intake(
        client, s, process_route=route, quantity=10, weight=100, idempotency_key=uuid4().hex
    )
    assert receipt.status_code == 201, receipt.text
    sent = dispatch(
        client,
        s,
        [{"source_transfer_id": receipt.json()["id"], "quantity": 10, "weight": 100}],
        idempotency_key=uuid4().hex,
    )
    assert sent.status_code == 201, sent.text
    assert confirm(client, s, sent.json(), workshop=True).status_code == 200
    other = sent.json()["items"][0]
    other_plan = commitment(client, s, other, route, 10, index=1)
    rejected = work(client, s, lot, worker, production_schedule_id=other_plan["id"])
    assert rejected.status_code == 422, rejected.text
    assert get(client, chosen)["processed_quantity"] == 0


def test_only_owner_can_change_team_commitment_and_final_deadline_stays_fixed(client, warehouse):
    s = warehouse
    task = client.post(
        URL + "/tasks",
        json={
            "title": "客户交货",
            "serial_no": "SCHEDULE-OWNER",
            "idempotency_key": uuid4().hex,
            "final_due_at": "2026-12-25T18:00:00+08:00",
            "nodes": [
                {
                    "team_id": s["other"]["id"],
                    "next_team_id": s["team"]["id"],
                    "due_at": "2026-12-20T16:00:00+08:00",
                    "target_quantity": 10,
                }
            ],
        },
    )
    assert task.status_code == 201, task.text
    node = task.json()["nodes"][0]
    endpoint = f"{URL}/{node['id']}/commitment"
    data = {
        "expected_version": node["version"],
        "due_at": "2026-12-22T14:00:00+08:00",
        "target_quantity": 12,
        "completion_basis": "quantity",
        "notes": "分批交付",
    }
    assert client.patch(endpoint, json=data, headers=s["headers"]).status_code == 403
    assert (
        client.patch(
            endpoint, json={**data, "team_id": s["team"]["id"]}, headers=s["other_headers"]
        ).status_code
        == 422
    )
    result = client.patch(endpoint, json=data, headers=s["other_headers"])
    assert result.status_code == 200, result.text
    assert result.json()["target_quantity"] == 12
    assert result.json()["history"][0]["before"]["target_quantity"] == 10
    assert client.patch(endpoint, json=data, headers=s["other_headers"]).status_code == 409
    final = client.get(f"{URL}/tasks/{task.json()['id']}").json()
    assert final["final_due_at"] == "2026-12-25T10:00:00+00:00"
