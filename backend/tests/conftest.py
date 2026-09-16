import os

import pytest
from fastapi.testclient import TestClient


# Configuration must be in place before app.database creates its global engine.
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["AUTO_CREATE_TABLES"] = "true"

from app.database import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture()
def client():
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
