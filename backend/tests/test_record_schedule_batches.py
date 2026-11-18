"""History identifies the schedule actually used, including multiple tasks per serial."""

import json
from uuid import uuid4

from test_processing_daily import work
from test_processing_route_methods import routed_lot
from test_processing_schedule_link import commitment
from test_table_queries import query
from test_warehouse_classification import base, confirm, dispatch
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


def test_stock_and_pickers_separate_same_serial_by_bound_schedule(client, warehouse):
    s = warehouse
    lot, worker, route = routed_lot(client, s)
    first = commitment(client, s, lot, route, 3)
    second = commitment(client, s, lot, route, 3)
    source = lot
    outputs = {}
    for number, schedule in [(2, second), (1, first)]:
        response = work(
            client,
            s,
            source,
            worker,
            production_schedule_id=schedule["id"],
            completed_quantity=3,
            completed_weight=30,
            idempotency_key=uuid4().hex,
        )
        assert response.status_code == 201, response.text
        outputs[number] = next(
            row for row in response.json()["outputs"] if row["role"] == "produced"
        )
        source = next(row for row in response.json()["outputs"] if row["role"] == "remaining")

    url = base(s, True)
    expected = {outputs[1]["id"]: 1, outputs[2]["id"]: 2, source["id"]: None}
    for endpoint in ("/stock", "/processing-stock"):
        response = client.get(url + endpoint)
        assert response.status_code == 200, response.text
        rows = {
            row["transfer"]["id"]: row["transfer"]["task_batch_number"]
            for row in response.json()["items"]
        }
        assert rows == expected

    response = client.get(url + "/inventory")
    assert response.status_code == 200, response.text
    groups = response.json()["items"]
    assert len(groups) == 3
    assert {row["task_batch_number"]: row["on_hand_quantity"] for row in groups} == {
        1: 3,
        2: 3,
        None: 4,
    }
    for group in groups:
        group_id = group["group_id"]
        for endpoint, params in [
            (f"/inventory/{group_id}/sources", {"current_only": True}),
            ("/processing-stock", {"group_id": group_id}),
        ]:
            selected = client.get(url + endpoint, params=params)
            assert selected.status_code == 200, selected.text
            assert {row["transfer"]["task_batch_number"] for row in selected.json()["items"]} == {
                group["task_batch_number"]
            }
    for endpoint in ("/inventory", "/stock"):
        filtered = client.get(
            url + endpoint,
            params={"table_query": query("task_batch_number", "2", "2", "number"), "page_size": 1},
        )
        assert filtered.status_code == 200, filtered.text
        assert filtered.json()["total"] == 1
        row = filtered.json()["items"][0]
        assert row.get("transfer", row)["task_batch_number"] == 2
    for endpoint in (url + "/inventory", "/api/serial-inventory/stock"):
        scope = {"serial_no": lot["serial_no"], "page_size": 1}
        options = client.get(
            endpoint,
            params={
                **scope,
                "table_query": json.dumps({"options": {"field": "task_batch_number"}}),
            },
        )
        assert options.status_code == 200, options.text
        assert {"1", "2", None}.issubset(options.json()["values"])
        filtered = client.get(
            endpoint,
            params={
                **scope,
                "search_field": "task_batch_number",
                "query": "2",
                "table_query": json.dumps(
                    {
                        "filters": [
                            {
                                "field": "batch_no",
                                "operator": "in",
                                "values": [outputs[2]["batch_no"]],
                            }
                        ]
                    }
                ),
            },
        )
        assert filtered.status_code == 200, filtered.text
        assert filtered.json()["total"] == 1
        assert filtered.json()["items"][0]["group_id"] == outputs[2]["id"]
        sorted_rows = client.get(
            endpoint,
            params={
                **scope,
                "search_field": "task_batch_number",
                "search_operator": "gte",
                "query": "1",
                "table_query": json.dumps(
                    {"sort": {"field": "task_batch_number", "direction": "desc"}}
                ),
            },
        )
        assert sorted_rows.status_code == 200, sorted_rows.text
        assert sorted_rows.json()["total"] == 2
        assert sorted_rows.json()["items"][0]["group_id"] == outputs[2]["id"]

    # The next team's receipt has a delivery binding rather than a processing ID.
    finished = work(
        client,
        s,
        outputs[2],
        worker,
        completed_quantity=1,
        completed_weight=10,
        idempotency_key=uuid4().hex,
    )
    assert finished.status_code == 201, finished.text
    output = next(row for row in finished.json()["outputs"] if row["role"] == "produced")
    remaining = next(row for row in finished.json()["outputs"] if row["role"] == "remaining")
    stock = client.get(url + "/stock")
    assert stock.status_code == 200, stock.text
    inherited = next(
        row for row in stock.json()["items"] if row["transfer"]["id"] == remaining["id"]
    )
    assert inherited["transfer"]["task_batch_number"] == 2
    sent = dispatch(
        client,
        s,
        [{"source_transfer_id": output["id"], "quantity": 1, "weight": 10}],
        workshop=True,
        idempotency_key=uuid4().hex,
    )
    assert sent.status_code == 201, sent.text
    received = confirm(client, s, sent.json())
    assert received.status_code == 200, received.text
    received_id = sent.json()["items"][0]["id"]
    for endpoint in ("/inventory", "/stock"):
        result = client.get(base(s) + endpoint)
        assert result.status_code == 200, result.text
        row = next(
            row
            for row in result.json()["items"]
            if row.get("group_id", row.get("transfer", {}).get("id")) == received_id
        )
        assert row.get("transfer", row)["task_batch_number"] == 2
