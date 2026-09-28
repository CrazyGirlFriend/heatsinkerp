"""Keep the isolated load-test oracle aligned with the business ledger."""
import importlib.util
from decimal import Decimal
from pathlib import Path

import pytest

from app.database import SessionLocal
from test_warehouse_receipts import warehouse, intake  # noqa: F401
from test_warehouse_classification import dispatch, confirm
from test_quantity_adjustments import change

spec = importlib.util.spec_from_file_location(
    "capacity_harness", Path(__file__).parents[2] / "scripts/verify_mysql_http_concurrency.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_load_harness_rejects_production_environment(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    with pytest.raises(RuntimeError, match="isolated capacity database"):
        module.Harness()


def test_oracle_counts_processing_and_pending_without_double_counting(client, warehouse):
    s = warehouse
    lot = intake(client, s, quantity=10, weight=100).json()
    assert change(client, s, lot, 100).status_code == 201
    outgoing = dispatch(client, s, [{"source_transfer_id": lot["id"], "quantity": 30, "weight": 30}]).json()
    qa = object.__new__(module.Harness)
    qa.Session = SessionLocal
    qa.teams = [s["team"]["id"], s["other"]["id"]]
    qa.actors = [{"team": None}] + [{"team": team} for team in qa.teams]

    def request(actor, path):
        response = client.get(path)
        assert response.status_code == 200
        return response.status_code, response.json()

    qa.request = request
    assert qa.balances()[0][lot["id"]] == [70, Decimal(70)]
    assert qa.reconcile()["quantity"] == 100
    assert qa.reconcile()["weight"] == 100
    assert confirm(client, s, outgoing, workshop=True).status_code == 200
    assert qa.reconcile()["quantity"] == 100
    external = dispatch(client, s, [{"source_transfer_id": lot["id"], "quantity": 10, "weight": 10}],
        next_team_id=None, entry_kind="warehouse_outbound", external_destination="隔离验证", idempotency_key="external").json()
    assert external['items'][0]['status'] == 'dispatched'
    assert qa.reconcile()["quantity"] == 90
