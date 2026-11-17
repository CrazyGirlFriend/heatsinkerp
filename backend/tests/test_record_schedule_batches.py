"""History identifies the schedule actually used, including multiple tasks per serial."""

from uuid import uuid4

from test_processing_daily import work
from test_processing_route_methods import routed_lot
from test_processing_schedule_link import commitment
from test_table_queries import query
from test_warehouse_classification import base, dispatch
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401


def test_history_uses_bound_batch_for_display_filter_sort_and_unlinked_history(client, warehouse):
    s = warehouse
    lot, worker, route = routed_lot(client, s, second=False)
    # Old work and transfers can predate any schedule for the same serial.
    legacy = work(client, s, lot, worker, completed_quantity=2, completed_weight=20)
    assert legacy.status_code == 201, legacy.text
    legacy_output = next(row for row in legacy.json()["outputs"] if row["role"] == "produced")
    legacy_sent = dispatch(
        client,
        s,
        [{"source_transfer_id": legacy_output["id"], "quantity": 2, "weight": 20}],
        workshop=True,
        idempotency_key=uuid4().hex,
    )
    assert legacy_sent.status_code == 201, legacy_sent.text
    source = next(row for row in legacy.json()["outputs"] if row["role"] == "remaining")
    first = commitment(client, s, source, route, 3, index=1)
    second = commitment(client, s, source, route, 5, index=1)
    processing_ids, transfer_ids = {}, {}
    # Process the second schedule first: numbering follows task creation, not work order.
    for number, schedule, quantity in [(2, second, 5), (1, first, 3)]:
        response = work(
            client,
            s,
            source,
            worker,
            production_schedule_id=schedule["id"],
            completed_quantity=quantity,
            completed_weight=quantity * 10,
            idempotency_key=uuid4().hex,
        )
        assert response.status_code == 201, response.text
        record = response.json()
        processing_ids[number] = record["id"]
        output = next(row for row in record["outputs"] if row["role"] == "produced")
        sent = dispatch(
            client,
            s,
            [{"source_transfer_id": output["id"], "quantity": quantity, "weight": quantity * 10}],
            workshop=True,
            idempotency_key=uuid4().hex,
        )
        assert sent.status_code == 201, sent.text
        transfer_ids[number] = sent.json()["items"][0]["id"]
        if number == 2:
            source = next(row for row in record["outputs"] if row["role"] == "remaining")

    endpoints = [
        (base(s, True) + "/processing-records", processing_ids),
        (base(s, True) + "/outbound-batches", transfer_ids),
        ("/api/material-transfers", transfer_ids),
    ]
    for url, ids in endpoints:
        response = client.get(url)
        assert response.status_code == 200, response.text
        rows = {row["id"]: row for row in response.json()["items"]}
        assert rows[ids[1]]["task_batch_number"] == 1
        assert rows[ids[2]]["task_batch_number"] == 2
        assert rows[ids[1]]["serial_no"] == rows[ids[2]]["serial_no"]
        assert rows[ids[1]]["batch_no"].startswith("TL")
        params = {"table_query": query("task_batch_number", "1", "1", "number"), "page_size": 1}
        filtered = client.get(url, params=params)
        assert filtered.status_code == 200, filtered.text
        assert filtered.json()["total"] == 1
        assert filtered.json()["items"][0]["id"] == ids[1]
        for direction, number in [("desc", 2), ("asc", 1)]:
            sorted_page = client.get(
                url,
                params={
                    "page_size": 1,
                    "table_query": query(
                        "task_batch_number",
                        "1",
                        "2",
                        "number",
                        {
                            "field": "task_batch_number",
                            "direction": direction,
                        },
                    ),
                },
            )
            assert sorted_page.status_code == 200, sorted_page.text
            assert sorted_page.json()["total"] == 2
            assert sorted_page.json()["items"][0]["id"] == ids[number]

    for url, ids in endpoints:
        response = client.get(url)
        assert response.status_code == 200, response.text
        rows = {row["id"]: row for row in response.json()["items"]}
        legacy_id = (
            legacy.json()["id"] if ids is processing_ids else legacy_sent.json()["items"][0]["id"]
        )
        assert rows[legacy_id]["task_batch_number"] is None
        assert rows[ids[2]]["task_batch_number"] == 2
