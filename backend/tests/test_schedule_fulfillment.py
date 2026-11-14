"""Customer fulfillment must not be inferred from workshop processing or handoffs."""

from datetime import datetime
from uuid import uuid4

import pytest
from app.database import SessionLocal
from app.models import (
    MaterialTransfer,
    ProductionSchedule,
    ProductionScheduleDelivery,
    ProductionScheduleTask,
)
from app.schedule_fulfillment import fulfillment_values
from test_external_outbound import confirm, legacy_dispatch
from test_external_outbound import outbound as outbound  # noqa: F401
from test_table_queries import query

pytestmark = pytest.mark.usefixtures("legacy_stock")
URL = "/api/production-schedules"


def order(s, *, due=datetime(2000, 1, 3), batches=None):
    with SessionLocal.begin() as db:
        task = ProductionScheduleTask(
            title="客户订单",
            serial_no=s["lots"][0]["serial_no"],
            final_due_at=due,
            created_at=datetime(1999, 1, 1),
            delivery_batches=batches,
            idempotency_key=uuid4().hex,
            request_hash=uuid4().hex,
        )
        db.add(task)
        db.flush()
        node = ProductionSchedule(
            task_id=task.id,
            serial_no=task.serial_no,
            team_id=s["team"]["id"],
            external_destination="对外转料",
            due_at=due,
            initial_due_at=due,
            target_quantity=100,
            idempotency_key=uuid4().hex,
            request_hash=uuid4().hex,
        )
        db.add(node)
        db.flush()
        return task.id, node.id


def ship(client, s, quantity, at, *, destination="对外转料"):
    response = legacy_dispatch(
        client,
        s,
        external_destination=destination,
        idempotency_key=uuid4().hex,
        lines=[{"source_transfer_id": s["lots"][0]["id"], "quantity": quantity, "weight": 1}],
    )
    assert response.status_code == 201, response.text
    item = response.json()["items"][0]
    assert confirm(client, s, item).status_code == 200
    with SessionLocal.begin() as db:
        db.get(MaterialTransfer, item["id"]).dispatched_at = at
    return item["id"]


def test_customer_quantity_drives_order_completion_lateness_and_paged_filters(client, outbound):
    task_id, _ = order(outbound)
    first = ship(client, outbound, 40, datetime(2000, 1, 2))
    url = f"{URL}/tasks/{task_id}"
    partial = client.get(url).json()
    assert partial["shipped_quantity"] == 40
    assert partial["shipment_status"] == "partial"
    assert not partial["order_completed"] and partial["order_overdue"]
    last = ship(client, outbound, 60, datetime(2000, 1, 4))
    complete = client.get(url).json()
    assert complete["shipped_quantity"] == 100 and complete["order_completed"]
    assert complete["shipment_status"] == "shipped" and complete["order_overdue"]
    assert complete["status"] == "completed_late"
    assert complete["shipment_completed_at"].startswith("2000-01-04")
    # Exactly on the promised deadline is on time, irrespective of today's date.
    with SessionLocal.begin() as db:
        db.get(MaterialTransfer, last).dispatched_at = datetime(2000, 1, 3)
    assert not client.get(url).json()["order_overdue"]
    for endpoint in (URL, URL + "/tasks"):
        response = client.get(
            endpoint,
            params={"table_query": query("order_completed", "1", kind="select"), "page_size": 1},
        )
        assert response.status_code == 200, response.text
        assert response.json()["total"] == 1
        assert response.json()["items"][0]["shipped_quantity"] == 100
        assert (
            client.get(
                endpoint, params={"table_query": query("order_overdue", "1", kind="select")}
            ).json()["total"]
            == 0
        )
    # Cancelling a shipment reverses both completion and its completion timestamp.
    with SessionLocal.begin() as db:
        db.get(MaterialTransfer, first).status = "voided"
    assert not client.get(url).json()["order_completed"]
    assert client.get(url).json()["shipment_completed_at"] is None


@pytest.mark.parametrize(
    "sent_at, late", [(datetime(2000, 1, 1, 8), False), (datetime(2000, 1, 2), True)]
)
def test_missed_customer_batch_remains_overdue_after_final_shipment_on_time(
    client, outbound, sent_at, late
):
    task_id, _ = order(
        outbound,
        batches=[
            {"batch_number": 1, "target_quantity": 40, "due_at": "2000-01-01T08:00:00+00:00"},
            {"batch_number": 2, "target_quantity": 60, "due_at": "2000-01-03T00:00:00+00:00"},
        ],
    )
    ship(client, outbound, 100, sent_at)
    item = client.get(f"{URL}/tasks/{task_id}").json()
    assert item["order_completed"] and item["order_overdue"] == late
    assert item["status"] == ("completed_late" if late else "completed")


def test_same_serial_orders_never_share_a_shipment_without_a_matching_link(client, outbound):
    first, first_node = order(outbound)
    second, _ = order(outbound)
    transfer = ship(client, outbound, 100, datetime(2000, 1, 2))
    with SessionLocal() as db:
        values = fulfillment_values(db, [first, second])
        assert all(item["shipped_quantity"] == 0 for item in values.values())
    with SessionLocal.begin() as db:
        db.add(ProductionScheduleDelivery(schedule_id=first_node, transfer_id=transfer))
    with SessionLocal() as db:
        values = fulfillment_values(db, [first, second])
        assert values[first]["order_completed"]
        assert values[second]["shipped_quantity"] == 0


def test_internal_warehouse_delivery_never_completes_customer_order(client, outbound):
    task_id, node_id = order(outbound)
    transfer = ship(client, outbound, 100, datetime(2000, 1, 2), destination="库房成品")
    with SessionLocal.begin() as db:
        db.get(ProductionSchedule, node_id).external_destination = "库房成品"
        db.get(MaterialTransfer, transfer).sent_processing_status = "complete"
        db.add(ProductionScheduleDelivery(schedule_id=node_id, transfer_id=transfer))
    item = client.get(f"{URL}/tasks/{task_id}").json()
    assert item["nodes"][0]["dispatched_quantity"] == 100
    assert item["nodes"][0]["handover_status"] == "completed"
    assert item["shipped_quantity"] == 0 and not item["order_completed"]
