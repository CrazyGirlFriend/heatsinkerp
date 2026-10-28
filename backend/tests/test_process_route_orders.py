from io import BytesIO
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile

import pytest
from app.process_route_orders import merge_materials, parse_order
from fastapi import HTTPException
from sender_helpers import sender_post
from test_engineering_team import engineering as engineering  # noqa: F401
from test_process_route_creation import manual
from test_process_route_import import HEADERS, docx
from test_warehouse_receipts import intake
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

URL = "/api/process-routes"
LABELS = [
    "流水号",
    "客户代码",
    "编号",
    "产品编码",
    "数量",
    "数量单位",
    "交货期",
    "材质细分",
    "用途分类",
    "订单分类",
    "图纸号",
    "销售人员",
    "订单分类",
]
VALUES = [
    "691236-50",
    "11600",
    "T4-03-72-MT",
    "K4",
    "18100",
    "件",
    "46203",
    "Mo70Cu30",
    "热沉",
    "产品订单",
    "NP000500010-A4",
    "王俊灵-陈玥艽",
    "产品订单",
]


def xlsx(values=None, *, formula=False, extra_rows=False, parts=None):
    rows = [LABELS, values or VALUES]
    if extra_rows:
        rows.append(VALUES)
    xml = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
    for row_index, row in enumerate(rows, 1):
        xml += f'<row r="{row_index}">'
        for index, value in enumerate(row):
            addr = f"{chr(65 + index)}{row_index}"
            xml += f'<c r="{addr}" t="inlineStr"><is><t>{escape(value)}</t></is>'
            if formula:
                xml += "<f>1+1</f>"
            xml += "</c>"
        xml += "</row>"
    xml += "</sheetData></worksheet>"
    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr(
            "xl/workbook.xml",
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
        )
        archive.writestr(
            "xl/_rels/workbook.xml.rels",
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
        )
        archive.writestr("xl/worksheets/sheet1.xml", xml)
        for name, value in (parts or {}).items():
            archive.writestr(name, value)
    return output.getvalue()


def test_single_order_maps_only_equivalent_fields_and_preserves_every_column():
    parsed = parse_order(xlsx(), "订单.xlsx")
    fields = parsed["receipt_fields"]
    assert fields["delivery_date"]["value"] == "2026-06-30"
    assert fields["delivery_quantity"]["value"] == 18100
    assert fields["product_code"]["value"] == "T4-03-72-MT"
    assert fields["customer_code"]["value"] == "11600"
    assert fields["order_category"]["value"] == "产品订单"
    assert parsed["headers"] == LABELS and parsed["values"] == VALUES
    assert parsed["display_values"][6] == "2026-06-30"
    assert (
        not {"quantity", "weight", "part_no", "category_level3", "finished_quantity"}
        & fields.keys()
    )


def test_word_wins_in_either_upload_order_and_mismatched_serial_is_rejected():
    order = parse_order(xlsx(), "订单.xlsx")
    word = {
        "receipt_fields": {
            key: {"value": value, "label": key, "source_row": "1:2", "source_label": key}
            for key, value in {
                "serial_no": "691236-50",
                "customer_code": "11600-T3",
                "delivery_date": "2026-11-05",
            }.items()
        }
    }
    first = merge_materials(merge_materials({}, word=word, filename="工艺.docx"), order=order)
    second = merge_materials(merge_materials({}, order=order), word=word, filename="工艺.docx")
    assert first["receipt_fields"] == second["receipt_fields"]
    assert first["receipt_fields"]["customer_code"]["value"] == "11600-T3"
    assert first["receipt_fields"]["customer_code"]["alternative"]["value"] == "11600"
    assert first["receipt_fields"]["delivery_date"]["value"] == "2026-11-05"
    assert first["receipt_fields"]["delivery_quantity"]["source_kind"] == "excel"
    with pytest.raises(HTTPException):
        merge_materials(first, order=parse_order(xlsx(["OTHER", *VALUES[1:]]), "其他.xlsx"))


@pytest.mark.parametrize(
    "content",
    [
        b"not xlsx",
        xlsx(formula=True),
        xlsx(extra_rows=True),
        xlsx(parts={"xl/vbaProject.bin": b"macro"}),
        xlsx(parts={"xl/externalLinks/link.xml": "<link/>"}),
        xlsx(parts={"bad.xml": '<!DOCTYPE a [<!ENTITY b "bad">]><a>&b;</a>'}),
        xlsx([*VALUES[:5], "kg", *VALUES[6:]]),
        xlsx([*VALUES[:-1], "不同订单分类"]),
    ],
)
def test_restricted_order_uploads_are_rejected(content):
    with pytest.raises(HTTPException) as error:
        parse_order(content, "订单.xlsx")
    assert error.value.status_code == 422


def test_order_attachments_confirmation_revision_and_reader_permissions(
    client, warehouse, engineering
):
    route = manual(client, warehouse, engineering)
    serial = route["serial_nos"][0]
    content = xlsx([serial, *VALUES[1:]])
    parsed = client.post(
        URL + "/parse-order", headers=engineering["headers"], files={"file": ("订单.xlsx", content)}
    )
    assert parsed.status_code == 200, parsed.text
    assert (
        client.post(
            URL + "/parse-order",
            headers=warehouse["headers"],
            files={"file": ("订单.xlsx", content)},
        ).status_code
        == 403
    )
    path = f"{URL}/{route['id']}/order"
    attached = client.post(
        path,
        headers=engineering["headers"],
        data={"version": route["version"]},
        files={"file": ("订单.xlsx", content)},
    )
    assert attached.status_code == 200, attached.text
    assert client.get(path, headers=warehouse["headers"]).status_code == 403
    assert (
        client.post(
            path, data={"version": route["version"]}, files={"file": ("订单.xlsx", content)}
        ).status_code
        == 409
    )
    route = attached.json()
    word = docx(
        [
            ["流水号", serial],
            ["客户代码", "11600-T3"],
            ["交货日期", "2026-11-05"],
            HEADERS,
            [0, "中转库", "备料", 0, 1],
        ]
    )
    attached = client.post(
        f"{URL}/{route['id']}/source",
        data={"version": route["version"]},
        files={"file": ("工艺.docx", word)},
    )
    assert attached.status_code == 200, attached.text
    route = attached.json()
    assert route["source_data"]["receipt_fields"]["customer_code"]["value"] == "11600-T3"
    publish = f"{URL}/{route['id']}/publish"
    assert client.post(publish, json={"version": route["version"]}).status_code == 422
    result = client.post(publish, json={"version": route["version"], "confirmed_imports": True})
    assert result.status_code == 200, result.text
    assert result.json()["source_data"]["material_confirmation"]["by"]
    assert client.get(path, headers=warehouse["headers"]).content == content
    confirmed = result.json()
    materials = {
        key: field["value"] for key, field in confirmed["source_data"]["receipt_fields"].items()
    }
    receipt = intake(
        client,
        warehouse,
        **materials,
        quantity=3,
        weight=2,
        process_route={
            key: confirmed[key]
            for key in ("id", "title", "version", "serial_nos", "steps", "review_note")
        },
    )
    assert receipt.status_code == 201, receipt.text
    lot = receipt.json()
    assert lot["quantity"] == 3 and lot["weight"] == 2
    assert lot["delivery_quantity"] == 18100 and lot["delivery_date"] == "2026-11-05"
    transferred = sender_post(
        client,
        warehouse["url"].replace("/receipts", "/dispatches"),
        headers=warehouse["headers"],
        json={
            "next_team_id": warehouse["other"]["id"],
            "idempotency_key": "confirmed-order-transfer",
            "lines": [{"source_transfer_id": lot["id"], "quantity": 2, "weight": 1}],
        },
    )
    assert transferred.status_code == 201, transferred.text
    child = transferred.json()["items"][0]
    for key in (
        "customer_code",
        "product_code",
        "purpose_category",
        "order_category",
        "material_name",
    ):
        assert child[key] == materials[key]
    revision = client.post(f"{URL}/{route['id']}/revise").json()
    assert client.get(f"{URL}/{revision['id']}/order").content == content
    payload = {
        key: revision[key] for key in ("title", "serial_nos", "steps", "review_note", "version")
    }
    payload["material_values"] = {"purpose_category": "新的用途"}
    payload["review_note"] = payload["review_note"] or ""
    rejected = client.put(
        f"{URL}/{revision['id']}", json={**payload, "serial_nos": ["OTHER-SERIAL"]}
    )
    assert rejected.status_code == 422
    changed = client.put(f"{URL}/{revision['id']}", json=payload)
    assert changed.status_code == 200, changed.text
    updated = changed.json()
    assert "material_confirmation" not in updated["source_data"]
    field = updated["source_data"]["receipt_fields"]["purpose_category"]
    assert field["value"] == "新的用途" and field["parsed_value"] == "热沉"
    assert (
        client.post(
            f"{URL}/{revision['id']}/publish", json={"version": updated["version"]}
        ).status_code
        == 422
    )
    assert (
        client.get(f"{URL}/{route['id']}").json()["source_data"]["receipt_fields"][
            "purpose_category"
        ]["value"]
        == "热沉"
    )
