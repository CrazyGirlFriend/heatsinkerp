"""Cleanup regression: old routes stay removed, current access/data stay safe."""

import ast
import sys
from pathlib import Path

import pytest
from app.database import Base, SessionLocal
from app.main import app
from app.models import LegacyRecord
from test_material_transfers import _leader, _team


@pytest.mark.parametrize(
    ("method", "path", "contract_path"),
    [
        ("GET", "/api/factory-dashboard", "/api/factory-dashboard"),
        ("GET", "/api/factory-dashboard/serials", "/api/factory-dashboard/serials"),
        ("GET", "/api/factory-dashboard/shipments", "/api/factory-dashboard/shipments"),
        ("GET", "/api/factory-dashboard/delivery-plan", "/api/factory-dashboard/delivery-plan"),
        ("PUT", "/api/factory-dashboard/delivery-plan", "/api/factory-dashboard/delivery-plan"),
        ("GET", "/api/factory-dashboard/yields", "/api/factory-dashboard/yields"),
        ("GET", "/api/factory-dashboard/team-yields", "/api/factory-dashboard/team-yields"),
        ("GET", "/api/factory-dashboard/stock-detail", "/api/factory-dashboard/stock-detail"),
        ("GET", "/api/factory-dashboard/deliveries", "/api/factory-dashboard/deliveries"),
        (
            "GET",
            "/api/team-materials/1/warehouse-inventory",
            "/api/team-materials/{team_id}/warehouse-inventory",
        ),
        (
            "GET",
            "/api/team-materials/1/warehouse-inventory/1/sources",
            "/api/team-materials/{team_id}/warehouse-inventory/{group_id}/sources",
        ),
        (
            "GET",
            "/api/process-routes/1/rework-rounds",
            "/api/process-routes/{route_id}/rework-rounds",
        ),
    ],
)
def test_retired_read_paths_are_unregistered(client, method, path, contract_path):
    assert contract_path not in app.openapi()["paths"]
    assert client.request(method, path).status_code == 404


def test_successful_json_responses_have_explicit_contracts():
    # These retained compatibility endpoints always reject writes (410 / 422).
    disabled_writes = {
        ("post", "/api/production-schedules"),
    }
    missing = []
    for path, methods in app.openapi()["paths"].items():
        for method, operation in methods.items():
            if (method, path) in disabled_writes:
                continue
            for status, response in operation.get("responses", {}).items():
                content = response.get("content", {})
                if not status.startswith("2") or "application/json" not in content:
                    continue
                schema = content["application/json"]["schema"]
                if not any(key in schema for key in ("$ref", "properties", "items", "anyOf")):
                    missing.append(f"{method.upper()} {path}: {schema}")
    assert not missing, "Declare a response model:\n" + "\n".join(missing)


def test_only_supported_business_routes_are_registered(client):
    paths = set(app.openapi()["paths"])
    assert "/api/process-routes/options/{team_id}" not in paths
    supported_prefixes = (
        "/api/access/",
        "/api/auth/",
        "/api/health",
        "/api/teams",
        "/api/team-directory",
        "/api/warehouse-locations",
        "/api/accounts",
        "/api/users",
        "/api/material-transfers",
        "/api/material-trace",
        "/api/serial-inventory",
        "/api/material-input-suggestions",
        "/api/material-dispatches",
        "/api/receipt-documents/",
        "/api/transfer-amendments/",
        "/api/team-materials/",
        "/api/inspections",
        "/api/quality-feedback",
        "/api/production-schedules",
        "/api/process-routes",
        "/api/factory-overview",
        "/api/factory-performance",
        "/api/main-system/",
        "/api/notifications/",
    )
    unexpected = sorted(path for path in paths if not path.startswith(supported_prefixes))
    assert not unexpected, unexpected
    for method, path in (
        ("GET", "/api/process-routes/options/1"),
        ("GET", "/api/business-notices"),
        ("GET", "/api/rework-notices"),
        ("GET", "/api/schedule-notices"),
        ("POST", "/api/schedule-notices/refresh"),
        ("POST", "/api/business-notices/read-all"),
        ("GET", "/api/work-orders"),
        ("POST", "/api/work-orders"),
        ("GET", "/api/products"),
        ("POST", "/api/products"),
        ("GET", "/api/team-production"),
        ("GET", "/api/transfer-batches"),
        ("POST", "/api/transfer-batches"),
        ("POST", "/api/scan/receive"),
        ("GET", "/api/scan/OLD-ORDER"),
        ("POST", "/api/work-orders/1/operations/1/report"),
        ("POST", "/api/work-orders/1/operations/1/exceptions"),
    ):
        response = client.request(method, path, json={} if method == "POST" else None)
        assert response.status_code == 404, (method, path, response.text)
    for module in (
        "batch_workflow",
        "transfer_batch_workflow",
        "quantity_ledger",
        "team_production",
    ):
        assert f"app.{module}" not in sys.modules


def test_remaining_modules_have_no_deleted_local_imports():
    directory = Path(__file__).parents[1] / "app"
    for file in directory.glob("*.py"):
        for node in ast.walk(ast.parse(file.read_text())):
            if isinstance(node, ast.ImportFrom) and node.level == 1:
                names = (
                    [node.module.split(".")[0]]
                    if node.module
                    else [item.name for item in node.names]
                )
                for name in names:
                    assert (directory / f"{name}.py").exists(), (file.name, name)


@pytest.mark.parametrize(
    "field",
    [
        "responsible_team_id",
        "scrap_destination_team_id",
        "operator_team_id",
        "source_team_id",
        "next_team_id",
        "created_by_team_id",
        "destination_team_id",
        "printed_by_team_id",
        "actor_team_id",
    ],
)
def test_archived_references_remain_protected(client, field):
    assert "legacy_records" in Base.metadata.tables
    assert "work_orders" not in Base.metadata.tables
    team = _team(client, "HISTORY-ONLY", "有历史记录的班组")
    data = {"id": 42, field: team["id"], "name": "历史原记录"}
    with SessionLocal() as db:
        db.add(LegacyRecord(source_table="operations", source_id=42, data=data))
        db.commit()
    assert client.delete(f"/api/teams/{team['id']}").status_code == 409
    assert client.patch(f"/api/teams/{team['id']}", json={"kind": "warehouse"}).status_code == 409
    with SessionLocal() as db:
        assert db.get(LegacyRecord, ("operations", 42)).data == data
    unrelated = _team(client, "NO-HISTORY", "没有历史记录的班组")
    assert client.delete(f"/api/teams/{unrelated['id']}").status_code == 204


def test_authentication_and_last_administrator_guards_remain(client):
    admin = client.get("/api/auth/me").json()
    assert client.patch(f"/api/accounts/{admin['id']}", json={"active": False}).status_code == 409
    assert client.patch(f"/api/accounts/{admin['id']}", json={"role": "TEAM"}).status_code == 409
    assert client.delete(f"/api/accounts/{admin['id']}").status_code == 409
    assert (
        client.post(
            "/api/accounts",
            json={
                "username": "extra-admin",
                "display_name": "x",
                "password": "Admin123!",
                "role": "ADMIN",
            },
        ).status_code
        == 422
    )
    assert (
        client.post("/api/auth/login", json={"username": "admin", "password": "wrong"}).status_code
        == 401
    )
    assert client.post("/api/auth/logout").status_code == 204
    for path in (
        "/api/auth/me",
        "/api/material-transfers",
        "/api/accounts",
        "/api/team-materials/1/overview",
    ):
        assert client.get(path).status_code == 401


def test_leader_permissions_password_reset_and_directory_crud_remain(client):
    first = _team(client, "CORE-A", "本期班组A")
    second = _team(client, "CORE-B", "本期班组B")
    leader, headers = _leader(client, "core-leader", first["id"])
    assert client.get("/api/team-directory", headers=headers).status_code == 200
    assert client.get("/api/accounts", headers=headers).status_code == 403
    assert (
        client.post("/api/teams", headers=headers, json={"code": "NO", "name": "NO"}).status_code
        == 403
    )
    assert client.delete(f"/api/teams/{first['id']}").status_code == 409
    assert (
        client.patch(f"/api/accounts/{leader['id']}", json={"team_id": second["id"]}).status_code
        == 200
    )
    assert client.get("/api/auth/me", headers=headers).json()["team_id"] == second["id"]
    assert (
        client.patch(
            f"/api/accounts/{leader['id']}", json={"password": "Replacement123!"}
        ).status_code
        == 200
    )
    assert client.get("/api/auth/me", headers=headers).status_code == 401
    assert (
        client.post(
            "/api/auth/login", json={"username": "core-leader", "password": "Leader123!"}
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/api/auth/login", json={"username": "core-leader", "password": "Replacement123!"}
        ).status_code
        == 200
    )
    assert client.delete(f"/api/teams/{first['id']}").status_code == 204
    assert client.delete(f"/api/accounts/{leader['id']}").status_code == 204
    assert client.delete(f"/api/teams/{second['id']}").status_code == 204
