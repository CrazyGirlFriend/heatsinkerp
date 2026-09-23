import json
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from unittest.mock import Mock

import pytest
from app import inventory_snapshots, material_stock, team_read_snapshots, warehouse_inventory
from app.database import SessionLocal, get_db
from app.inventory_events import inventory_events
from app.inventory_snapshots import SnapshotFrames
from app.main import app
from app.models import MaterialTransfer, User
from sqlalchemy import select
from test_transfer_list_loading import read_statements
from test_warehouse_receipts import intake, warehouse  # noqa: F401


@pytest.mark.parametrize("view", ["overview", "inventory"])
def test_cached_team_read_still_authenticates_every_request_and_rejects_logout(
    client,
    warehouse,  # noqa: F811
    monkeypatch,
    view,
):
    module, function = (
        (material_stock, "overview")
        if view == "overview"
        else (warehouse_inventory, "list_inventory")
    )
    build = Mock(wraps=getattr(module, function))
    monkeypatch.setattr(module, function, build)
    url = f"/api/team-materials/{warehouse['team']['id']}/{view}"
    first = client.get(url)
    assert first.status_code == 200
    with read_statements() as sql:
        second = client.get(url)
    assert second.json() == first.json()
    assert second.headers["cache-control"] == "no-store"
    assert len(sql) == 1  # Auth only; no stock computation on a hit.
    build.assert_called_once()
    assert client.get(url, headers={"Authorization": "Bearer invalid"}).status_code == 401
    assert client.post("/api/auth/logout").status_code == 204
    assert client.get(url).status_code == 401
    build.assert_called_once()


@pytest.mark.parametrize("view", ["overview", "inventory"])
def test_revoked_account_cannot_use_a_warm_cache_even_without_inventory_change(
    client,
    warehouse,  # noqa: F811
    monkeypatch,
    view,
):
    base = f"/api/team-materials/{warehouse['team']['id']}/{view}"
    assert client.get(base, headers=warehouse["headers"]).status_code == 200
    revision = inventory_events.revision
    with SessionLocal() as db:
        user_id = db.scalar(select(User.id).where(User.username == "warehouse-leader"))
    assert client.patch(f"/api/accounts/{user_id}", json={"active": False}).status_code == 200
    assert inventory_events.revision == revision
    monkeypatch.setattr(
        team_read_snapshots.team_read_frames,
        "get",
        Mock(side_effect=AssertionError("authentication must precede shared data")),
    )
    assert client.get(base, headers=warehouse["headers"]).status_code == 401


def test_commit_invalidates_both_reads_immediately_but_rollback_does_not(
    client,
    warehouse,  # noqa: F811
    monkeypatch,
):
    module = team_read_snapshots
    cache = module.team_read_frames
    base = f"/api/team-materials/{warehouse['team']['id']}"
    assert client.get(base + "/overview").json()["totals"]["on_hand_quantity"] == 0
    assert client.get(base + "/inventory").json()["total"] == 0
    lot = intake(client, warehouse).json()
    assert client.get(base + "/overview").json()["totals"]["on_hand_quantity"] == 100
    assert client.get(base + "/inventory").json()["items"][0]["on_hand_quantity"] == 100
    response = client.post(
        base + "/losses",
        headers=warehouse["headers"],
        json={
            "source_transfer_id": lot["id"],
            "quantity": 1,
            "weight": 0.125,
            "reason": "清点丢失",
            "idempotency_key": "cached-loss",
        },
    )
    assert response.status_code == 201
    assert client.get(base + "/overview").json()["totals"]["on_hand_quantity"] == 99
    assert client.get(base + "/inventory").json()["items"][0]["on_hand_quantity"] == 99
    with SessionLocal() as db:
        db.get(MaterialTransfer, lot["id"]).quantity = 500
        db.flush()
        db.rollback()
    build = Mock(side_effect=AssertionError("rollback must not invalidate"))
    monkeypatch.setattr(material_stock, "overview", build)
    assert client.get(base + "/overview").json()["totals"]["on_hand_quantity"] == 99
    assert cache is module.team_read_frames


def test_filter_page_size_and_team_are_part_of_the_read_key(client, warehouse, monkeypatch):  # noqa: F811
    intake(client, warehouse, serial_no="000012")
    base = f"/api/team-materials/{warehouse['team']['id']}/inventory"
    build = Mock(wraps=warehouse_inventory.list_inventory)
    monkeypatch.setattr(warehouse_inventory, "list_inventory", build)
    assert client.get(base, params={"query": "000012", "page_size": 10}).json()["total"] == 1
    assert client.get(base, params={"page_size": 10, "query": "000012"}).json()["total"] == 1
    build.assert_called_once()
    assert client.get(base, params={"query": "other"}).json()["total"] == 0
    assert client.get(base, params={"page_size": 20}).json()["page_size"] == 20
    assert client.get(base, params={"page": 2, "page_size": 10}).json()["items"] == []
    assert (
        client.get(f"/api/team-materials/{warehouse['other']['id']}/inventory").json()["total"] == 0
    )
    assert build.call_count == 5
    assert (
        client.get(base, params={"search_field": "on_hand_quantity", "query": "bad"}).status_code
        == 422
    )
    assert build.call_count == 5


def test_25_concurrent_same_team_reads_build_once_without_sharing_mutable_objects(
    client,
    warehouse,  # noqa: F811
):
    entered, finish = Event(), Event()
    calls = []

    def build(db):
        calls.append(1)
        entered.set()
        assert finish.wait(2)
        return material_stock.overview(db, warehouse["team"]["id"])

    with ThreadPoolExecutor(max_workers=25) as pool:
        jobs = [
            pool.submit(
                team_read_snapshots.team_read_response,
                "team-overview",
                warehouse["team"]["id"],
                build,
            )
            for _ in range(25)
        ]
        try:
            assert entered.wait(2)
        finally:
            finish.set()
        bodies = [job.result(timeout=2).body for job in jobs]
    assert len(calls) == 1 and len(set(bodies)) == 1
    decoded = json.loads(bodies[0])
    decoded["totals"]["on_hand_quantity"] = -1
    assert json.loads(bodies[1])["totals"]["on_hand_quantity"] == 0


def test_waiting_for_shared_reads_never_retains_the_auth_transaction(
    client,
    warehouse,  # noqa: F811
    monkeypatch,
):
    sessions = []

    def request_db():
        with SessionLocal() as db:
            sessions.append(db)
            try:
                yield db
            finally:
                sessions.remove(db)

    original = team_read_snapshots.team_read_frames.get

    def get(*args):
        assert sessions and all(not db.in_transaction() for db in sessions)
        return original(*args)

    app.dependency_overrides[get_db] = request_db
    monkeypatch.setattr(team_read_snapshots.team_read_frames, "get", get)
    try:
        for view in ("overview", "inventory"):
            assert (
                client.get(f"/api/team-materials/{warehouse['team']['id']}/{view}").status_code
                == 200
            )
    finally:
        app.dependency_overrides.pop(get_db)


def test_team_cache_is_bounded_expires_and_does_not_log_search_values(monkeypatch):
    cache = SnapshotFrames(views=None, capacity=2)
    record = Mock()
    now = [0.0]
    monkeypatch.setattr(inventory_snapshots, "record", record)
    monkeypatch.setattr(inventory_snapshots, "monotonic", lambda: now[0])

    def read(query):
        return cache.get(("team-inventory", 1, query), lambda: (1, "today"), lambda: query)

    assert read("private-serial") == "private-serial"
    read("second")
    read("private-serial")
    read("third")
    assert len(cache._frames) == 2
    assert ("team-inventory", 1, "second") not in cache._frames
    assert "private-serial" not in str(record.call_args_list)
    now[0] = 3
    read("private-serial")
    assert record.call_count == 4
