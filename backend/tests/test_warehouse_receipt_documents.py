"""Warehouse originals stay private until a confirmed, atomic stock receipt."""

from unittest.mock import Mock

import pytest
from app import warehouse_receipt_documents
from app.database import SessionLocal
from app.models import (
    MaterialTransfer,
    ProcessRoute,
    ProcessRouteOrderFile,
    WarehouseReceiptDocument,
)
from sender_helpers import sender_post
from sqlalchemy import func, select
from test_material_transfers import _leader
from test_order_document_preview import pdf
from test_process_route_import import PROCESS, docx
from test_process_route_intake import publish_payload, route_payload
from test_process_route_orders import VALUES, xlsx
from test_process_routes import published
from test_warehouse_receipts import intake
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401


def order_bytes(serial="WAREHOUSE-001"):
    return xlsx([serial, *VALUES[1:]])


def upload(client, warehouse, kind="order", content=None, filename=None, headers=None):
    content = content if content is not None else order_bytes()
    filename = (
        filename or {"order": "订单.xlsx", "drawing": "图纸.pdf", "process": "工艺.docx"}[kind]
    )
    return client.post(
        f"/api/teams/{warehouse['team']['id']}/receipt-documents",
        headers=headers or warehouse["headers"],
        data={"kind": kind},
        files={"file": (filename, content)},
    )


def test_upload_parses_sources_keeps_originals_and_retries_once(client, warehouse):
    original = order_bytes()
    response = upload(client, warehouse, content=original)
    assert response.status_code == 201, response.text
    item = response.json()
    assert item["kind"] == "order" and item["transfer_id"] is None
    assert item["parsed"]["serial_no"] == "WAREHOUSE-001"
    assert item["parsed"]["receipt_fields"]["material_name"]["source_kind"] == "excel"
    assert upload(client, warehouse, content=original).json() == item
    file_url = f"/api/receipt-documents/{item['id']}/file"
    response = client.get(file_url, headers=warehouse["headers"])
    assert response.content == original
    assert "attachment" in response.headers["content-disposition"]
    assert client.get(file_url, headers=warehouse["other_headers"]).status_code == 404
    assert client.get(f"/api/receipt-documents/{item['id']}").status_code == 404
    assert (
        client.get(f"/api/receipt-documents/{item['id']}", headers=warehouse["headers"]).json()
        == item
    )
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(WarehouseReceiptDocument)) == 1
        assert db.scalar(select(func.count()).select_from(ProcessRoute)) == 0


@pytest.mark.parametrize(
    ("kind", "filename", "content"),
    [
        ("order", "订单.xlsm", b"bad"),
        ("order", "订单.xlsx", xlsx(formula=True)),
        ("process", "工艺.docx", b"not a Word file"),
        ("drawing", "图纸.pdf", pdf(password=True)),
    ],
)
def test_invalid_uploads_never_create_documents(client, warehouse, kind, filename, content):
    assert upload(client, warehouse, kind, content, filename).status_code == 422
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(WarehouseReceiptDocument)) == 0


def test_only_current_warehouse_leader_can_upload(client, warehouse):
    assert upload(client, warehouse, headers=warehouse["other_headers"]).status_code == 403
    response = client.post(
        f"/api/teams/{warehouse['team']['id']}/receipt-documents",
        data={"kind": "order"},
        files={"file": ("订单.xlsx", order_bytes())},
    )
    assert response.status_code == 403


def test_confirmation_is_required_and_attachment_binding_is_atomic_idempotent(client, warehouse):
    original = order_bytes()
    item = upload(client, warehouse, content=original).json()
    values = {"document_ids": [item["id"]]}
    refused = intake(client, warehouse, **values)
    assert refused.status_code == 422 and "确认后入库" in refused.text
    values["confirmed_imports"] = True
    # Even a confirmed upload stays unbound if stock validation fails.
    assert intake(client, warehouse, quantity=0, weight="0", **values).status_code == 422
    with SessionLocal() as db:
        assert db.get(WarehouseReceiptDocument, item["id"]).transfer_id is None
        assert db.scalar(select(func.count()).select_from(MaterialTransfer)) == 0
    response = intake(client, warehouse, **values)
    assert response.status_code == 201, response.text
    receipt = response.json()
    assert intake(client, warehouse, **values).json() == receipt
    listed = client.get(f"/api/material-transfers/{receipt['batch_no']}/receipt-documents").json()[
        "items"
    ]
    assert len(listed) == 1 and listed[0]["transfer_id"] == receipt["id"]
    assert listed[0]["confirmed_at"]
    assert (
        client.get(
            f"/api/receipt-documents/{item['id']}/file", headers=warehouse["other_headers"]
        ).content
        == original
    )
    reused = intake(client, warehouse, idempotency_key="new-intake", **values)
    assert reused.status_code == 409
    assert upload(client, warehouse).json()["id"] != item["id"]
    assert (
        client.delete(
            f"/api/receipt-documents/{item['id']}", headers=warehouse["headers"]
        ).status_code
        == 409
    )


def test_documents_cannot_be_claimed_by_another_warehouse_user(client, warehouse):
    item = upload(client, warehouse).json()
    _, headers = _leader(client, "warehouse-second", warehouse["team"]["id"])
    other = {**warehouse, "headers": headers}
    response = intake(client, other, document_ids=[item["id"]], confirmed_imports=True)
    assert response.status_code == 422
    assert client.get(f"/api/receipt-documents/{item['id']}", headers=headers).status_code == 404
    assert client.delete(f"/api/receipt-documents/{item['id']}", headers=headers).status_code == 404


def test_order_serial_validation_and_anonymous_receipts(client, warehouse):
    item = upload(client, warehouse, content=order_bytes("OTHER-SERIAL")).json()
    response = intake(client, warehouse, document_ids=[item["id"]], confirmed_imports=True)
    assert response.status_code == 422 and "流水号" in response.text
    anonymous = intake(
        client, warehouse, serial_no="", document_ids=[item["id"]], confirmed_imports=True
    )
    assert anonymous.status_code == 201, anonymous.text
    assert anonymous.json()["serial_no"] == ""


def test_receipt_route_needs_confirmation_but_supplements_do_not_change_it(client, warehouse):
    route = publish_payload(client, route_payload(client, warehouse))
    original = docx([["流水号", "DIFFERENT-PROCESS-NUMBER"], ["材质", "铜钼"], *PROCESS])
    process = upload(client, warehouse, "process", original).json()
    assert process["parsed"]["receipt_fields"]["material_name"]["source_kind"] == "word"
    assert process["parsed"]["serial_nos"] == ["DIFFERENT-PROCESS-NUMBER"]
    response = intake(client, warehouse, process_route=route, confirmed_imports=False)
    assert response.status_code == 422 and "确认后入库" in response.text
    response = intake(
        client, warehouse, process_route=route, document_ids=[process["id"]], confirmed_imports=True
    )
    assert response.status_code == 201, response.text
    with SessionLocal() as db:
        published = db.get(ProcessRoute, route["id"])
        assert published.source_file == b"original document bytes"
        assert published.version == route["version"] and published.state == "published"
        assert db.get(WarehouseReceiptDocument, process["id"]).content == original


def test_original_previews_use_stored_bytes_and_cleanup_only_drafts(client, warehouse, monkeypatch):
    original = order_bytes()
    item = upload(client, warehouse, content=original).json()
    preview = Mock(return_value=pdf())
    monkeypatch.setattr(warehouse_receipt_documents, "order_document_preview", preview)
    response = client.get(
        f"/api/receipt-documents/{item['id']}/file?preview=true", headers=warehouse["headers"]
    )
    assert response.status_code == 200 and response.headers["content-type"] == "application/pdf"
    preview.assert_called_once_with(original, "订单.xlsx")
    assert (
        client.delete(
            f"/api/receipt-documents/{item['id']}", headers=warehouse["headers"]
        ).status_code
        == 204
    )
    assert (
        client.get(f"/api/receipt-documents/{item['id']}", headers=warehouse["headers"]).status_code
        == 404
    )


def test_supplemental_originals_follow_transferred_lot(client, warehouse, legacy_stock):
    drawing = upload(client, warehouse, "drawing", pdf()).json()
    order = upload(client, warehouse).json()
    receipt = intake(
        client, warehouse, document_ids=[drawing["id"], order["id"]], confirmed_imports=True
    ).json()
    response = sender_post(
        client,
        warehouse["url"].replace("/receipts", "/dispatches"),
        headers=warehouse["headers"],
        json={
            "next_team_id": warehouse["other"]["id"],
            "idempotency_key": "forward-with-original",
            "lines": [{"source_transfer_id": receipt["id"], "quantity": 20, "weight": "2"}],
        },
    )
    assert response.status_code == 201, response.text
    forwarded = response.json()["items"][0]
    listed = client.get(
        f"/api/material-transfers/{forwarded['batch_no']}/receipt-documents"
    ).json()["items"]
    assert [item["id"] for item in listed] == [drawing["id"], order["id"]]
    with SessionLocal.begin() as db:
        db.get(MaterialTransfer, forwarded["id"]).serial_no = "ANOTHER-ORDER"
    listed = client.get(
        f"/api/material-transfers/{forwarded['batch_no']}/receipt-documents"
    ).json()["items"]
    assert [item["id"] for item in listed] == [drawing["id"]]


def test_attachment_counts_and_duplicate_selection_are_rejected(client, warehouse):
    first = upload(client, warehouse, content=order_bytes()).json()
    second = upload(client, warehouse, content=order_bytes("ORDER-B")).json()
    for ids in ([first["id"], first["id"]], [first["id"], second["id"]], [99999], [-1]):
        assert (
            intake(client, warehouse, document_ids=ids, confirmed_imports=True).status_code == 422
        )
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(MaterialTransfer)) == 0
        assert db.get(WarehouseReceiptDocument, first["id"]).transfer_id is None


@pytest.mark.parametrize("serial", ["WAREHOUSE-001", "OTHER-ORDER"])
def test_outbound_uses_confirmed_matching_receipt_order_without_changing_route(
    client, warehouse, serial
):
    route = published(client, warehouse)
    with SessionLocal.begin() as db:
        db.delete(db.get(ProcessRouteOrderFile, route["id"]))
        row = db.get(ProcessRoute, route["id"])
        row.source_data = {
            key: value for key, value in row.source_data.items() if key != "order_document"
        }
    order = upload(client, warehouse, content=order_bytes(serial)).json()
    receipt = intake(
        client, warehouse, serial_no="", document_ids=[order["id"]], confirmed_imports=True
    ).json()
    response = sender_post(
        client,
        warehouse["url"].replace("/receipts", "/dispatches"),
        headers=warehouse["headers"],
        json={
            "next_team_id": warehouse["other"]["id"],
            "idempotency_key": "outbound-with-receipt-order",
            "lines": [
                {
                    "source_transfer_id": receipt["id"],
                    "serial_no": "WAREHOUSE-001",
                    "quantity": 10,
                    "weight": "1",
                }
            ],
        },
    )
    if serial == "WAREHOUSE-001":
        assert response.status_code == 201, response.text
        assert response.json()["items"][0]["process_route"]["id"] == route["id"]
    else:
        assert response.status_code == 422 and "订单表" in response.text
