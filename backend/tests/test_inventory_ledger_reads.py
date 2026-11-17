"""Business regressions for the live overview; no fixture rows enter production."""

import pytest
from app.database import SessionLocal
from app.models import NotificationOutbox
from inventory_assertions import owned_total, team_balances
from legacy_urgency import seed_legacy_urgency
from receipt_helpers import receipt_post
from sqlalchemy import select
from test_external_outbound import confirm
from test_external_outbound import legacy_dispatch as dispatch
from test_external_outbound import outbound as outbound
from test_warehouse_receipts import intake
from test_warehouse_receipts import warehouse as warehouse

pytestmark = pytest.mark.usefixtures("legacy_stock")


def test_empty_live_overview_is_not_demo_data(client):
    assert owned_total(client) == {"quantity": 0, "weight": 0}
    data = client.get("/api/factory-overview").json()
    assert data["stock_matrix"]["total"] == {"quantity": 0, "weight": 0}
    assert data["pending"]["batches"] == 0
    client.headers.pop("Authorization")
    assert client.get("/api/factory-overview").status_code == 401


def test_pending_is_owned_upstream_until_receipt_and_external_confirmation(client, outbound):
    group = dispatch(
        client,
        outbound,
        entry_kind="transfer",
        external_destination=None,
        next_team_id=outbound["other"]["id"],
    ).json()
    data = team_balances(client)
    source = data[outbound["team"]["id"]]
    assert (source["owned_quantity"], source["owned_weight"]) == (200, 20)
    assert owned_total(client) == {"quantity": 200, "weight": 20}
    line = group["items"][0]
    assert (
        receipt_post(
            client,
            f"/api/material-transfers/{line['batch_no']}/confirm",
            headers=outbound["other_headers"],
            json={"idempotency_key": "dashboard-receive"},
        ).status_code
        == 200
    )
    data = team_balances(client)
    assert owned_total(client) == {"quantity": 200, "weight": 20}
    assert data[outbound["team"]["id"]]["owned_quantity"] == 170
    assert data[outbound["other"]["id"]]["owned_quantity"] == 30


def test_confirmed_shipment_and_loss_reconcile_received_material(client, outbound):
    first = outbound["lots"][0]
    response = dispatch(
        client, outbound, lines=[{"source_transfer_id": first["id"], "quantity": 100, "weight": 9}]
    )
    assert response.status_code == 201, response.text
    line = response.json()["items"][0]
    assert confirm(client, outbound, line).status_code == 200
    trace = client.get("/api/material-trace", params={"serial_no": first["serial_no"]}).json()
    assert trace["totals"]["on_hand"] == {"quantity": 0, "weight": 1}
    assert trace["totals"]["dispatched"] == {"quantity": 100, "weight": 9}
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
    trace = client.get("/api/material-trace", params={"serial_no": first["serial_no"]}).json()
    assert trace["totals"]["on_hand"] == {"quantity": 0, "weight": 0}
    assert trace["totals"]["dispatched"]["weight"] == 9
    assert trace["totals"]["lost"] == {"quantity": 0, "weight": 1}


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
    url = f"/api/team-materials/{warehouse['team']['id']}"
    data = client.get(url + "/overview").json()
    assert len(data["materials"]) == 7
    serials = client.get(url + "/serials", params={"page_size": 3, "page": 3}).json()
    assert serials["total"] == 7 and serials["items"][0]["serial_no"] == "LIVE-0"
    assert client.get(url + "/serials", params={"query": "%"}).json()["total"] == 0
    assert owned_total(client)["weight"] == pytest.approx(7 * 10.125)


def test_team_directory_change_queues_overview_refresh(client):
    from test_material_transfers import _team

    with SessionLocal() as db:
        before = set(db.scalars(select(NotificationOutbox.id)))
    _team(client, "NEW-DIRECTORY-TEAM", "新配置班组")
    with SessionLocal() as db:
        messages = list(
            db.scalars(select(NotificationOutbox).where(NotificationOutbox.id.not_in(before)))
        )
        assert any(m.payload["directory"] and m.payload["team_ids"] is None for m in messages)
    assert client.get("/api/team-directory").json()[0]["name"] == "新配置班组"


def test_delivery_plan_change_queues_live_overview_refresh(client, outbound):
    origin_batch = outbound["lots"][0]["delivery_origin_batch_no"]
    origin = client.get(f"/api/material-transfers/{origin_batch}").json()
    with SessionLocal() as db:
        before = set(db.scalars(select(NotificationOutbox.id)))
    result = client.patch(
        f"/api/material-transfers/{origin_batch}/delivery",
        headers=outbound["all_headers"][origin["source_team_id"] or origin["next_team_id"]],
        json={
            "delivery_date": "2026-10-01",
            "delivery_quantity": 30,
            "expected_version": origin["version"],
        },
    )
    assert result.status_code == 200, result.text
    with SessionLocal() as db:
        messages = list(
            db.scalars(select(NotificationOutbox).where(NotificationOutbox.id.not_in(before)))
        )
        assert len(messages) == 1
        assert messages[0].payload["team_ids"] is None


def test_historical_urgency_does_not_create_follow_up_items(client, warehouse):
    lot = intake(client, warehouse, serial_no="LEGACY-URGENT").json()
    before = client.get("/api/factory-overview").json()["stock_attention"]
    seed_legacy_urgency(lot["serial_no"])
    data = client.get("/api/factory-overview").json()
    assert owned_total(client)["quantity"] > 0
    assert data["stock_attention"] == before
