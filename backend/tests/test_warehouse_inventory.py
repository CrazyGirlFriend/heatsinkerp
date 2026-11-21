"""Warehouse grouping must never blend source/nature/specification balances."""

import json
from datetime import datetime

import pytest
from app.database import SessionLocal
from app.models import MaterialTransfer
from test_warehouse_classification import base, confirm, dispatch
from test_warehouse_receipts import intake
from test_warehouse_receipts import warehouse as warehouse

pytestmark = pytest.mark.usefixtures("legacy_stock")


def inventory(client, setup, **params):
    response = client.get(base(setup) + "/inventory", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def sources(client, setup, group_id, **params):
    response = client.get(base(setup) + f"/inventory/{group_id}/sources", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_grouping_pagination_and_exact_source_drilldown(client, warehouse):
    s = warehouse
    common = dict(
        serial_no="000128",
        material_name="铜钼 CuMo70",
        material_type="raw_material",
        external_source="供应商 A",
        transfer_specification="100 × 80 × 5",
        quantity=10,
        weight=1,
    )
    first = intake(client, s, **common, idempotency_key="a").json()
    second = intake(client, s, **common, idempotency_key="b").json()
    other_source = intake(
        client, s, **{**common, "external_source": "供应商 B"}, idempotency_key="c"
    ).json()
    intake(client, s, **{**common, "material_type": "finished"}, idempotency_key="d")
    intake(client, s, **{**common, "transfer_specification": "40 × 30 × 2"}, idempotency_key="e")
    intake(
        client,
        s,
        **{**common, "material_type": "scrap_chips", "quantity": 0, "weight": 0.6},
        idempotency_key="f",
    )
    rows = inventory(client, s)
    assert rows["total"] == 6
    row = next(item for item in rows["items"] if item["group_id"] == first["id"])
    assert row["serial_no"] == "000128" and row["batch_count"] == 1
    assert row["batch_no"] == first["batch_no"]
    assert row["warehouse_location"] == first["warehouse_location"]
    assert row["on_hand_quantity"] == 10 and row["on_hand_weight"] == 1
    assert row["receipt_source"] == "external" and row["source_name"] == "供应商 A"
    assert {item["transfer"]["id"] for item in sources(client, s, first["id"])["items"]} == {
        first["id"],
    }
    assert sources(client, s, other_source["id"])["total"] == 1
    pages = [inventory(client, s, page=i, page_size=2) for i in (1, 2, 3)]
    assert [len(page["items"]) for page in pages] == [2, 2, 2]
    assert len({row["group_id"] for page in pages for row in page["items"]}) == 6
    assert sources(client, s, second["id"])["total"] == 1
    assert inventory(client, s, material_type="scrap_chips")["items"][0]["on_hand_weight"] == 0.6
    assert inventory(client, s, availability="available")["total"] == 5
    assert (
        inventory(client, s, search_field="on_hand_quantity", search_operator="gte", query="20")[
            "total"
        ]
        == 0
    )
    assert inventory(client, s, search_field="source", query="供应商 B")["total"] == 1
    assert inventory(client, s, query="000128")["total"] == 6

    def header(field, kind="text", **values):
        return inventory(
            client,
            s,
            table_query=json.dumps({"filters": [{"field": field, "kind": kind, **values}]}),
        )

    for size in ("100×80", "100*80", "100 X 80"):
        assert header("transfer_specification", value=size)["total"] == 5
    assert header("transfer_specification", value="%_")["total"] == 0
    assert header("stock_total_quantity", "number", end="9")["total"] == 0
    assert header("stock_total_quantity", "number", value="10", end="10")["total"] == 5
    assert header("stock_total_weight", "number", end="0.6")["total"] == 1
    assert (
        header("inventory_source_label", operator="in", values=["外部来料 · 供应商 B"])["total"]
        == 1
    )
    assert header("task_batch_number", "number", operator="in", values=[None])["total"] == 6


def test_serial_inventory_sums_lots_before_filter_and_pagination(client, warehouse):
    s = warehouse
    for index, (serial, pieces) in enumerate([("ORDER-A", 10), ("ORDER-B", 7), ("ORDER-A", 10)]):
        response = intake(
            client,
            s,
            serial_no=serial,
            quantity=pieces,
            weight=1,
            material_name=f"铜材{index}",
            idempotency_key=f"serial-stock-{index}",
        )
        assert response.status_code == 201, response.text

    url = base(s) + "/inventory-serials"

    def page(**params):
        response = client.get(url, params=params)
        assert response.status_code == 200, response.text
        return response.json()

    pages = [page(page_size=1, page=p) for p in (1, 2)]
    assert page(query="铜材2")["items"][0]["stock_total_quantity"] == 20
    assert [page["total"] for page in pages] == [2, 2]
    by_serial = {row["serial_no"]: row for page in pages for row in page["items"]}
    assert by_serial["ORDER-A"]["stock_total_quantity"] == 20
    assert by_serial["ORDER-A"]["stock_total_weight"] == 2
    assert by_serial["ORDER-A"]["stock_status"] == "在库"
    assert by_serial["ORDER-A"]["last_activity_at"] == max(
        row["last_activity_at"]
        for row in inventory(client, s)["items"]
        if row["serial_no"] == "ORDER-A"
    )
    assert client.get(base(s, True) + "/inventory-serials").json()["total"] == 0
    threshold = {"filters": [{"field": "stock_total_quantity", "kind": "number", "value": "15"}]}
    assert client.get(url, params={"table_query": json.dumps(threshold)}).json()["total"] == 1


def test_serial_dispatch_deducts_selected_sources_and_preserves_transit(client, warehouse):
    s = warehouse
    serial = "SERIAL-12"
    lots = [
        intake(client, s, serial_no=serial, quantity=10, weight=10, idempotency_key=key).json()
        for key in ("dispatch-from-A", "dispatch-from-B")
    ]
    lines = [
        {"source_transfer_id": lot["id"], "quantity": n, "weight": n}
        for lot, n in zip(lots, (10, 2), strict=True)
    ]
    response = dispatch(client, s, lines)
    assert response.status_code == 201, response.text
    document = response.json()

    def summary(workshop=False):
        return client.get(
            base(s, workshop) + "/inventory-serials",
            params={"serial_no": serial, "availability": "current_or_transit"},
        ).json()["items"]

    outgoing = summary()[0]
    assert (
        outgoing["on_hand_quantity"],
        outgoing["in_transit_quantity"],
        outgoing["stock_status"],
    ) == (8, 12, "部分在途")
    assert summary(True) == []
    current = client.get(
        base(s) + "/stock",
        params={"serial_no": serial, "exact_serial": True, "availability": "all"},
    ).json()["items"]
    assert {item["transfer"]["id"]: item["available_quantity"] for item in current} == {
        lots[0]["id"]: 0,
        lots[1]["id"]: 8,
    }
    replay = dispatch(client, s, lines)
    assert replay.status_code == 201, replay.text
    assert [item["id"] for item in replay.json()["items"]] == [
        item["id"] for item in document["items"]
    ]
    assert confirm(client, s, document, workshop=True).status_code == 200
    assert (summary()[0]["on_hand_quantity"], summary()[0]["in_transit_quantity"]) == (8, 0)
    assert summary(True)[0]["on_hand_quantity"] == 12

    # The latest action can concern a lot whose own balance is already zero.
    with SessionLocal.begin() as db:
        movement = db.get(MaterialTransfer, document["items"][0]["id"])
        movement.updated_at = datetime(2030, 4, 2, 12)
    assert summary()[0]["last_activity_at"] == "2030-04-02T12:00:00+00:00"


def test_activity_filter_uses_factory_day_of_dispatch_or_receipt(client, warehouse):
    s = warehouse
    first = intake(client, s, quantity=5, weight=1, idempotency_key="first").json()
    second = intake(client, s, quantity=5, weight=1, idempotency_key="second").json()
    sent = dispatch(client, s, [{"source_transfer_id": first["id"], "quantity": 5, "weight": 1}])
    assert sent.status_code == 201, sent.text
    with SessionLocal() as db:
        for lot, received in (
            (first, datetime(2026, 8, 31, 12)),
            (second, datetime(2026, 9, 1, 16)),
        ):
            source = db.get(MaterialTransfer, lot["id"])
            source.created_at = source.received_at = source.updated_at = received
        outbound = db.get(MaterialTransfer, sent.json()["items"][0]["id"])
        outbound.created_at = outbound.updated_at = datetime(2026, 9, 1, 15, 59)
        db.commit()

    for day, lot, expected in (
        ("2026-09-01", first, "2026-09-01T15:59:00+00:00"),
        ("2026-09-02", second, "2026-09-01T16:00:00+00:00"),
    ):
        condition = {"field": "last_activity_at", "kind": "date", "value": day, "end": day}
        result = inventory(
            client,
            s,
            availability="current_or_transit",
            table_query=json.dumps({"filters": [condition]}),
        )
        assert result["total"] == 1
        row = result["items"][0]
        assert (row["group_id"], row["last_activity_at"]) == (lot["id"], expected)


def test_internal_pending_not_stock_and_outbound_immediately_deducts(client, warehouse):
    s = warehouse
    origin = intake(
        client, s, serial_no="000129", external_source="供应商", quantity=100, weight=10
    ).json()
    sent = dispatch(
        client, s, [{"source_transfer_id": origin["id"], "quantity": 50, "weight": 5}]
    ).json()
    assert confirm(client, s, sent, workshop=True).status_code == 200
    returned = dispatch(
        client,
        s,
        [
            {
                "source_transfer_id": sent["items"][0]["id"],
                "quantity": 30,
                "weight": 3,
                "material_type": "finished",
            },
            {
                "source_transfer_id": sent["items"][0]["id"],
                "quantity": 20,
                "weight": 2,
                "material_type": "waste",
            },
        ],
        workshop=True,
        notes="废料回库",
    ).json()
    assert inventory(client, s, receipt_source="internal")["total"] == 0
    scope = {"availability": "current_or_transit"}
    sender_url = base(s, True) + "/inventory"
    sending = client.get(sender_url, params=scope).json()["items"]
    assert [
        (row["on_hand_quantity"], row["in_transit_quantity"], row["available_quantity"])
        for row in sending
    ] == [(0, 50, 0)]
    assert client.get(sender_url, params={"availability": "current"}).json()["total"] == 0
    assert inventory(client, s, receipt_source="internal", **scope)["total"] == 0
    pending = client.get(base(s) + "/overview").json()["pending_incoming"]
    assert pending["count"] == 2 and pending["batch_count"] == 2
    assert confirm(client, s, returned).status_code == 200
    assert client.get(sender_url, params=scope).json()["total"] == 0
    received = inventory(client, s, receipt_source="internal", **scope)["items"]
    assert sum(row["on_hand_quantity"] for row in received) == 50
    assert all(row["in_transit_quantity"] == 0 for row in received)
    rows = inventory(client, s, receipt_source="internal")["items"]
    assert len(rows) == 2 and sum(row["on_hand_quantity"] for row in rows) == 50
    assert all(row["source_name"] == "轧制" for row in rows)
    good = next(row for row in rows if row["material_type"] == "finished")
    assert sources(client, s, good["group_id"])["total"] == 1
    outgoing = dispatch(
        client,
        s,
        [{"source_transfer_id": good["group_id"], "quantity": 10, "weight": 1}],
        idempotency_key="external",
        next_team_id=None,
        entry_kind="warehouse_outbound",
        external_destination="对外转料",
    ).json()
    good = inventory(client, s, receipt_source="internal", material_type="finished")["items"][0]
    assert good["on_hand_quantity"] == 20 and good["reserved_quantity"] == 0
    assert confirm(client, s, outgoing, external=True).status_code == 200
    assert (
        inventory(client, s, receipt_source="internal", material_type="finished")["items"][0][
            "on_hand_quantity"
        ]
        == 20
    )
    totals = client.get(base(s) + "/overview").json()["totals"]
    assert (
        sum(row["on_hand_quantity"] for row in inventory(client, s)["items"])
        == totals["on_hand_quantity"]
    )
    assert inventory(client, s, receipt_source="external")["items"][0]["on_hand_quantity"] == 50
    assert (
        inventory(client, s, receipt_source="internal", source_team_id=s["other"]["id"])["total"]
        == 2
    )
    assert inventory(client, s, receipt_source="internal", source_team_id=99999)["total"] == 0


def test_dates_match_activity_without_truncating_deductions_and_history(client, warehouse):
    s = warehouse
    origin = intake(client, s, quantity=10, weight=1).json()
    with SessionLocal() as db:
        lot = db.get(MaterialTransfer, origin["id"])
        lot.received_at = lot.created_at = lot.updated_at = datetime(2026, 9, 1, 3)
        db.commit()
    sent = dispatch(
        client, s, [{"source_transfer_id": origin["id"], "quantity": 10, "weight": 1}]
    ).json()
    with SessionLocal() as db:
        move = db.get(MaterialTransfer, sent["items"][0]["id"])
        move.created_at = move.updated_at = datetime(2026, 9, 3, 3)
        db.commit()
    assert inventory(client, s)["total"] == 0
    row = inventory(client, s, availability="all", date_from="2026-09-01", date_to="2026-09-01")[
        "items"
    ][0]
    assert row["on_hand_quantity"] == 0 and row["on_hand_weight"] == 0
    assert sources(client, s, row["group_id"], current_only=True)["total"] == 0
    assert sources(client, s, row["group_id"])["total"] == 1
    assert (
        inventory(client, s, availability="all", date_from="2026-09-03", date_to="2026-09-03")[
            "total"
        ]
        == 1
    )
    assert (
        inventory(client, s, availability="all", date_from="2026-09-02", date_to="2026-09-02")[
            "total"
        ]
        == 0
    )
    assert (
        client.delete(
            "/api/material-transfers/" + sent["items"][0]["batch_no"], headers=s["headers"]
        ).status_code
        == 204
    )
    assert inventory(client, s)["items"][0]["on_hand_quantity"] == 10


def test_return_provenance_stays_separate_and_literal_search(client, warehouse):
    s = warehouse
    original = intake(client, s, external_source="A%_供料", receipt_kind="external").json()
    intake(client, s, external_source="A%_供料", receipt_kind="return", idempotency_key="return")
    assert inventory(client, s)["total"] == 2
    assert inventory(client, s, receipt_source="return")["items"][0]["receipt_source"] == "return"
    assert inventory(client, s, query="%_")["total"] == 2
    assert inventory(client, s, query="不存在")["total"] == 0
    assert sources(client, s, original["id"])["total"] == 1


def test_each_batch_retains_its_own_searchable_customer_metadata(client, warehouse):
    s = warehouse
    intake(client, s, customer_code="CUSTOMER-A", finished_quantity=10)
    intake(client, s, customer_code="CUSTOMER-B", finished_quantity=20, idempotency_key="other")
    for params in (
        {"query": "CUSTOMER-B"},
        {"query": "CUSTOMER-A", "search_field": "customer_code"},
        {"query": "20", "search_field": "finished_quantity"},
    ):
        result = inventory(client, s, **params)
        assert result["total"] == 1
        row = result["items"][0]
        assert row["customer_code"] in ("CUSTOMER-A", "CUSTOMER-B")
        assert row["customer_code_count"] == 1
        assert row["on_hand_quantity"] == 100
    assert inventory(client, s, query="21", search_field="finished_quantity")["total"] == 0


@pytest.mark.parametrize(
    "params",
    [
        {"search_field": "on_hand_quantity", "query": "1.2"},
        {"search_field": "on_hand_weight", "query": "NaN"},
        {"search_field": "on_hand_weight", "query": "1.2345678"},
        {"search_field": "source", "query": "A", "search_operator": "gte"},
        {"date_from": "2026-09-02", "date_to": "2026-09-01"},
        {"receipt_source": "forged"},
        {"page_size": 101},
    ],
)
def test_invalid_filters_rejected(client, warehouse, params):
    assert client.get(base(warehouse) + "/inventory", params=params).status_code == 422


def test_team_scope_and_unauthenticated_access(client, warehouse):
    s = warehouse
    origin = intake(client, s).json()
    assert client.get(base(s, True) + "/inventory").json()["total"] == 0
    assert client.get(base(s, True) + f"/inventory/{origin['id']}/sources").status_code == 404
    assert client.get(base(s) + "/inventory/99999/sources").status_code == 404
    client.headers.pop("Authorization")
    assert client.get(base(s) + "/inventory").status_code == 401
