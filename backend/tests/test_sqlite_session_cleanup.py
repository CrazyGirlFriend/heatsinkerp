import asyncio
import sqlite3
from threading import Event
from time import sleep
from types import SimpleNamespace

import anyio
import pytest
from app import database, factory_stream
from app.inventory_snapshots import SnapshotFrames
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool


@pytest.mark.parametrize("phase", ["authentication", "snapshot"])
def test_stream_disconnect_during_sqlite_query_releases_reader(tmp_path, monkeypatch, phase):
    path = tmp_path / "stream.sqlite"
    with sqlite3.connect(path) as db:
        assert db.execute("PRAGMA journal_mode").fetchone()[0] == "delete"
        db.execute("CREATE TABLE sample (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)")
        db.execute("INSERT INTO sample VALUES (1, 0)")

    async def run():
        engine = create_async_engine(f"sqlite+aiosqlite:///{path}", poolclass=NullPool)
        connections, entered, query_release = [], Event(), Event()

        def pause():
            entered.set()
            if not query_release.wait(2):
                raise TimeoutError("Test did not cancel the active query")
            sleep(0.075)
            return 1

        @event.listens_for(engine.sync_engine, "connect")
        def configure(connection, _):
            connections.append(connection.driver_connection)
            connection.create_function("pause", 0, pause)

        def read(db):
            db.execute(text("BEGIN"))
            assert db.scalar(text("SELECT value FROM sample WHERE id = 1")) == 0
            db.scalar(text("SELECT pause() FROM sample"))

        def authenticate(credentials, db):
            if phase == "authentication":
                read(db)
            return SimpleNamespace(user=SimpleNamespace(id=1))

        def overview(db):
            read(db)
            return {"totals": {"on_hand_quantity": 0}}

        monkeypatch.setattr(factory_stream, "AsyncSessionLocal", async_sessionmaker(engine))
        monkeypatch.setattr(factory_stream, "read_auth_context", authenticate)
        monkeypatch.setattr(factory_stream, "factory_overview", overview)
        # Exercise a report built in the stream task as well as authentication.
        monkeypatch.setattr(factory_stream, "snapshot_frames", SnapshotFrames(capacity=0))

        async def read_stream(*, task_status=anyio.TASK_STATUS_IGNORED):
            with anyio.CancelScope() as scope:
                task_status.started(scope)
                await factory_stream.read_inventory(None, snapshot=phase == "snapshot")

        def write():
            with sqlite3.connect(path, timeout=0.2) as db:
                db.execute("UPDATE sample SET value = 1 WHERE id = 1")
            with sqlite3.connect(path) as db:
                assert db.execute("SELECT value FROM sample WHERE id = 1").fetchone() == (1,)

        try:
            async with anyio.create_task_group() as tasks:
                scope = await tasks.start(read_stream)
                assert await anyio.to_thread.run_sync(entered.wait, 1)
                scope.cancel()
                query_release.set()
            await anyio.to_thread.run_sync(write)
        finally:
            query_release.set()
            # Even a failed regression must not leave aiosqlite worker threads alive.
            with anyio.CancelScope(shield=True):
                for connection in connections:
                    await connection.close()
                await engine.dispose()

    anyio.run(run)


def test_request_session_waits_for_close_inside_cancelled_scope(monkeypatch):
    async def run():
        entered, release, closed = anyio.Event(), anyio.Event(), anyio.Event()

        class Session:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_):
                task = asyncio.create_task(self.close())
                await asyncio.shield(task)

            async def close(self):
                entered.set()
                await release.wait()
                closed.set()

        monkeypatch.setattr(database, "AsyncSessionLocal", Session)
        finished = anyio.Event()

        async def request(*, task_status=anyio.TASK_STATUS_IGNORED):
            with anyio.CancelScope() as scope:
                dependency = database.get_db()
                await anext(dependency)
                task_status.started(scope)
                try:
                    await anyio.sleep_forever()
                finally:
                    await dependency.aclose()
            finished.set()

        async with anyio.create_task_group() as tasks:
            scope = await tasks.start(request)
            scope.cancel()
            await entered.wait()
            try:
                # Closing the request must wait for the asynchronous DB cleanup.
                await anyio.sleep(0)
                assert not finished.is_set()
            finally:
                release.set()
        assert closed.is_set() and finished.is_set()

    anyio.run(run)
