"""Cross-order genealogy provides context without adding it to scoped inventory."""

from test_serial_reallocations import reallocate
from test_warehouse_receipts import intake
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401


def test_reallocation_chain_keeps_warehouse_origin_but_only_counts_requested_serial(
    client, warehouse
):
    a = intake(client, warehouse, serial_no="TRACE-A", quantity=100, weight=20).json()
    b = reallocate(client, warehouse, a, serial_no="TRACE-B", quantity=30, weight=6).json()
    c = reallocate(
        client, warehouse, b, serial_no="TRACE-C", quantity=10, weight=2, idempotency_key="to-c"
    ).json()
    result = client.get("/api/material-trace", params={"serial_no": "TRACE-C"})
    assert result.status_code == 200, result.text
    data = result.json()
    assert [row["id"] for row in data["items"]] == [a["id"], b["id"], c["id"]]
    assert [row["context_only"] for row in data["items"]] == [True, True, False]
    assert data["totals"]["on_hand"] == {"quantity": 10, "weight": 2}
    assert sum(row["weight"] for row in data["positions"]) == 2
    by_batch = client.get("/api/material-trace", params={"serial_no": b["batch_no"]}).json()
    assert by_batch["query_kind"] == "batch" and by_batch["focus_batch_id"] == b["id"]
    assert by_batch["totals"]["on_hand"] == {"quantity": 30, "weight": 6}
    assert by_batch["items"][0]["context_only"] is True


def test_plain_batch_lookup_and_leading_zero_serial_are_exact(client, warehouse):
    lot = intake(client, warehouse, serial_no="000001").json()
    data = client.get("/api/material-trace", params={"serial_no": lot["batch_no"]}).json()
    assert data["items"][0]["id"] == lot["id"]
    assert client.get("/api/material-trace?serial_no=1").json()["items"] == []
    assert len(client.get("/api/material-trace?serial_no=000001").json()["items"]) == 1
