"""Reported stock must stay on its engineering rework route until it is resumed."""

from uuid import uuid4

import pytest
from app.database import SessionLocal
from app.models import MaterialStockBalance, MaterialTransfer, ProcessRouteSerial
from test_processing_daily import work
from test_team_problem_workflow import publish, request
from test_warehouse_classification import base, dispatch
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

pytestmark = pytest.mark.usefixtures("legacy_stock")


@pytest.mark.parametrize("published", [False, True], ids=["pending", "published"])
@pytest.mark.parametrize("action", ["scrap_dispatch", "reallocate"])
def test_reported_stock_cannot_bypass_rework_route(client, warehouse, published, action):
    _, route, engineering_id, headers = request(client, warehouse)
    if published:
        publish(client, warehouse, route, engineering_id, headers)
    source_id = route["rework_request"]["source_transfer_id"]
    if action == "scrap_dispatch":
        response = dispatch(
            client,
            warehouse,
            [dict(source_transfer_id=source_id, quantity=2, weight=20, material_type="waste")],
            workshop=True,
            idempotency_key=uuid4().hex,
        )
    else:
        with SessionLocal.begin() as db:
            db.add(ProcessRouteSerial(serial_no="other-order"))
        response = client.post(
            base(warehouse, True) + "/serial-reallocations",
            headers=warehouse["other_headers"],
            json=dict(
                source_transfer_id=source_id,
                serial_no="OTHER-ORDER",
                quantity=2,
                weight=20,
                idempotency_key=uuid4().hex,
            ),
        )
    assert response.status_code == 422, response.text
    assert "返工工艺" in response.text
    with SessionLocal() as db:
        balance = db.get(MaterialStockBalance, source_id)
        assert (balance.on_hand_quantity, balance.on_hand_weight) == (2, 20)
        assert (balance.reserved_quantity, balance.reserved_weight) == (0, 0)
        assert db.get(MaterialTransfer, source_id).rework_route_id == route["id"]


def test_scrap_recorded_during_engineered_rework_can_return_to_warehouse(client, warehouse):
    _, route, engineering_id, headers = request(client, warehouse)
    publish(client, warehouse, route, engineering_id, headers)
    employee = client.get(base(warehouse, True) + "/employees").json()[0]
    completed = work(
        client,
        warehouse,
        {"id": route["rework_request"]["source_transfer_id"]},
        employee,
        work_kind="rework",
        quantity=2,
        input_quantity=2,
        completed_quantity=1,
        completed_weight=19,
        outputs=[
            dict(
                role="produced",
                material_type="semi_finished",
                quantity=1,
                weight=19,
                transfer_specification="20 × 10 × 2.5 mm",
            ),
            dict(role="scrap", material_type="waste", quantity=1, weight=1),
        ],
        idempotency_key=uuid4().hex,
    )
    assert completed.status_code == 201, completed.text
    scrap = next(row for row in completed.json()["outputs"] if row["role"] == "scrap")
    returned = dispatch(
        client,
        warehouse,
        [dict(source_transfer_id=scrap["id"], quantity=1, weight=1)],
        workshop=True,
        idempotency_key=uuid4().hex,
    )
    assert returned.status_code == 201, returned.text
    assert returned.json()["items"][0]["material_type"] == "waste"
