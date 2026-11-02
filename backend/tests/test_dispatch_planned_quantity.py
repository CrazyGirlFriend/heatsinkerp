"""Dispatch can correct the order total independently of the engineering original."""

import pytest
from test_dispatch_order_documents import setup_order
from test_dispatch_planning import URL, create, submit
from test_dispatch_planning import dispatcher as dispatcher
from test_warehouse_receipts import warehouse as warehouse


def test_create_corrected_total_preserves_process_and_retry(client, warehouse, dispatcher):
    body = setup_order(client, warehouse)
    original = client.get(f"/api/process-routes/{body['route_id']}").json()
    body["planned_quantity"] = 80
    response = submit(client, body, dispatcher)
    assert response.status_code == 422 and "各批数量合计" in response.text
    body["delivery_batches"][0]["target_quantity"] = 80
    assert submit(client, body).status_code == 403
    response = submit(client, body, dispatcher)
    assert response.status_code == 201, response.text
    task = response.json()
    assert task["delivery_batches"][0]["target_quantity"] == 80
    assert submit(client, body, dispatcher).json()["id"] == task["id"]
    assert (
        client.get(f"{URL}/tasks/{task['id']}").json()["delivery_batches"]
        == task["delivery_batches"]
    )
    assert client.get(f"/api/process-routes/{body['route_id']}").json() == original
    body["planned_quantity"] = 90
    body["delivery_batches"][0]["target_quantity"] = 90
    assert submit(client, body, dispatcher).status_code == 409


def test_correct_existing_total_is_atomic_versioned_and_dispatch_only(
    client, warehouse, dispatcher
):
    task, _ = create(client, warehouse, dispatcher)
    endpoint = f"{URL}/tasks/{task['id']}"
    update = dict(
        expected_version=task["version"],
        title=task["title"],
        planned_quantity=120,
        delivery_batches=[{**task["delivery_batches"][0], "target_quantity": 120}],
    )
    for headers in [None, warehouse["headers"], warehouse["other_headers"]]:
        assert client.patch(endpoint, headers=headers, json=update).status_code == 403
    invalid = {**update, "planned_quantity": 110}
    assert client.patch(endpoint, headers=dispatcher, json=invalid).status_code == 422
    assert client.get(endpoint).json()["delivery_batches"] == task["delivery_batches"]
    response = client.patch(endpoint, headers=dispatcher, json=update)
    assert response.status_code == 200, response.text
    saved = response.json()
    assert sum(b["target_quantity"] for b in saved["delivery_batches"]) == 120
    assert client.get(endpoint).json()["delivery_batches"] == saved["delivery_batches"]
    # Correcting the customer order must not rewrite team commitments already on record.
    assert [n["target_quantity"] for n in saved["nodes"]] == [
        n["target_quantity"] for n in task["nodes"]
    ]
    assert client.patch(endpoint, headers=dispatcher, json=update).status_code == 409
    update["expected_version"] = saved["version"]
    missing_batches = {key: value for key, value in update.items() if key != "delivery_batches"}
    assert client.patch(endpoint, headers=dispatcher, json=missing_batches).status_code == 422
    locked = client.put(
        endpoint + "/lock",
        headers=dispatcher,
        json={"expected_version": saved["version"], "locked": True},
    ).json()
    update["expected_version"] = locked["version"]
    assert client.patch(endpoint, headers=dispatcher, json=update).status_code == 409


@pytest.mark.parametrize("quantity", [None, 0, -1, 1.5, 2147483648, True])
def test_invalid_planned_quantity_rejected_on_create_and_update(
    client, warehouse, dispatcher, quantity
):
    task, _ = create(client, warehouse, dispatcher)
    endpoint = f"{URL}/tasks/{task['id']}"
    payload = dict(
        expected_version=task["version"],
        title=task["title"],
        planned_quantity=quantity,
        delivery_batches=task["delivery_batches"],
    )
    assert client.patch(endpoint, headers=dispatcher, json=payload).status_code == 422
    body = dict(
        serial_no=task["serial_no"],
        route_id=task["nodes"][0]["process_route_id"],
        route_version=1,
        final_due_at="2026-12-30T16:00:00+08:00",
        idempotency_key="invalid-total",
        business_person_ids=[task["business_people"][0]["id"]],
        planned_quantity=quantity,
        delivery_batches=task["delivery_batches"],
    )
    assert submit(client, body, dispatcher).status_code == 422
    assert client.get(endpoint).json()["version"] == task["version"]


def test_corrected_total_can_seed_a_single_batch(client, warehouse, dispatcher):
    body = setup_order(client, warehouse)
    body["planned_quantity"] = 75
    del body["delivery_batches"]
    response = submit(client, body, dispatcher)
    assert response.status_code == 201, response.text
    assert response.json()["delivery_batches"][0]["target_quantity"] == 75
