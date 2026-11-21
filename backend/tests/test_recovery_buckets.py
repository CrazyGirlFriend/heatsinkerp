"""Weighed collections and physical split remainders share the normal stock ledger."""

import pytest
from test_processing_daily import setup_lot, work
from test_warehouse_classification import base, confirm, dispatch
from test_warehouse_receipts import warehouse as warehouse
from warehouse_test_locations import select_location


@pytest.mark.parametrize("kind", ["waste", "slag", "scrap_chips", "sludge"])
def test_pooled_recovery_is_one_weighed_document_without_source_lots(client, warehouse, kind):
    s = warehouse
    bucket = {
        "material_type": kind,
        "weight": "12.345",
        **select_location(client, s, headers=s["other_headers"]),
    }
    res = dispatch(client, s, [], workshop=True, recovery=bucket)
    assert res.status_code == 201, res.text
    order = res.json()
    assert len(order["items"]) == 1
    item = order["items"][0]
    assert (item["serial_no"], item["source_transfer_id"], item["quantity"], item["weight"]) == (
        "",
        None,
        0,
        12.345,
    )
    assert item["material_type"] == kind and item["status"] == "pending"
    assert dispatch(client, s, [], workshop=True, recovery=bucket).json() == order
    assert client.get(base(s, True) + "/inventory").json()["total"] == 0
    assert confirm(client, s, order).status_code == 200
    received = client.get(base(s) + "/inventory").json()["items"]
    assert len(received) == 1 and received[0]["on_hand_weight"] == 12.345
    assert received[0]["warehouse_location"] == bucket["warehouse_location"]
    # Weighed material already received is issued from its stock batch.
    forwarded = dispatch(
        client,
        s,
        [{"source_transfer_id": item["id"], "quantity": 0, "weight": "12.345"}],
        next_team_id=None,
        entry_kind="warehouse_outbound",
        external_destination="对外转料",
    )
    assert forwarded.status_code == 201, forwarded.text
    assert (
        client.get(base(s) + "/inventory", params={"availability": "current"}).json()["total"] == 0
    )


def test_warehouse_can_issue_its_own_bucket_and_invalid_buckets_do_not_post(client, warehouse):
    s = warehouse
    outbound = dict(
        next_team_id=None, entry_kind="warehouse_outbound", external_destination="对外转料"
    )
    bucket = dict(material_type="slag", weight="7.041")
    for invalid in (
        {**bucket, "weight": 0},
        {**bucket, "material_type": "finished"},
        {**bucket, "serial_no": "S-01"},
    ):
        assert dispatch(client, s, [], recovery=invalid, **outbound).status_code == 422
    assert (
        dispatch(
            client,
            s,
            [dict(source_transfer_id=123, quantity=1, weight=1)],
            recovery=bucket,
            **outbound,
        ).status_code
        == 422
    )
    assert dispatch(client, s, [], workshop=True, recovery=bucket).status_code == 422
    assert dispatch(client, s, [], recovery=bucket).status_code == 422
    result = dispatch(client, s, [], recovery=bucket, **outbound)
    assert result.status_code == 201, result.text
    item = result.json()["items"][0]
    assert (item["status"], item["weight"], item["source_transfer_id"]) == (
        "dispatched",
        7.041,
        None,
    )


@pytest.mark.usefixtures("legacy_stock")
@pytest.mark.parametrize("team", ["FACTORY-WIRE", "FACTORY-ENGRAVE", "FACTORY-ROLL"])
def test_remainder_choice_closes_stock_and_preserves_measured_difference(client, warehouse, team):
    s = warehouse
    lot, person = setup_lot(client, s, team, 1)
    url = base(s, True)
    produced = dict(
        role="produced",
        quantity=8,
        weight="79.995",
        material_type="semi_finished",
        transfer_specification="20 × 10 × 2 mm",
    )
    rest = dict(role="remaining", quantity=1, weight=20, material_type="semi_finished")

    def register(source, status, outputs, key):
        return work(
            client,
            s,
            source,
            person,
            quantity=sum(i["quantity"] for i in outputs),
            input_quantity=1,
            processing_status=status,
            outputs=outputs,
            idempotency_key=key,
        )

    for status, outputs in [
        (None, [produced]),
        ("partial", [produced]),
        ("complete", [rest, produced]),
        ("partial", [{**rest, "weight": 0}, produced]),
    ]:
        res = register(lot, status, outputs, "rejected")
        assert res.status_code == 422, res.text
    first = register(lot, "partial", [rest, produced], "cut-one")
    assert first.status_code == 201, first.text
    assert first.json()["processing_weight_difference"] == -0.005
    remaining = first.json()["outputs"][0]

    def available():
        response = client.get(url + "/inventory", params={"usable_remainders_only": "true"})
        assert response.status_code == 200, response.text
        return response.json()["items"]

    rows = available()
    assert len(rows) == 1 and (
        rows[0]["group_id"],
        rows[0]["on_hand_quantity"],
        rows[0]["on_hand_weight"],
    ) == (remaining["id"], 1, 20)
    second = register(remaining, "complete", [{**produced, "weight": "19.993"}], "cut-two")
    assert second.status_code == 201, second.text
    assert second.json()["processing_weight_difference"] == -0.007
    assert available() == []
    records = client.get(url + "/processing-records").json()["items"]
    assert sorted(r["processing_weight_difference"] for r in records) == [-0.007, -0.005]
    assert {
        r["group_id"]
        for r in client.get(
            url + "/inventory", params={"availability": "current_or_transit"}
        ).json()["items"]
    } == {first.json()["outputs"][1]["id"], second.json()["outputs"][0]["id"]}


@pytest.mark.usefixtures("legacy_stock")
def test_remainder_moves_between_teams_only_once_signed(client, warehouse):
    s = warehouse
    lot, employee = setup_lot(client, s, "FACTORY-ROLL", 1)
    out = [
        dict(role="remaining", quantity=1, weight=20, material_type="semi_finished"),
        dict(
            role="produced",
            quantity=8,
            weight="79.995",
            material_type="finished",
            transfer_specification="20 mm",
        ),
    ]
    saved = work(
        client,
        s,
        lot,
        employee,
        input_quantity=1,
        quantity=9,
        processing_status="partial",
        outputs=out,
    )
    assert saved.status_code == 201, saved.text
    remain = saved.json()["outputs"][0]
    sent = dispatch(
        client, s, [dict(source_transfer_id=remain["id"], quantity=1, weight=20)], workshop=True
    )
    assert sent.status_code == 201, sent.text
    params = {"usable_remainders_only": True, "availability": "current_or_transit"}
    assert client.get(base(s, True) + "/inventory", params=params).json()["items"] == []
    assert client.get(base(s) + "/inventory", params=params).json()["items"] == []
    signed = confirm(client, s, sent.json())
    assert signed.status_code == 200, signed.text
    received = client.get(base(s) + "/inventory", params=params).json()["items"]
    assert [r["group_id"] for r in received] == [sent.json()["items"][0]["id"]]
