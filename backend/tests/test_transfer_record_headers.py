import json

from test_shared_dispatch import joint as joint
from test_shared_dispatch import send
from test_warehouse_classification import base, confirm
from test_warehouse_receipts import warehouse as warehouse


def test_shared_record_headers_follow_the_lot_through_dispatch_and_receipt(
    client, warehouse, joint
):
    sent = send(client, warehouse, joint)
    assert sent.status_code == 201, sent.text
    document = sent.json()
    lot = document["items"][0]
    serials = [item["serial_no"] for item in lot["shared_serials"]]
    source = warehouse["team"]
    target = warehouse["other"]

    def get(url, scope, **query):
        result = client.get(url, params={**scope, "table_query": json.dumps(query)})
        assert result.status_code == 200, result.text
        return result.json()

    def verify(url, scope, fields):
        for serial in serials:
            response = client.get(url, params={**scope, "query": serial})
            assert [row["id"] for row in response.json()["items"]] == [lot["id"]]
            for operator in ("contains", "eq", "in", "not_contains", "ne", "not_in"):
                condition = {
                    "field": "serial_no",
                    "operator": operator,
                    "values": [serial] if operator.endswith("in") else [],
                    "value": serial,
                }
                result = get(url, scope, filters=[condition])
                assert result["total"] == (operator in ("contains", "eq", "in"))
        assert set(get(url, scope, options={"field": "serial_no"})["values"]) == set(serials)
        assert get(url, scope, options={"field": "serial_no", "search": serials[1]})["values"] == [
            serials[1]
        ]
        both = {"field": "serial_no", "operator": "in", "values": serials}
        assert (
            get(url, scope, filters=[both], sort={"field": "serial_no", "direction": "asc"})[
                "total"
            ]
            == 1
        )
        for field, displayed in fields.items():
            selected = {"field": field, "operator": "in", "values": [displayed]}
            assert get(url, scope, filters=[selected])["total"] == 1, field
            assert displayed in get(url, scope, options={"field": field})["values"], field
        absent = {"field": "batch_no", "value": "no such batch"}
        assert get(url, scope, filters=[absent], options={"field": "serial_no"})["values"] == []

    common = {"batch_no": lot["batch_no"], "record_sender": lot["sent_employee_name"]}
    verify(
        "/api/material-transfers",
        {"team_id": target["id"], "direction": "incoming", "status": "pending"},
        {**common, "source_team_name": source["name"]},
    )
    outgoing = base(warehouse) + "/outbound-batches"
    verify(
        outgoing,
        {},
        {
            **common,
            "record_destination": target["name"],
            "record_status": "转出待签收",
            "record_entry_kind": "内部转料",
        },
    )
    assert client.get(outgoing, params={"query": target["name"]}).json()["total"] == 1
    signed = confirm(client, warehouse, document, workshop=True)
    assert signed.status_code == 200
    receipts = base(warehouse, True) + "/receipts"
    verify(
        receipts,
        {},
        {
            "batch_no": lot["batch_no"],
            "record_receiver": signed.json()["received_employee_name"],
            "record_source": source["name"],
            "record_source_kind": "车间转入",
            "record_status": "已接收",
        },
    )
    intake = joint[0]
    verify_intake = get(
        warehouse["url"],
        {},
        filters=[
            {"field": "record_receiver", "value": intake["received_by"]},
            {"field": "record_location", "value": intake["warehouse_location"]},
            {"field": "record_material_type", "value": "半成品"},
            {"field": "record_source_kind", "value": "外部入库"},
            {"field": "record_status", "value": "已入库"},
        ],
    )
    assert [item["id"] for item in verify_intake["items"]] == [intake["id"]]
