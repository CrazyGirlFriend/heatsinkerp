"""Business regressions for the live overview; no fixture rows enter production."""

from datetime import datetime
from unittest.mock import patch

import pytest
from app.database import SessionLocal
from app.models import AdminAuditEvent, MaterialTransfer, NotificationOutbox, SerialDeliveryPlan
from sqlalchemy import func, select
from test_external_outbound import confirm, dispatch
from test_external_outbound import outbound as outbound
from test_warehouse_receipts import intake
from test_warehouse_receipts import warehouse as warehouse

ROOT = "/api/factory-dashboard"


def dashboard(client):
    response = client.get(ROOT)
    assert response.status_code == 200, response.text
    return response.json()


def test_empty_dashboard_is_not_demo_data(client):
    data = dashboard(client)
    assert data["stock"]["total"] == {"quantity": 0, "weight": 0}
    assert len(data["stock"]["rows"]) == 8
    assert data["yields"] == data["attention"] == data["shipping"]["series"] == []
    assert data["delivery"]["on_time_rate"] is None
    assert data["delivery"]["total"] == data["serial_count"] == 0
    client.headers.pop("Authorization")
    assert client.get(ROOT).status_code == 401


def test_pending_is_owned_upstream_until_receipt_and_external_confirmation(client, outbound):
    group = dispatch(
        client,
        outbound,
        entry_kind="transfer",
        external_destination=None,
        next_team_id=outbound["other"]["id"],
    ).json()
    data = dashboard(client)["stock"]
    source = next(r for r in data["rows"] if r["team_id"] == outbound["team"]["id"])
    assert source["total"] == data["total"] == {"quantity": 200, "weight": 20}
    line = group["items"][0]
    assert (
        client.post(
            f"/api/material-transfers/{line['batch_no']}/confirm",
            headers=outbound["other_headers"],
            json={"idempotency_key": "dashboard-receive"},
        ).status_code
        == 200
    )
    data = dashboard(client)["stock"]
    assert data["total"] == {"quantity": 200, "weight": 20}
    assert (
        next(r for r in data["rows"] if r["team_id"] == outbound["team"]["id"])["total"]["quantity"]
        == 170
    )
    assert (
        next(r for r in data["rows"] if r["team_id"] == outbound["other"]["id"])["total"][
            "quantity"
        ]
        == 30
    )
    assert sum(r["total"]["quantity"] for r in data["rows"] if r["total"]) == 200
    detail = client.get(ROOT + "/stock-detail").json()
    assert sum(r["quantity"] for r in detail["items"]) == 200


def test_confirmed_finished_shipments_only_with_factory_dates(client, outbound):
    group = dispatch(client, outbound).json()
    assert all(
        sum(v or 0 for v in s["values"]) == 0 for s in dashboard(client)["shipping"]["series"]
    )
    first = group["items"][0]
    assert confirm(client, outbound, first).status_code == 200
    with SessionLocal() as db:
        row = db.get(MaterialTransfer, first["id"])
        row.dispatched_at = datetime(2026, 9, 25, 16, 1)  # Sep 26 in Asia/Shanghai
        row.created_at = datetime(2026, 9, 25, 15)
        # Move the origin earlier too; null before creation is intentional.
        for origin in db.scalars(
            select(MaterialTransfer).where(MaterialTransfer.serial_no == first["serial_no"])
        ):
            origin.created_at = datetime(2026, 9, 20)
        db.commit()
    response = client.get(
        ROOT + "/shipments",
        params=[
            ("date_from", "2026-09-25"),
            ("date_to", "2026-09-26"),
            ("serial_no", first["serial_no"]),
        ],
    )
    assert response.status_code == 200, response.text
    assert response.json()["series"][0]["values"] == [0, 30]
    assert (
        client.get(
            ROOT + "/shipments", params={"date_from": "2026-10-01", "date_to": "2026-09-01"}
        ).status_code
        == 422
    )
    assert (
        client.get(
            ROOT + "/shipments", params={"date_from": "2020-01-01", "date_to": "2026-09-01"}
        ).status_code
        == 422
    )
    data = dashboard(client)["stock"]
    assert data["total"] == {"quantity": 170, "weight": 17}
    # Internal movements and unconfirmed external lines never produce shipment points.
    assert client.get(ROOT + "/serials", params={"query": first["serial_no"]}).json()["total"] == 1


def test_yield_excludes_unfinished_serials_and_drills_to_team(client, outbound):
    first = outbound["lots"][0]
    response = dispatch(
        client, outbound, lines=[{"source_transfer_id": first["id"], "quantity": 100, "weight": 9}]
    )
    assert response.status_code == 201, response.text
    line = response.json()["items"][0]
    assert confirm(client, outbound, line).status_code == 200
    data = dashboard(client)
    assert data["yields"][0]["rate"] is None
    response = client.post(
        outbound["url"] + "/losses",
        headers=outbound["headers"],
        json={
            "source_transfer_id": first["id"],
            "quantity": 0,
            "weight": 1,
            "reason": "加工损耗",
            "idempotency_key": "yield-loss",
        },
    )
    assert response.status_code == 201, response.text
    data = dashboard(client)
    assert data["yields"][0]["rate"] == 90
    assert data["yields"][0]["input_weight"] == 10
    rows = client.get(ROOT + "/yields").json()["items"]
    assert next(r for r in rows if r["serial_no"] == first["serial_no"])["status"] == "complete"
    teams = client.get(ROOT + "/team-yields", params={"serial_no": first["serial_no"]}).json()[
        "items"
    ]
    assert next(r for r in teams if r["team_id"] == outbound["team"]["id"])["rate"] == 90


def test_delivery_fifo_completed_late_and_pending_with_version_and_audit(client, outbound):
    serial = outbound["lots"][0]["serial_no"]
    payload = {
        "serial_no": serial,
        "expected_version": 0,
        "installments": [
            {"label": "第二批", "due_date": "2026-09-25", "quantity": 20},
            {"label": "第一批", "due_date": "2026-09-24", "quantity": 20},
        ],
    }
    assert (
        client.put(ROOT + "/delivery-plan", json=payload, headers=outbound["headers"]).status_code
        == 403
    )
    response = client.put(ROOT + "/delivery-plan", json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["version"] == 1
    assert response.json()["installments"][0]["label"] == "第一批"
    assert client.put(ROOT + "/delivery-plan", json=payload).status_code == 409
    first = dispatch(client, outbound).json()["items"][0]
    assert confirm(client, outbound, first).status_code == 200
    with SessionLocal() as db:
        db.get(MaterialTransfer, first["id"]).dispatched_at = datetime(2026, 9, 25, 2)
        db.commit()
        assert (
            db.scalar(
                select(func.count())
                .select_from(AdminAuditEvent)
                .where(AdminAuditEvent.target_type == "delivery_plan")
            )
            == 1
        )
        assert db.get(SerialDeliveryPlan, serial).version == 1
    with patch("app.factory_dashboard.utcnow", return_value=datetime(2026, 9, 26, 2)):
        rows = client.get(ROOT + "/deliveries").json()["items"]
        a = next(r for r in rows if r["label"] == "第一批")
        b = next(r for r in rows if r["label"] == "第二批")
        assert (a["shipped"], a["remaining"], a["status"]) == (20, 0, "late_complete")
        assert (b["shipped"], b["remaining"], b["status"]) == (10, 10, "overdue")
        data = dashboard(client)
        assert data["delivery"]["on_time_rate"] == 0
        assert data["delivery"]["overdue_count"] == 1
        assert any(r["serial_no"] == serial and "超期" in r["reasons"] for r in data["attention"])
    payload["expected_version"] = 1
    payload["installments"][0]["quantity"] = 0
    assert client.put(ROOT + "/delivery-plan", json=payload).status_code == 422


def test_dynamic_materials_and_literal_serial_search(client, warehouse):
    for i in range(7):
        response = intake(
            client,
            warehouse,
            serial_no=f"LIVE-{i}",
            material_name=f"牌号-{i}",
            idempotency_key=f"live-{i}",
        )
        assert response.status_code == 201, response.text
    data = dashboard(client)
    assert len(data["stock"]["materials"]) == 7
    assert len(data["shipping"]["series"]) == 5
    assert data["serial_count"] == 7
    assert (
        client.get(ROOT + "/serials", params={"page_size": 3, "page": 3}).json()["items"][0][
            "serial_no"
        ]
        == "LIVE-0"
    )
    assert client.get(ROOT + "/serials", params={"query": "%"}).json()["total"] == 0
    assert data["stock"]["total"]["weight"] == pytest.approx(7 * 10.125)


def test_delivery_plan_change_queues_live_overview_refresh(client, outbound):
    serial = outbound["lots"][0]["serial_no"]
    with SessionLocal() as db:
        before = set(db.scalars(select(NotificationOutbox.id)))
    result = client.put(
        ROOT + "/delivery-plan",
        json={
            "serial_no": serial,
            "expected_version": 0,
            "installments": [{"label": "第一批", "due_date": "2026-10-01", "quantity": 30}],
        },
    )
    assert result.status_code == 200, result.text
    with SessionLocal() as db:
        messages = list(
            db.scalars(select(NotificationOutbox).where(NotificationOutbox.id.not_in(before)))
        )
        assert len(messages) == 1
        assert messages[0].payload["team_ids"] is None
