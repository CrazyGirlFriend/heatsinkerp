"""Fresh outbound responses must not reread their own submission header/lines."""

import pytest

from test_transfer_list_loading import read_statements
from test_warehouse_classification import dispatch
from test_warehouse_receipts import intake, warehouse  # noqa: F401


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
