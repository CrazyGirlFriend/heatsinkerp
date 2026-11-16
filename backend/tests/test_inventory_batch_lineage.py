"""Stock queries retain physical batch identity across grouping and serial changes."""

import json

import pytest
from app.database import SessionLocal
from test_global_inventory import add_lot, stock
from test_material_stock import stock_setup as stock_setup  # noqa: F401
from test_quantity_adjustments import change
from test_serial_reallocations import reallocate
from test_shared_material import shared_intake
from test_warehouse_classification import base, confirm, dispatch
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

pytestmark = pytest.mark.usefixtures("legacy_stock")


def test_grouped_batches_are_complete_and_searchable_without_changing_balances(client, stock_setup):
    team = stock_setup["target"]
    with SessionLocal.begin() as db:
        numbers = sorted(
            add_lot(db, team, "GROUPED", days=n, quantity=1).batch_no for n in range(60)
        )
        add_lot(db, stock_setup["third"], "GROUPED", quantity=2)
    assert len("、".join(numbers)) > 1024
    for url in ("/api/serial-inventory/stock", f"/api/team-materials/{team['id']}/inventory"):
        response = client.get(url, params={"query": numbers[-1], "page_size": 1})
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["total"] == 1
        row = result["items"][0]
        assert row["batch_nos"] == numbers
        assert row["batch_no"] == numbers[0]
        assert row["previous_batch_nos"] == []
        assert row["previous_batch_no"] is None
        assert row["on_hand_quantity"] == row["batch_count"] == 60
        assert "warehouse_batch_no" not in row
        for params in (
            {"search_field": "batch_no", "query": numbers[-1]},
            {"table_query": json.dumps({"filters": [{"field": "batch_no", "value": numbers[-1]}]})},
        ):
            filtered = client.get(url, params={**params, "page_size": 1}).json()
            assert filtered["total"] == 1
            assert filtered["items"][0]["batch_nos"] == numbers
            assert filtered["items"][0]["on_hand_quantity"] == 60
        options = client.get(
            url,
            params={
                "page_size": 1,
                "table_query": json.dumps(
                    {
                        "options": {"field": "batch_no"},
                        "filters": [{"field": "serial_no", "value": "GROUPED"}],
                    }
                ),
            },
        ).json()
        assert set(numbers).issubset(options["values"])
        excluded = client.get(
            url,
            params={
                "table_query": json.dumps(
                    {
                        "filters": [
                            {"field": "batch_no", "operator": "not_in", "values": [numbers[-1]]}
                        ]
                    }
                )
            },
        ).json()
        assert not any(
            row["group_id"] == result["items"][0]["group_id"] for row in excluded["items"]
        )
        detail = client.get(
            f"/api/team-materials/{team['id']}/inventory/{row['group_id']}/sources",
            params={"page_size": 100},
        )
        assert detail.status_code == 200, detail.text
        assert {item["transfer"]["batch_no"] for item in detail.json()["items"]} == set(numbers)
    assert stock(client, query="%", team_id=team["id"])["total"] == 0


def test_original_batch_finds_multiple_serials_after_processing_transfer_and_reallocation(
    client, warehouse
):
    s = warehouse
    assert (
        client.patch(f"/api/teams/{s['other']['id']}", json={"code": "FACTORY-WIRE"}).status_code
        == 200
    )
    origin = shared_intake(client, s).json()
    sent = dispatch(client, s, [{"source_transfer_id": origin["id"], "quantity": 1, "weight": 100}])
    assert sent.status_code == 201, sent.text
    assert confirm(client, s, sent.json(), workshop=True).status_code == 200
    incoming = sent.json()["items"][0]
    processed = change(
        client,
        s,
        incoming,
        50,
        workshop=True,
        processing_status="complete",
        outputs=[
            {
                "role": "produced",
                "serial_no": "ORDER-A",
                "quantity": 30,
                "weight": 60,
                "material_type": "semi_finished",
                "transfer_specification": "25 × 12 × 2 mm",
            },
            {
                "role": "produced",
                "serial_no": "ORDER-B",
                "quantity": 20,
                "weight": 40,
                "material_type": "semi_finished",
                "transfer_specification": "12 × 12 × 2 mm",
            },
        ],
    )
    assert processed.status_code == 201, processed.text
    a, b = processed.json()["outputs"]
    reassigned = reallocate(
        client,
        {"team": s["other"], "headers": s["other_headers"]},
        b,
        serial_no="ORDER-C",
        quantity=10,
        weight=20,
    )
    assert reassigned.status_code == 201, reassigned.text
    c = reassigned.json()
    moved = dispatch(
        client, s, [{"source_transfer_id": a["id"], "quantity": 30, "weight": 60}], workshop=True
    )
    assert moved.status_code == 201, moved.text
    assert confirm(client, s, moved.json()).status_code == 200
    received_a = moved.json()["items"][0]
    for query in (origin["batch_no"], incoming["batch_no"]):
        result = stock(client, query=query, availability="current")
        rows = {row["serial_no"]: row for row in result["items"]}
        assert set(rows) == {"ORDER-A", "ORDER-B", "ORDER-C"}
        assert sum(row["on_hand_quantity"] for row in rows.values()) == 50
        assert sum(row["on_hand_weight"] for row in rows.values()) == 100
        for serial, current, previous in (
            ("ORDER-A", received_a, a),
            ("ORDER-B", b, incoming),
            ("ORDER-C", c, b),
        ):
            assert rows[serial]["batch_nos"] == [current["batch_no"]]
            assert rows[serial]["previous_batch_nos"] == [previous["batch_no"]]
        page = stock(client, query=query, availability="current", page_size=1, page=2)
        assert page["total"] == 3 and len(page["items"]) == 1
    assert {
        row["serial_no"]
        for row in stock(client, query=b["batch_no"], availability="current")["items"]
    } == {"ORDER-B", "ORDER-C"}
    for params in (
        {"search_field": "previous_batch_no", "query": b["batch_no"]},
        {
            "table_query": json.dumps(
                {"filters": [{"field": "previous_batch_no", "value": b["batch_no"]}]}
            )
        },
    ):
        result = stock(client, **params, availability="current")
        assert result["total"] == 1 and result["items"][0]["serial_no"] == "ORDER-C"
    scoped = client.get(base(s, True) + "/inventory", params={"query": origin["batch_no"]})
    assert scoped.status_code == 200, scoped.text
    assert {row["serial_no"] for row in scoped.json()["items"]} == {"ORDER-B", "ORDER-C"}
    assert stock(client, query="MISSING-BATCH")["total"] == 0
