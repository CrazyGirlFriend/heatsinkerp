"""Weight-only material operations cannot create fictitious piece stock."""
from decimal import Decimal

import pytest

from app.database import SessionLocal
from app.models import MaterialStockBalance, MaterialTransfer
from test_quantity_adjustments import base, change, dispatch, confirm
from test_serial_reallocations import reallocate
from test_warehouse_receipts import intake, warehouse  # noqa: F401


def measurement(kind, weight=3):
    return {"sludge_gross_weight": weight * 2, "sludge_content_percent": 50} if kind == "sludge" else {}


@pytest.mark.parametrize("kind", ["sludge", "scrap_chips"])
def test_receipt_opening_and_external_exit_require_weight_without_pieces(client, warehouse, kind):
    s = warehouse
    values = dict(material_type=kind, quantity=0, weight=3, **measurement(kind))
    assert intake(client, s, **{**values, "quantity": 1}).status_code == 422
    assert intake(client, s, **{**values, "weight": 0}).status_code == 422
    received = intake(client, s, **values)
    assert received.status_code == 201, received.text
    lot = received.json()
    opening_url = base(s) + "/opening-stock"
    assert client.put(opening_url + "/authorization", json={"enabled": True}).status_code == 200
    line = dict(serial_no="WEIGHT-ONLY", material_name="材料1", **values)
    body = {"idempotency_key": "opening-weight-only", "lines": [dict(line, quantity=4)]}
    assert client.post(opening_url, headers=s["headers"], json=body).status_code == 422
    body["lines"] = [line]
    opened = client.post(opening_url, headers=s["headers"], json=body)
    assert opened.status_code == 201, opened.text
    assert opened.json()["items"][0]["quantity"] == 0
    external = dict(entry_kind="warehouse_outbound", next_team_id=None, external_destination="回收单位")
    portion = dict(source_transfer_id=lot["id"], quantity=1, weight=1, **measurement(kind, 1))
    assert dispatch(client, s, [portion], **external).status_code == 422
    portion["quantity"] = 0
    result = dispatch(client, s, [portion], **external)
    assert result.status_code == 201, result.text
    assert result.json()["items"][0]["quantity"] == 0
    assert dispatch(client, s, [portion], **external).json() == result.json()
    with SessionLocal() as db:
        balance = db.get(MaterialStockBalance, lot["id"])
        assert balance.on_hand_quantity == 0 and balance.on_hand_weight == Decimal(2)


@pytest.mark.parametrize("kind", ["sludge", "scrap_chips"])
def test_reallocation_and_loss_cannot_add_pieces_to_weight_only_stock(client, warehouse, kind):
    s = warehouse
    lot = intake(client, s, material_type=kind, quantity=0, weight=3, **measurement(kind)).json()
    assert reallocate(client, s, lot, quantity=1, weight=1, **measurement(kind, 1)).status_code == 422
    result = reallocate(client, s, lot, quantity=0, weight=1, **measurement(kind, 1))
    assert result.status_code == 201, result.text
    assert result.json()["quantity"] == 0
    body = dict(source_transfer_id=lot["id"], quantity=1, weight=1, idempotency_key="weight-only-loss")
    assert client.post(base(s) + "/losses", headers=s["headers"], json=body).status_code == 422
    body["quantity"] = 0
    assert client.post(base(s) + "/losses", headers=s["headers"], json=body).status_code == 201
    assert change(client, s, lot, 10).status_code == 422
    with SessionLocal() as db:
        assert db.get(MaterialStockBalance, lot["id"]).on_hand_quantity == 0
        assert db.get(MaterialStockBalance, lot["id"]).on_hand_weight == Decimal(1)


@pytest.mark.parametrize("kind", ["sludge", "scrap_chips"])
def test_direct_transfer_conversion_and_edit_cannot_introduce_pieces(client, warehouse, kind):
    s = warehouse
    body = dict(serial_no="WEIGHT-ONLY", material_name="材料1", material_type=kind,
                next_team_id=s["team"]["id"], quantity=1, weight=3, **measurement(kind))
    assert client.post("/api/material-transfers", headers=s["other_headers"], json=body).status_code == 422
    body["quantity"] = 0
    result = client.post("/api/material-transfers", headers=s["other_headers"], json=body)
    assert result.status_code == 201, result.text
    row = result.json()
    url = "/api/material-transfers/" + row["batch_no"]
    assert client.patch(url, headers=s["other_headers"], json={"quantity": 1, "expected_version": row["version"]}).status_code == 422
    assert client.patch(url, headers=s["other_headers"], json={"notes": "", "expected_version": row["version"]}).status_code == 200
    origin = intake(client, s, quantity=100, weight=10).json()
    sent = dispatch(client, s, [dict(source_transfer_id=origin["id"], quantity=100, weight=10)]).json()
    assert confirm(client, s, sent, workshop=True).status_code == 200
    portion = dict(source_transfer_id=sent["items"][0]["id"], material_type=kind, quantity=12, weight=3, **measurement(kind))
    assert dispatch(client, s, [portion], workshop=True).status_code == 422
    portion["quantity"] = 0
    converted = dispatch(client, s, [portion], workshop=True)
    assert converted.status_code == 201, converted.text
    with SessionLocal() as db:
        assert db.get(MaterialStockBalance, sent["items"][0]["id"]).on_hand_quantity == 100


def test_legacy_counts_remain_readable_but_cannot_be_increased(client, warehouse):
    s = warehouse
    response = client.post("/api/material-transfers", headers=s["other_headers"], json={
        "serial_no": "LEGACY", "material_type": "scrap_chips", "next_team_id": s["team"]["id"], "quantity": 0, "weight": 3})
    assert response.status_code == 201, response.text
    row = response.json()
    with SessionLocal.begin() as db:
        db.get(MaterialTransfer, row["id"]).quantity = 4
    url = "/api/material-transfers/" + row["batch_no"]
    current = client.get(url).json()
    assert current["quantity"] == 4
    edited = client.patch(url, headers=s["other_headers"], json={"notes": "历史资料补充", "expected_version": current["version"]})
    assert edited.status_code == 200 and edited.json()["quantity"] == 4
    assert client.patch(url, headers=s["other_headers"], json={"quantity": 5, "expected_version": edited.json()["version"]}).status_code == 422


@pytest.mark.parametrize("kind", ["waste", "defective", "semi_finished"])
def test_countable_material_types_keep_their_piece_inputs(client, warehouse, kind):
    result = intake(client, warehouse, material_type=kind, quantity=12, weight=0)
    assert result.status_code == 201, result.text
    assert result.json()["quantity"] == 12 and result.json()["weight"] == 0
