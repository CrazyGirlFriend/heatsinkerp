import asyncio
import json
from unittest.mock import Mock

import pytest
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select

from app import factory_stream
from app.database import SessionLocal
from app.inventory_events import InventoryChange, InventoryEvents, inventory_events
from app.models import User
from test_inventory_stream import LiveRequest
from test_material_transfers import _create, _setup_three_teams
from test_warehouse_receipts import intake, warehouse


def credentials(headers):
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=headers["Authorization"].split(" ", 1)[1])


@pytest.mark.parametrize("view", ["factory-live", "inventory-changed"])
@pytest.mark.parametrize("change", [InventoryChange(team_ids=frozenset((123,))), InventoryChange(accounts=True)])
def test_midnight_is_not_hidden_by_a_simultaneous_scoped_change(client, monkeypatch, view, change):
    async def run():
        day = ["2026-09-23"]
        read = Mock(wraps=factory_stream.read_inventory)
        monkeypatch.setattr(factory_stream, "factory_day", lambda: day[0])
        monkeypatch.setattr(factory_stream, "read_inventory", read)
        monkeypatch.setattr(factory_stream, "HEARTBEAT_SECONDS", .01)
        stream = factory_stream.inventory_stream(LiveRequest(), credentials(client.headers), view)
        try:
            await anext(stream)
            day[0] = "2026-09-24"
            inventory_events.publish(change)
            await asyncio.sleep(0)
            assert (await asyncio.wait_for(anext(stream), 2)).startswith("event: " + view)
            refreshed = read.call_args.kwargs["change"]
            assert refreshed.team_ids is None
            assert refreshed.accounts == change.accounts
        finally:
            await stream.aclose()
    asyncio.run(run())


@pytest.mark.parametrize("view", ["inventory", "factory-live", "inventory-changed"])
def test_other_logins_and_logouts_never_refresh_stock_but_own_logout_closes(client, monkeypatch, view):
    async def run():
        monkeypatch.setattr(factory_stream, "HEARTBEAT_SECONDS", .01)
        stream = factory_stream.inventory_stream(LiveRequest(), credentials(client.headers), view)
        try:
            assert (await anext(stream)).startswith("event: " + view)
            revision = inventory_events.revision
            login = await asyncio.to_thread(client.post, "/api/auth/login", json={"username": "admin", "password": "Admin123!"})
            assert login.status_code == 200
            assert inventory_events.revision == revision
            assert (await anext(stream)) == ": heartbeat\n\n"
            response = await asyncio.to_thread(client.post, "/api/auth/logout", headers={"Authorization": "Bearer " + login.json()["access_token"]})
            assert response.status_code == 204
            assert (await anext(stream)) == ": heartbeat\n\n"
            assert inventory_events.revision == revision
            assert (await asyncio.to_thread(client.post, "/api/auth/logout")).status_code == 204
            assert (await asyncio.wait_for(anext(stream), 1)).startswith("event: auth-expired")
            assert inventory_events.revision == revision
        finally:
            await stream.aclose()
    asyncio.run(run())


def test_admin_account_changes_refresh_identity_without_invalidating_stock(client, warehouse, monkeypatch):
    publish = Mock(wraps=inventory_events.publish)
    monkeypatch.setattr(inventory_events, "publish", publish)
    with SessionLocal() as db:
        user_id = db.scalar(select(User.id).where(User.username == "warehouse-leader"))
    revision = inventory_events.revision
    response = client.patch(f"/api/accounts/{user_id}", json={"display_name": "库房新班组长"})
    assert response.status_code == 200
    change = publish.call_args.args[0]
    assert change.accounts and not change.inventory
    assert inventory_events.revision == revision
    assert asyncio.run(factory_stream.read_inventory(credentials(client.headers), change=change)) is None
    frame = asyncio.run(factory_stream.read_inventory(credentials(warehouse["headers"]), view="inventory-changed", change=change))
    payload = json.loads(frame.split("data: ", 1)[1])
    assert payload == {"changed": True, "team_ids": [], "accounts_changed": True,
                       "directory_changed": False, "current_user_changed": True}
    assert "user_ids" not in payload and "sessions" not in payload


@pytest.mark.parametrize("update", [{"active": False}, {"password": "NewPassword123!"}])
def test_disabled_or_password_reset_account_is_ejected_from_existing_stream(client, warehouse, update):
    with SessionLocal() as db:
        user_id = db.scalar(select(User.id).where(User.username == "warehouse-leader"))
    async def run():
        stream = factory_stream.inventory_stream(LiveRequest(), credentials(warehouse["headers"]), "inventory-changed")
        try:
            await anext(stream)
            assert (await asyncio.to_thread(client.patch, f"/api/accounts/{user_id}", json=update)).status_code == 200
            assert (await asyncio.wait_for(anext(stream), 1)).startswith("event: auth-expired")
        finally:
            await stream.aclose()
    asyncio.run(run())


def test_receipt_dispatch_loss_and_confirmation_identify_affected_teams(client, warehouse, monkeypatch):
    publish = Mock(wraps=inventory_events.publish)
    monkeypatch.setattr(inventory_events, "publish", publish)
    source, target = warehouse["team"]["id"], warehouse["other"]["id"]
    lot = intake(client, warehouse).json()
    assert publish.call_args.args[0].team_ids == {source}
    response = client.post(f"/api/team-materials/{source}/dispatches", headers=warehouse["headers"], json={
        "next_team_id": target, "idempotency_key": "scoped-out",
        "lines": [{"source_transfer_id": lot["id"], "quantity": 10, "weight": 1}]})
    assert response.status_code == 201
    assert publish.call_args.args[0].team_ids == {source, target}
    batch = response.json()["items"][0]["batch_no"]
    assert client.post(f"/api/material-transfers/{batch}/confirm", headers=warehouse["other_headers"], json={"idempotency_key": "scoped-in"}).status_code == 200
    assert publish.call_args.args[0].team_ids == {source, target}
    assert client.post(f"/api/team-materials/{source}/losses", headers=warehouse["headers"], json={
        "source_transfer_id": lot["id"], "quantity": 1, "weight": .1,
        "reason": "清点丢失", "idempotency_key": "scoped-loss"}).status_code == 201
    assert publish.call_args.args[0].team_ids == {source}


def test_retargeting_notifies_both_previous_and_new_destination(client, monkeypatch):
    setup = _setup_three_teams(client)
    row = _create(client, setup).json()
    publish = Mock(wraps=inventory_events.publish)
    monkeypatch.setattr(inventory_events, "publish", publish)
    response = client.patch(f"/api/material-transfers/{row['batch_no']}", headers=setup["source_headers"], json={"next_team_id": setup["third"]["id"]})
    assert response.status_code == 200, response.text
    assert publish.call_args.args[0].team_ids == {setup[name]["id"] for name in ("source", "target", "third")}


def test_coalescing_keeps_all_scopes_and_permission_events_do_not_change_stock_revision():
    async def run():
        events = InventoryEvents()
        with events.subscribe() as signal:
            events.publish(InventoryChange(team_ids=frozenset((1, 2))))
            events.publish(InventoryChange(team_ids=frozenset((2, 3))))
            events.publish(InventoryChange(accounts=True, user_ids=frozenset((7,))))
            await asyncio.wait_for(signal.wait(), 1)
            assert events.revision == 2
            change = signal.take()
            assert change.team_ids == {1, 2, 3} and change.user_ids == {7}
            assert not signal.is_set()
            events.publish(InventoryChange(team_ids=None))
            events.publish(InventoryChange(team_ids=frozenset((4,))))
            await asyncio.wait_for(signal.wait(), 1)
            assert signal.take().team_ids is None
        assert not events._subscribers
    asyncio.run(run())
