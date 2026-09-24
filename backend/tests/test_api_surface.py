"""Cleanup regression: old routes stay removed, current access/data stay safe."""
from pathlib import Path
import ast
import sys

from sqlalchemy import select

from app.main import app
from app.database import Base, SessionLocal
from app.legacy_models import Product, ProductRouteOperation
from test_material_transfers import _team, _leader


def test_only_supported_business_routes_are_registered(client):
    paths = set(app.openapi()["paths"])
    supported_prefixes = ("/api/access/", "/api/auth/", "/api/health", "/api/teams",
                          "/api/team-directory", "/api/accounts", "/api/users",
                          "/api/material-transfers", "/api/material-trace", "/api/material-dispatches", "/api/team-materials/",
                          "/api/factory-overview", "/api/serial-urgency", "/api/main-system/", "/api/notifications/")
    assert all(path.startswith(supported_prefixes) for path in paths), paths
    for method, path in (
        ("GET", "/api/work-orders"), ("POST", "/api/work-orders"),
        ("GET", "/api/products"), ("POST", "/api/products"),
        ("GET", "/api/team-production"), ("GET", "/api/transfer-batches"),
        ("POST", "/api/transfer-batches"), ("POST", "/api/scan/receive"),
        ("GET", "/api/scan/OLD-ORDER"),
        ("POST", "/api/work-orders/1/operations/1/report"),
        ("POST", "/api/work-orders/1/operations/1/exceptions"),
    ):
        response = client.request(method, path, json={} if method == "POST" else None)
        assert response.status_code == 404, (method, path, response.text)
    for module in ("batch_workflow", "transfer_batch_workflow", "quantity_ledger", "team_production"):
        assert f"app.{module}" not in sys.modules


def test_remaining_modules_have_no_deleted_local_imports():
    directory = Path(__file__).parents[1] / "app"
    for file in directory.glob("*.py"):
        for node in ast.walk(ast.parse(file.read_text())):
            if isinstance(node, ast.ImportFrom) and node.level == 1:
                names = [node.module.split('.')[0]] if node.module else [item.name for item in node.names]
                for name in names:
                    assert (directory / f"{name}.py").exists(), (file.name, name)


def test_history_table_metadata_and_references_remain_protected(client):
    assert {"work_orders", "operations", "operation_reports", "transfer_batches", "transfer_batch_lines",
            "products", "product_route_operations", "external_inventory_movements"} <= Base.metadata.tables.keys()
    team = _team(client, "HISTORY-ONLY", "有历史记录的班组")
    with SessionLocal() as db:
        product = Product(code="HIST-P", name="保留的历史产品", route_operations=[
            ProductRouteOperation(sequence=1, code="HIST", name="历史工序", responsible_team_id=team["id"])
        ])
        db.add(product)
        db.commit()
        product_id = product.id
    assert client.delete(f"/api/teams/{team['id']}").status_code == 409
    assert client.patch(f"/api/teams/{team['id']}", json={"kind": "warehouse"}).status_code == 409
    with SessionLocal() as db:
        assert db.get(Product, product_id).name == "保留的历史产品"
        assert db.scalar(select(ProductRouteOperation.responsible_team_id)) == team["id"]


def test_authentication_and_last_administrator_guards_remain(client):
    admin = client.get("/api/auth/me").json()
    assert client.patch(f"/api/accounts/{admin['id']}", json={"active": False}).status_code == 409
    assert client.patch(f"/api/accounts/{admin['id']}", json={"role": "TEAM"}).status_code == 409
    assert client.delete(f"/api/accounts/{admin['id']}").status_code == 409
    assert client.post("/api/accounts", json={"username": "extra-admin", "display_name": "x", "password": "Admin123!", "role": "ADMIN"}).status_code == 422
    assert client.post("/api/auth/login", json={"username": "admin", "password": "wrong"}).status_code == 401
    assert client.post("/api/auth/logout").status_code == 204
    for path in ("/api/auth/me", "/api/material-transfers", "/api/accounts", "/api/team-materials/1/overview"):
        assert client.get(path).status_code == 401


def test_leader_permissions_password_reset_and_directory_crud_remain(client):
    first = _team(client, "CORE-A", "本期班组A")
    second = _team(client, "CORE-B", "本期班组B")
    leader, headers = _leader(client, "core-leader", first["id"])
    assert client.get("/api/team-directory", headers=headers).status_code == 200
    assert client.get("/api/accounts", headers=headers).status_code == 403
    assert client.post("/api/teams", headers=headers, json={"code": "NO", "name": "NO"}).status_code == 403
    assert client.delete(f"/api/teams/{first['id']}").status_code == 409
    assert client.patch(f"/api/accounts/{leader['id']}", json={"team_id": second["id"]}).status_code == 200
    assert client.get("/api/auth/me", headers=headers).json()["team_id"] == second["id"]
    assert client.patch(f"/api/accounts/{leader['id']}", json={"password": "Replacement123!"}).status_code == 200
    assert client.get("/api/auth/me", headers=headers).status_code == 401
    assert client.post("/api/auth/login", json={"username": "core-leader", "password": "Leader123!"}).status_code == 401
    assert client.post("/api/auth/login", json={"username": "core-leader", "password": "Replacement123!"}).status_code == 200
    assert client.delete(f"/api/teams/{first['id']}").status_code == 204
    assert client.delete(f"/api/accounts/{leader['id']}").status_code == 204
    assert client.delete(f"/api/teams/{second['id']}").status_code == 204
