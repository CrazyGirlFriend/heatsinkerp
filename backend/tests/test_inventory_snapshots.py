import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from threading import Event, Lock
from unittest.mock import Mock

import pytest
from app import factory_stream
from app.inventory_events import InventoryEvents, inventory_events
from app.inventory_snapshots import SnapshotFrames
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from test_inventory_stream import LiveRequest


def test_same_revision_fans_out_one_computation_to_25_readers():
    cache = SnapshotFrames()
    entered, finish = Event(), Event()
    calls, guard = [], Lock()

    def build():
        with guard:
            calls.append(1)
        entered.set()
        assert finish.wait(2)
        return "shared frame"

    with ThreadPoolExecutor(max_workers=25) as pool:
        jobs = [pool.submit(cache.get, "inventory", lambda: (1, "today"), build) for _ in range(25)]
        try:
            assert entered.wait(2)
        finally:
            finish.set()
        assert [job.result(timeout=2) for job in jobs] == ["shared frame"] * 25
    assert len(calls) == 1


def test_revision_midnight_and_age_invalidate_without_background_polling(monkeypatch):
    from app import inventory_snapshots

    now, version = [0.0], [(1, "first day")]
    monkeypatch.setattr(inventory_snapshots, "monotonic", lambda: now[0])
    cache, build = SnapshotFrames(), Mock(side_effect=["first", "updated", "next day", "aged"])

    def read():
        return cache.get("inventory", lambda: version[0], build)

    assert read() == read() == "first"
    version[0] = (2, "first day")
    assert read() == "updated"
    version[0] = (2, "second day")
    assert read() == "next day"
    now[0] = 3.0
    assert build.call_count == 3  # Time passing alone never queries anything.
    assert read() == "aged"
    assert build.call_count == 4


def test_commit_during_build_does_not_cache_an_obsolete_snapshot():
    cache, version = SnapshotFrames(), [1]

    def build():
        version[0] = 2
        return "old read transaction"

    assert cache.get("inventory", lambda: (version[0], "today"), build) == "old read transaction"
    current = Mock(return_value="committed snapshot")
    assert cache.get("inventory", lambda: (version[0], "today"), current) == "committed snapshot"
    assert cache.get("inventory", lambda: (version[0], "today"), current) == "committed snapshot"
    current.assert_called_once()


def test_failures_release_waiters_and_views_do_not_share_frames():
    cache = SnapshotFrames()

    def version():
        return 1, "today"

    with pytest.raises(RuntimeError):
        cache.get("inventory", version, Mock(side_effect=RuntimeError("failed read")))
    assert cache.get("inventory", version, lambda: "inventory") == "inventory"
    assert cache.get("factory-live", version, lambda: "robot") == "robot"
    with pytest.raises(ValueError):
        cache.get("arbitrary-user-key", version, lambda: "never retained")


def test_failed_builder_wakes_another_waiting_reader():
    cache, entered, finish = SnapshotFrames(), Event(), Event()

    def fail():
        entered.set()
        assert finish.wait(2)
        raise RuntimeError("failed read")

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(cache.get, "inventory", lambda: (1, "today"), fail)
        try:
            assert entered.wait(2)
            second = pool.submit(cache.get, "inventory", lambda: (1, "today"), lambda: "recovered")
        finally:
            finish.set()
        with pytest.raises(RuntimeError):
            first.result(timeout=2)
        assert second.result(timeout=2) == "recovered"


def test_publish_advances_revision_even_without_subscribers():
    events = InventoryEvents()
    initial = events.revision
    events.publish()
    assert events.revision == initial + 1


def test_cached_frame_still_checks_each_callers_authentication(client, monkeypatch):
    monkeypatch.setattr(factory_stream, "snapshot_frames", SnapshotFrames())
    build = Mock(wraps=factory_stream.factory_overview)
    monkeypatch.setattr(factory_stream, "factory_overview", build)
    token = client.headers["Authorization"].split(" ", 1)[1]
    valid = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
    first = factory_stream.read_inventory(valid)
    assert factory_stream.read_inventory(valid) == first
    build.assert_called_once()
    with pytest.raises(HTTPException) as error:
        factory_stream.read_inventory(
            HTTPAuthorizationCredentials(scheme="Bearer", credentials="invalid")
        )
    assert error.value.status_code == 401
    assert client.post("/api/auth/logout").status_code == 204
    with pytest.raises(HTTPException) as error:
        factory_stream.read_inventory(valid)
    assert error.value.status_code == 401


def test_many_streams_share_frame_and_keep_the_next_commit(client, monkeypatch):
    monkeypatch.setattr(factory_stream, "snapshot_frames", SnapshotFrames())
    build = Mock(wraps=factory_stream.factory_overview)
    monkeypatch.setattr(factory_stream, "factory_overview", build)
    token = client.headers["Authorization"].split(" ", 1)[1]
    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

    async def run():
        streams = [factory_stream.inventory_stream(LiveRequest(), credentials) for _ in range(10)]
        try:
            first = [await anext(stream) for stream in streams]
            assert len(set(first)) == 1
            assert json.loads(first[0].split("data: ", 1)[1])["totals"]["on_hand_quantity"] == 0
            assert build.call_count == 1
            inventory_events.publish()
            await asyncio.sleep(0)
            second = [await asyncio.wait_for(anext(stream), 2) for stream in streams]
            assert len(set(second)) == 1
            assert build.call_count == 2
        finally:
            for stream in streams:
                await stream.aclose()
        assert not inventory_events._subscribers

    asyncio.run(run())


def test_notification_during_report_build_is_not_lost(client, monkeypatch):
    monkeypatch.setattr(factory_stream, "snapshot_frames", SnapshotFrames())
    original = factory_stream.factory_overview
    builds = []

    def build(db):
        report = original(db)
        builds.append(1)
        if len(builds) == 1:
            inventory_events.publish()
        return report

    monkeypatch.setattr(factory_stream, "factory_overview", build)
    credentials = HTTPAuthorizationCredentials(
        scheme="Bearer", credentials=client.headers["Authorization"].split(" ", 1)[1]
    )

    async def run():
        stream = factory_stream.inventory_stream(LiveRequest(), credentials)
        try:
            assert (await anext(stream)).startswith("event: inventory")
            assert (await asyncio.wait_for(anext(stream), 2)).startswith("event: inventory")
            assert len(builds) == 2
        finally:
            await stream.aclose()
        assert not inventory_events._subscribers

    asyncio.run(run())
