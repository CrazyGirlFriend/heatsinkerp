"""Each team's receipt ledger follows confirmation time, not remaining stock."""
from datetime import datetime

from app.database import SessionLocal
from app.models import MaterialTransfer
from test_material_stock import dispatch, endpoint, receive_lot, stock_setup  # noqa: F401
from test_material_transfers import _create


def test_confirmed_receipt_enters_team_ledger_and_survives_full_dispatch(client, stock_setup):
    setup = stock_setup
    url = endpoint(setup, "receipts")
    pending = _create(client, setup, quantity=100, weight=10, material_type="semi_finished").json()
    before = client.get(url, headers=setup["stock_headers"])
    assert before.status_code == 200, before.text
    assert before.json()["total"] == 0
    confirmed = client.post(
        f"/api/material-transfers/{pending['batch_no']}/confirm",
        headers=setup["stock_headers"], json={"idempotency_key": "receipt-ledger-confirm"},
    )
    assert confirmed.status_code == 200, confirmed.text
    receipt = confirmed.json()
    for headers in ({}, setup["stock_headers"], setup["source_headers"]):
        listed = client.get(url, headers=headers).json()
        assert listed["total"] == 1
        assert listed["items"][0]["id"] == receipt["id"]
        assert listed["items"][0]["received_at"] == receipt["received_at"]
        assert listed["items"][0]["received_by"] == receipt["received_by"]

    # Pending/voided incoming batches and another team's receipts stay outside this ledger.
    waiting = _create(client, setup, idempotency_key="receipt-ledger-waiting").json()
    voided = _create(client, setup, idempotency_key="receipt-ledger-voided").json()
    assert client.delete(f"/api/material-transfers/{voided['batch_no']}", headers=setup["source_headers"]).status_code == 204
    assert client.get(url).json()["total"] == 1
    assert client.get(f"/api/team-materials/{setup['source']['id']}/receipts").json()["total"] == 0
    sent = dispatch(client, setup, [{"source_transfer_id": receipt["id"], "quantity": 100, "weight": 10}])
    assert sent.status_code == 201, sent.text
    child = sent.json()["items"][0]
    assert client.post(f"/api/material-transfers/{child['batch_no']}/confirm", headers=setup["third_headers"],
                       json={"idempotency_key": "receipt-ledger-downstream"}).status_code == 200
    assert client.get(endpoint(setup, "overview")).json()["totals"]["available_weight"] == 0
    ledger = client.get(url).json()
    assert [row["id"] for row in ledger["items"]] == [receipt["id"]]
    assert ledger["items"][0]["quantity"] == 100 and ledger["items"][0]["weight"] == 10
    assert waiting["id"] != receipt["id"]


def test_receipts_sort_and_filter_by_received_time_with_stable_pagination(client, stock_setup):
    setup = stock_setup
    lots = [receive_lot(client, setup, key=f"receipt-order-{index}") for index in range(3)]
    with SessionLocal.begin() as db:
        for index, lot in enumerate(lots):
            row = db.get(MaterialTransfer, lot["id"])
            row.created_at = datetime(2026, 9, 20 + index)
            row.updated_at = datetime(2026, 9, 30) if index == 1 else datetime(2026, 9, 28)
            row.received_at = datetime(2026, 9, 27, 15, 59) if index == 1 else datetime(2026, 9, 27, 16)
    url = endpoint(setup, "receipts")
    expected = [lots[2]["id"], lots[0]["id"], lots[1]["id"]]
    assert [row["id"] for row in client.get(url).json()["items"]] == expected
    for page, record_id in enumerate(expected, start=1):
        result = client.get(url, params={"page": page, "page_size": 1}).json()
        assert result["total"] == 3
        assert [row["id"] for row in result["items"]] == [record_id]
    result = client.get(url, params={"date_from": "2026-09-28", "date_to": "2026-09-28"}).json()
    assert [row["id"] for row in result["items"]] == expected[:2]
    result = client.get(url, params={"query": "FLOW-receipt-order-0", "material_type": "semi_finished"}).json()
    assert [row["id"] for row in result["items"]] == [lots[0]["id"]]
    assert client.get('/api/team-materials/999999/receipts').status_code == 404
