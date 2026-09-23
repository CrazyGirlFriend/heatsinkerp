import os
import asyncio
from tempfile import TemporaryDirectory

import pytest
from fastapi.testclient import TestClient


# Configuration must be in place before app.database creates its global engine.
_test_database = TemporaryDirectory(prefix="heatsink-async-tests-")
os.environ["DATABASE_URL"] = "sqlite:///" + _test_database.name + "/test.sqlite"
os.environ["AUTO_CREATE_TABLES"] = "true"

from app.database import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture()
def client(monkeypatch):
    from app import factory_stream
    from app.inventory_snapshots import SnapshotFrames
    monkeypatch.setattr(factory_stream, "snapshot_frames", SnapshotFrames())
    from app import notification_queue
    from app.inventory_events import InventoryChange, inventory_events

    class TestTransport:
        """Unit transport double; real RabbitMQ is covered by integration probes."""
        ready = True

        async def publish(self, message_id, payload):
            inventory_events.publish(InventoryChange.from_envelope(payload))

        async def run(self):
            await asyncio.Event().wait()

    monkeypatch.setattr(notification_queue, "RabbitTransport", TestTransport)

    class TestNotificationService(notification_queue.NotificationService):
        async def start(self):
            pass

    class QueueTestClient(TestClient):
        def request(self, *args, **kwargs):
            result = super().request(*args, **kwargs)
            self.drain_notifications()
            return result

        def drain_notifications(self):
            # Deterministic unit delivery avoids SQLite's database-wide writer
            # locks. Real concurrent pumping uses MySQL in the integration probe.
            async def drain():
                while await app.state.notifications.send_batch():
                    pass
            self.portal.call(drain)

    monkeypatch.setattr(notification_queue, "NotificationService", TestNotificationService)
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with QueueTestClient(app) as test_client:
        login = test_client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "Admin123!"},
        )
        assert login.status_code == 200, login.text
        test_client.headers.update(
            {"Authorization": f"Bearer {login.json()['access_token']}"}
        )
        yield test_client
