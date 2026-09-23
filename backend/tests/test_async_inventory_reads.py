import asyncio
import json
from inspect import iscoroutinefunction
from unittest.mock import AsyncMock, Mock

import pytest
from app import factory_stream, material_stock
from app.database import AsyncSessionLocal, SessionLocal, async_engine
from app.inventory_snapshots import SnapshotFrames
from app.main import app
from app.models import MaterialTransfer
from fastapi import HTTPException
from fastapi.routing import APIRoute
from fastapi.security import HTTPAuthorizationCredentials
from test_warehouse_receipts import intake, warehouse  # noqa: F401


def test_every_http_route_is_async_and_database_driver_is_async():
    routes = [route for route in app.routes if isinstance(route, APIRoute)]
    assert len(routes) > 50
    assert all(iscoroutinefunction(route.endpoint) for route in routes)
    assert async_engine.dialect.is_async


def test_only_overlapping_reads_share_work_and_completed_results_are_not_cached():
    async def run():
        frames, entered, finish = SnapshotFrames(), asyncio.Event(), asyncio.Event()

        async def build():
            entered.set()
            await finish.wait()
            return "first"

        build = AsyncMock(side_effect=build)
        requests = [
            asyncio.create_task(frames.get("inventory", lambda: (1, "today"), build))
            for _ in range(25)
        ]
        await entered.wait()
        await asyncio.sleep(0)
        finish.set()
        assert await asyncio.gather(*requests) == ["first"] * 25
        assert build.call_count == 1 and not frames._building
        fresh = AsyncMock(return_value="second")
        assert await frames.get("inventory", lambda: (1, "today"), fresh) == "second"
        assert fresh.call_count == 1 and not frames._building

    asyncio.run(run())


def test_new_revision_does_not_wait_for_an_old_read_and_cancellation_is_isolated():
    async def run():
        frames, finish = SnapshotFrames(), asyncio.Event()

        async def old():
            await finish.wait()
            return "old"

        first = asyncio.create_task(frames.get("inventory", lambda: (1, "today"), old))
        waiter = asyncio.create_task(frames.get("inventory", lambda: (1, "today"), old))
        await asyncio.sleep(0)
        first.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first
        assert (
            await frames.get("inventory", lambda: (2, "today"), AsyncMock(return_value="new"))
            == "new"
        )
        finish.set()
        assert await waiter == "old"
        with pytest.raises(RuntimeError):
            await frames.get(
                "inventory",
                lambda: (2, "today"),
                AsyncMock(side_effect=RuntimeError("read failed")),
            )
        assert not frames._building
        assert (
            await frames.get("inventory", lambda: (2, "today"), AsyncMock(return_value="recovered"))
            == "recovered"
        )

    asyncio.run(run())


@pytest.mark.parametrize("view", ["overview", "inventory"])
def test_every_team_read_is_fresh_and_still_requires_valid_auth(
    client,
    warehouse,  # noqa: F811
    monkeypatch,
    view,
):
    lot = intake(client, warehouse).json()
    url = f"/api/team-materials/{warehouse['team']['id']}/{view}"
    response = client.get(url)
    assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
    with SessionLocal.begin() as db:
        db.get(MaterialTransfer, lot["id"]).quantity = 123
    # No notification needs to arrive for a subsequent HTTP read to be fresh.
    data = client.get(url).json()
    assert (data["totals"] if view == "overview" else data["items"][0])["on_hand_quantity"] == 123
    with SessionLocal() as db:
        db.get(MaterialTransfer, lot["id"]).quantity = 999
        db.flush()
        db.rollback()
    data = client.get(url).json()
    assert (data["totals"] if view == "overview" else data["items"][0])["on_hand_quantity"] == 123
    assert client.post("/api/auth/logout").status_code == 204
    assert client.get(url).status_code == 401


def test_async_report_authentication_is_checked_on_every_call(client, monkeypatch):
    async def run():
        build = Mock(wraps=factory_stream.factory_overview)
        monkeypatch.setattr(factory_stream, "factory_overview", build)
        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer", credentials=client.headers["Authorization"].split(" ", 1)[1]
        )
        first = await factory_stream.read_inventory(credentials)
        assert json.loads(first.split("data: ", 1)[1])["totals"]["on_hand_quantity"] == 0
        await factory_stream.read_inventory(credentials)
        assert build.call_count == 2  # No retained result, even within two seconds.
        with pytest.raises(HTTPException) as error:
            await factory_stream.read_inventory(
                HTTPAuthorizationCredentials(scheme="Bearer", credentials="invalid")
            )
        assert error.value.status_code == 401 and build.call_count == 2

    asyncio.run(run())


def test_inventory_filters_still_distinguish_team_search_and_page(client, warehouse):  # noqa: F811
    intake(client, warehouse, serial_no="000012")
    url = f"/api/team-materials/{warehouse['team']['id']}/inventory"
    assert client.get(url, params={"query": "000012", "page_size": 10}).json()["total"] == 1
    assert client.get(url, params={"query": "absent"}).json()["total"] == 0
    assert client.get(url, params={"page": 2, "page_size": 10}).json()["items"] == []
    assert (
        client.get(url, params={"search_field": "on_hand_quantity", "query": "bad"}).status_code
        == 422
    )
    assert (
        client.get(f"/api/team-materials/{warehouse['other']['id']}/inventory").json()["total"] == 0
    )


def test_password_check_does_not_block_the_event_loop(client, monkeypatch):
    from threading import Event

    import httpx
    from app import auth_api

    entered, release = Event(), Event()
    original = auth_api.verify_password

    def verify(*args):
        entered.set()
        assert release.wait(3)
        return original(*args)

    monkeypatch.setattr(auth_api, "verify_password", verify)

    async def run():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as http:
            login = asyncio.create_task(
                http.post("/api/auth/login", json={"username": "admin", "password": "Admin123!"})
            )
            try:
                assert await asyncio.to_thread(entered.wait, 2)
                assert (await asyncio.wait_for(http.get("/health"), 0.5)).status_code == 200
            finally:
                release.set()
            assert (await login).status_code == 200

    asyncio.run(run())


def test_async_transaction_services_still_return_plain_json(client, warehouse):  # noqa: F811
    async def run():
        async with AsyncSessionLocal() as db:
            report = await db.run_sync(
                lambda session: material_stock.overview(session, warehouse["team"]["id"])
            )
            assert report["totals"]["on_hand_quantity"] == 0

    asyncio.run(run())
