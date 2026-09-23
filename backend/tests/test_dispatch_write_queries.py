"""Fresh outbound responses must not reread their own submission header/lines."""

import pytest
from datetime import datetime
from sqlalchemy import func, select

from app.database import SessionLocal, engine
from app.models import (
    MaterialDispatch,
    MaterialTransfer,
    NotificationOutbox,
    TransferBatchNumberSequence,
)
from app.schemas import MaterialTransferResponse

from test_transfer_list_loading import read_statements
from test_warehouse_classification import dispatch
from test_warehouse_receipts import intake, warehouse  # noqa: F401
from test_stock_balances import reconcile


@pytest.mark.parametrize("line_count", [1, 12])
def test_new_dispatch_reuses_created_rows_but_replay_reads_current_state(
    client, warehouse, line_count
):  # noqa: F811
    origin = intake(client, warehouse).json()
    lines = [
        {"source_transfer_id": origin["id"], "quantity": 1, "weight": ".100"}
        for _ in range(line_count)
    ]
    with read_statements() as statements:
        created = dispatch(client, warehouse, lines)
    assert created.status_code == 201, created.text
    assert len(created.json()["items"]) == line_count
    assert not any("WHERE material_transfers.dispatch_id =" in sql for sql in statements)
    assert not any("WHERE material_dispatches.id =" in sql for sql in statements)
    assert len({item["batch_no"] for item in created.json()["items"]}) == line_count

    retry = dispatch(client, warehouse, lines)
    assert retry.status_code == 201 and retry.json() == created.json()
    batch = created.json()["items"][0]
    confirmed = client.post(
        f"/api/material-transfers/{batch['batch_no']}/confirm",
        headers=warehouse["other_headers"],
        json={"idempotency_key": "query-budget-confirm", "expected_version": batch["version"]},
    )
    assert confirmed.status_code == 200, confirmed.text
    latest = dispatch(client, warehouse, lines)
    assert latest.status_code == 201
    assert latest.json()["items"][0]["status"] == "received"
    assert all(item["status"] == "pending" for item in latest.json()["items"][1:])


@pytest.mark.parametrize("line_count", [1, 12, 100])
def test_dispatch_shared_reads_do_not_grow_with_line_count(client, warehouse, line_count):  # noqa: F811
    origin = intake(client, warehouse, serial_no="0000123").json()
    purposes = []
    for name in ("加工", "返工"):
        response = client.post(
            f"/api/team-materials/{warehouse['other']['id']}/purposes",
            headers=warehouse["other_headers"],
            json={"name": name},
        )
        assert response.status_code == 201, response.text
        purposes.append(response.json())
    assert (
        client.put(
            "/api/serial-urgency",
            json={
                "serial_no": "0000123",
                "urgent": True,
                "reason": "交期提前",
                "expected_version": 0,
            },
        ).status_code
        == 200
    )
    lines = [
        {
            "source_transfer_id": origin["id"],
            "quantity": 1,
            "weight": ".100",
            "purpose_id": purposes[index % 2]["id"],
        }
        for index in range(line_count)
    ]
    with read_statements() as statements:
        response = dispatch(client, warehouse, lines)
    assert response.status_code == 201, response.text
    assert len(statements) <= 12, len(statements)
    assert any("LEFT OUTER JOIN serial_urgencies" in sql for sql in statements)
    assert not any("material_transfer_events" in sql for sql in statements)
    items = response.json()["items"]
    assert len(items) == line_count
    assert len({item["batch_no"] for item in items}) == line_count
    assert all(item["serial_no"] == "0000123" and item["urgency"]["urgent"] for item in items)
    assert [item["purpose_name"] for item in items] == [
        purposes[i % 2]["name"] for i in range(line_count)
    ]
    assert reconcile()[origin["id"]][0] == 100 - line_count
    assert dispatch(client, warehouse, lines).json() == response.json()


def test_bulk_dispatch_keeps_persisted_times_in_first_response_and_audit(client, warehouse):  # noqa: F811
    origin = intake(client, warehouse).json()
    with engine.begin() as connection:
        connection.exec_driver_sql("""CREATE TRIGGER dispatch_second_precision AFTER INSERT ON material_transfers
            WHEN NEW.dispatch_id IS NOT NULL BEGIN
            UPDATE material_transfers SET created_at=DATETIME(NEW.created_at),
                updated_at=DATETIME(NEW.updated_at) WHERE id=NEW.id; END""")
    lines = [{"source_transfer_id": origin["id"], "quantity": 1, "weight": ".100"}] * 3
    response = dispatch(client, warehouse, lines)
    assert response.status_code == 201, response.text
    assert dispatch(client, warehouse, lines).json() == response.json()
    for item in response.json()["items"]:
        detail = client.get(
            "/api/material-transfers/" + item["batch_no"], headers=warehouse["headers"]
        ).json()
        assert MaterialTransferResponse.model_validate(item).model_dump(mode="json") == {
            **detail,
            "history": [],
            "loss_records": [],
        }
        assert datetime.fromisoformat(
            detail["history"][0]["occurred_at"]
        ) == datetime.fromisoformat(item["updated_at"])
        assert detail["history"][0]["changes"]["created_at"]["after"] == item["created_at"].replace(
            "Z", "+00:00"
        )


def test_mid_batch_audit_failure_rolls_back_numbers_balances_and_notification(
    client, warehouse, monkeypatch
):  # noqa: F811
    from app import material_transfer_workflow as workflow

    origin = intake(client, warehouse).json()
    with SessionLocal() as db:
        before = db.scalar(select(func.count()).select_from(NotificationOutbox))
    original = workflow._record_event
    recorded = []

    def fail_second(*args, **kwargs):
        recorded.append(args[1].batch_no)
        if len(recorded) == 2:
            raise RuntimeError("audit failed")
        return original(*args, **kwargs)

    monkeypatch.setattr(workflow, "_record_event", fail_second)
    lines = [{"source_transfer_id": origin["id"], "quantity": 1, "weight": ".100"}] * 3
    assert dispatch(client, warehouse, lines).status_code == 500
    assert reconcile()[origin["id"]][0] == 100
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(MaterialDispatch)) == 0
        assert db.scalar(select(func.count()).select_from(MaterialTransfer)) == 1
        assert db.scalar(select(TransferBatchNumberSequence.last_value)) == 1
        assert db.scalar(select(func.count()).select_from(NotificationOutbox)) == before
