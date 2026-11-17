from datetime import datetime

import pytest
from app.database import SessionLocal
from app.models import MaterialLoss, MaterialTransfer, SerialUrgency, SerialUrgencyEvent
from legacy_urgency import seed_legacy_urgency
from sqlalchemy import func, select
from test_material_stock import dispatch, endpoint, loss, receive_lot, totals
from test_material_stock import stock_setup as stock_setup
from test_warehouse_receipts import intake
from test_warehouse_receipts import warehouse as warehouse


def stamp(lot, **values):
    with SessionLocal() as db:
        row = db.get(MaterialTransfer, lot["id"])
        for key, value in values.items():
            setattr(row, key, value)
        db.commit()


def test_retired_urgency_api_and_filters_leave_inventory_unchanged(client, stock_setup):
    s = stock_setup
    lot = receive_lot(client, s)
    other = receive_lot(client, s, key="ordinary")
    seed_legacy_urgency(lot["serial_no"])
    assert (
        dispatch(
            client,
            s,
            [
                {"source_transfer_id": lot["id"], "quantity": 10, "weight": 1},
                {"source_transfer_id": other["id"], "quantity": 10, "weight": 1},
            ],
        ).status_code
        == 201
    )
    assert loss(client, s, lot).status_code == 201
    before = totals(client, s)
    for headers in ({}, s["stock_headers"]):
        assert (
            client.get(
                "/api/serial-urgency", headers=headers, params={"serial_no": lot["serial_no"]}
            ).status_code
            == 404
        )
        assert (
            client.put(
                "/api/serial-urgency",
                headers=headers,
                json={"serial_no": lot["serial_no"], "urgent": False, "expected_version": 1},
            ).status_code
            == 404
        )
    urls = [
        "/api/material-transfers",
        *[
            endpoint(s, suffix)
            for suffix in ("serials", "stock", "losses", "dispatches", "outbound-batches")
        ],
    ]
    for url in urls:
        normal = client.get(url)
        legacy = client.get(url, params={"urgent_only": True})
        assert normal.status_code == legacy.status_code == 200
        normal_data, legacy_data = normal.json(), legacy.json()
        normal_data.pop("as_of", None)
        legacy_data.pop("as_of", None)
        assert legacy_data == normal_data, url
    assert totals(client, s) == before
    with SessionLocal() as db:
        assert db.get(SerialUrgency, lot["serial_no"]).urgent
        assert db.scalar(select(func.count(SerialUrgencyEvent.id))) == 0


def test_date_filter_utc8_edges_and_pagination_before_count(client, stock_setup):
    s = stock_setup
    dates = [
        datetime(2026, 9, 11, 15, 59, 59),
        datetime(2026, 9, 11, 16),
        datetime(2026, 9, 12, 15, 59, 59),
        datetime(2026, 9, 12, 16),
    ]
    lots = [receive_lot(client, s, key=f"date-{i}") for i in range(4)]
    for lot, time in zip(lots, dates, strict=True):
        stamp(lot, created_at=time, received_at=time, updated_at=time)
    params = {"date_from": "2026-09-12", "date_to": "2026-09-12", "page_size": 1}
    for url in ("/api/material-transfers", endpoint(s, "stock"), endpoint(s, "serials")):
        result = client.get(url, params=params)
        assert result.status_code == 200, result.text
        assert result.json()["total"] == 2 and len(result.json()["items"]) == 1
        assert client.get(url, params={**params, "page": 3}).json()["items"] == []
    # A later deduction still belongs in a selected origin's CURRENT balance.
    assert (
        dispatch(
            client, s, [{"source_transfer_id": lots[1]["id"], "quantity": 10, "weight": 1}]
        ).status_code
        == 201
    )
    result = client.get(
        endpoint(s, "serials"), params={**params, "serial_no": lots[1]["serial_no"]}
    ).json()
    assert result["items"][0]["on_hand_quantity"] == 90
    # A day without an activity kind must not silently return every serial.
    assert client.get(endpoint(s, "serials?activity_day=2020-01-01")).json()["total"] == 0


def test_dispatch_and_loss_dates_use_own_registration_time(client, stock_setup):
    s = stock_setup
    lot = receive_lot(client, s)
    outgoing = dispatch(
        client, s, [{"source_transfer_id": lot["id"], "quantity": 10, "weight": 1}]
    ).json()
    lost = loss(client, s, lot).json()
    with SessionLocal() as db:
        db.get(MaterialTransfer, outgoing["items"][0]["id"]).created_at = datetime(2026, 9, 11, 16)
        db.get(MaterialLoss, lost["id"]).created_at = datetime(2026, 9, 11, 16)
        db.commit()
    for suffix in ("dispatches", "losses"):
        assert (
            client.get(endpoint(s, suffix + "?date_from=2026-09-12&date_to=2026-09-12")).json()[
                "total"
            ]
            == 1
        )
        assert (
            client.get(endpoint(s, suffix + "?date_from=2026-09-11&date_to=2026-09-11")).json()[
                "total"
            ]
            == 0
        )


def test_warehouse_intake_date_ignores_legacy_urgency_filter(client, warehouse):
    lot = intake(client, warehouse).json()
    stamp(lot, received_at=datetime(2026, 9, 11, 16), created_at=datetime(2026, 9, 11, 16))
    params = {"date_from": "2026-09-12", "date_to": "2026-09-12", "urgent_only": True}
    assert client.get(warehouse["url"], params=params).json()["total"] == 1
    assert (
        client.get(warehouse["url"], params={**params, "date_to": "2026-09-11"}).status_code == 422
    )


@pytest.mark.parametrize("suffix", ["stock", "losses", "dispatches", "serials"])
def test_invalid_dates_rejected(client, stock_setup, suffix):
    assert (
        client.get(
            endpoint(stock_setup, suffix + "?date_from=2026-09-13&date_to=2026-09-12")
        ).status_code
        == 422
    )
    assert client.get(endpoint(stock_setup, suffix + "?date_from=not-a-date")).status_code == 422
