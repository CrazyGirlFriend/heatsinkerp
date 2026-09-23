import os

import pytest
from fastapi.testclient import TestClient


# Configuration must be in place before app.database creates its global engine.
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["AUTO_CREATE_TABLES"] = "true"

from app.database import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture()
def client(monkeypatch):
    # Each fixture replaces the entire database outside the ORM event stream.
    # It must also replace process-local read caches, just like a new service.
    from app import factory_stream, team_read_snapshots
    from app.inventory_snapshots import SnapshotFrames
    monkeypatch.setattr(factory_stream, "snapshot_frames", SnapshotFrames())
    monkeypatch.setattr(team_read_snapshots, "team_read_frames", SnapshotFrames(views=None, capacity=64))
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with TestClient(app) as test_client:
        login = test_client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "Admin123!"},
        )
        assert login.status_code == 200, login.text
        test_client.headers.update(
            {"Authorization": f"Bearer {login.json()['access_token']}"}
        )
        yield test_client
