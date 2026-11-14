"""Serial progress keeps physical customer shipments separate from operation output."""

from datetime import datetime
from uuid import uuid4

import pytest
from app.database import SessionLocal
from app.models import MaterialTransfer, ProductionScheduleTask
from test_external_outbound import confirm, legacy_dispatch
from test_external_outbound import outbound as outbound  # noqa: F401

pytestmark = pytest.mark.usefixtures("legacy_stock")


def make_task(serial, quantity, *, cancelled=False):
    with SessionLocal.begin() as db:
        task = ProductionScheduleTask(
            title="发货进度测试",
            serial_no=serial,
            delivery_batches=[
                {"batch_number": 1, "target_quantity": quantity, "due_at": "2026-12-30T08:00:00Z"}
            ],
            idempotency_key=uuid4().hex,
            request_hash=uuid4().hex,
            cancelled_at=datetime(2026, 11, 1) if cancelled else None,
        )
        db.add(task)
        db.flush()
        return task.id


def test_only_confirmed_customer_finished_shipments_count(client, outbound):
    source = outbound["lots"][0]
    task_id = make_task(source["serial_no"], 100)
    other_task_id = make_task(source["serial_no"], 50)
    make_task(source["serial_no"], 200, cancelled=True)
    make_task("OTHER-SERIAL", 500)
    url = f"/api/production-schedules/tasks/{task_id}/progress"

    def current():
        response = client.get(url)
        assert response.status_code == 200, response.text
        return response.json()

    def send(destination, quantity):
        response = legacy_dispatch(
            client,
            outbound,
            external_destination=destination,
            idempotency_key=uuid4().hex,
            lines=[{"source_transfer_id": source["id"], "quantity": quantity, "weight": 1}],
        )
        assert response.status_code == 201, response.text
        return response.json()["items"][0]

    first = send("对外转料", 10)
    initial = current()
    assert initial["shipped_quantity"] == 0 and initial["shipments"] == []
    assert initial["planned_quantity"] == 150
    assert {t["id"] for t in initial["tasks"]} == {task_id, other_task_id}
    assert confirm(client, outbound, first).status_code == 200
    for destination in ("库房成品", "外委库"):
        line = send(destination, 5)
        assert confirm(client, outbound, line).status_code == 200
    non_finished = send("对外转料", 5)
    assert confirm(client, outbound, non_finished).status_code == 200
    with SessionLocal.begin() as db:
        db.get(MaterialTransfer, non_finished["id"]).material_type = "semi_finished"
    result = current()
    assert result["shipped_quantity"] == 10
    assert result["shipped_weight"] == 1
    assert result["shipment_count"] == 1
    assert [row["id"] for row in result["shipments"]] == [first["id"]]
    assert result["last_shipped_at"] == result["shipments"][0]["shipped_at"]
    # A later void must roll progress back, with no stored percentage to become stale.
    with SessionLocal.begin() as db:
        db.get(MaterialTransfer, first["id"]).status = "voided"
    assert current()["shipped_quantity"] == 0
    assert client.get("/api/production-schedules/tasks/999999/progress").status_code == 404
    client.headers.pop("Authorization")
    assert client.get(url).status_code == 401
