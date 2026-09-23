"""Reuse material aggregates without changing stock amounts or pending counts."""

import pytest
from app.database import SessionLocal
from app.material_stock import BALANCE_KEYS, balance_dict, stock_table
from app.models import MaterialTransfer
from sqlalchemy import select
from test_transfer_list_loading import read_statements
from test_warehouse_classification import confirm, dispatch
from test_warehouse_receipts import intake, warehouse  # noqa: F401


def check_overview(client, team_id):
    with read_statements() as statements:
        response = client.get(f"/api/team-materials/{team_id}/overview")
    assert response.status_code == 200, response.text
    result = response.json()
    with SessionLocal() as db:
        lots = db.execute(select(stock_table(team_id))).mappings().all()
    expected = balance_dict({key: sum(row[key] or 0 for row in lots) for key in BALANCE_KEYS})
    assert result["totals"] == expected
    for dimension in ("materials", "material_types"):
        totals = balance_dict(
            {key: sum(row[key] for row in result[dimension]) for key in BALANCE_KEYS}
        )
        assert totals == expected
    assert len(statements) <= 6, len(statements)  # Includes authentication and team lookup.
    return result


@pytest.mark.parametrize("team_key", ["team", "other"])
def test_empty_overview_has_zero_balances_and_bounded_queries(client, warehouse, team_key):  # noqa: F811
    result = check_overview(client, warehouse[team_key]["id"])
    assert result["materials"] == result["material_types"] == []
    assert all(value == 0 for value in result["totals"].values())
    assert result["pending_incoming"] == {
        "count": 0,
        "quantity": 0,
        "weight": 0,
        **({"batch_count": 0} if team_key == "team" else {}),
    }


def test_reused_totals_preserve_scrap_decimal_precision_and_legacy_boundaries(client, warehouse):  # noqa: F811
    origins = []
    for index, (name, kind, quantity, weight) in enumerate(
        [
            ("铜钼 CuMo70", "semi_finished", 100, "1.125"),
            ("铜钼 CuMo70", "scrap_chips", 0, ".001"),
            ("钼片 Mo1", "raw_material", 3, ".004"),
            ("历史缺失材质", "finished", 1, ".001"),
        ]
    ):
        response = intake(
            client,
            warehouse,
            serial_no=f"SUMMARY-{index}",
            material_name=name,
            material_type=kind,
            quantity=quantity,
            weight=weight,
            idempotency_key=f"summary-{index}",
        )
        assert response.status_code == 201, response.text
        origins.append(response.json())
    legacy_response = client.post(
        "/api/material-transfers",
        headers=warehouse["other_headers"],
        json={
            "next_team_id": warehouse["team"]["id"],
            "serial_no": "LEGACY-SUMMARY",
            "material_type": "finished",
            "quantity": 100,
            "weight": 10,
            "idempotency_key": "legacy-summary",
        },
    )
    assert legacy_response.status_code == 201, legacy_response.text
    legacy = legacy_response.json()
    assert confirm(client, warehouse, {"items": [legacy]}).status_code == 200
    with SessionLocal() as db:
        db.get(MaterialTransfer, legacy["id"]).stock_tracked = False
        row = db.get(MaterialTransfer, origins[-1]["id"])
        row.material_name = row.material_type = None
        db.commit()
    sent = dispatch(
        client,
        warehouse,
        [
            {
                "source_transfer_id": origins[0]["id"],
                "quantity": 5,
                "weight": ".003",
            }
        ],
    ).json()
    exit_response = dispatch(
        client,
        warehouse,
        [
            {
                "source_transfer_id": origins[2]["id"],
                "quantity": 1,
                "weight": ".001",
            }
        ],
        next_team_id=None,
        entry_kind="warehouse_outbound",
        external_destination="外部单位",
        idempotency_key="summary-exit",
    )
    assert exit_response.status_code == 201, exit_response.text
    loss = client.post(
        f"/api/team-materials/{warehouse['team']['id']}/losses",
        headers=warehouse["headers"],
        json={
            "source_transfer_id": origins[0]["id"],
            "quantity": 1,
            "weight": ".001",
            "reason": "清点丢失",
            "idempotency_key": "summary-loss",
        },
    )
    assert loss.status_code == 201, loss.text
    result = check_overview(client, warehouse["team"]["id"])
    assert result["totals"]["on_hand_quantity"] == 97
    assert result["totals"]["on_hand_weight"] == 1.126
    assert result["totals"]["available_weight"] == 1.125
    assert result["totals"]["scrap_weight"] == 0.001
    assert result["legacy_received_count"] == 1
    assert any(row["material_name"] is None for row in result["materials"])
    assert any(row["material_type"] is None for row in result["material_types"])
    target = check_overview(client, warehouse["other"]["id"])
    assert target["pending_incoming"] == {"count": 1, "quantity": 5, "weight": 0.003}
    assert confirm(client, warehouse, sent, workshop=True).status_code == 200
    assert check_overview(client, warehouse["team"]["id"])["totals"]["on_hand_weight"] == 1.126
    target = check_overview(client, warehouse["other"]["id"])
    assert target["totals"]["on_hand_quantity"] == 5
    # Two independent batches on one submission are still two incoming batches.
    returned = dispatch(
        client,
        warehouse,
        [
            {"source_transfer_id": sent["items"][0]["id"], "quantity": 1, "weight": ".001"},
            {"source_transfer_id": sent["items"][0]["id"], "quantity": 1, "weight": ".001"},
        ],
        workshop=True,
    ).json()
    pending = check_overview(client, warehouse["team"]["id"])["pending_incoming"]
    assert pending == {"count": 2, "batch_count": 2, "quantity": 2, "weight": 0.002}
    assert confirm(client, warehouse, {"items": returned["items"][:1]}).status_code == 200
    pending = check_overview(client, warehouse["team"]["id"])["pending_incoming"]
    assert pending == {"count": 1, "batch_count": 1, "quantity": 1, "weight": 0.001}
    assert (
        client.delete(
            "/api/material-transfers/" + returned["items"][1]["batch_no"],
            headers=warehouse["other_headers"],
        ).status_code
        == 204
    )
    assert check_overview(client, warehouse["team"]["id"])["pending_incoming"]["count"] == 0
    assert check_overview(client, warehouse["other"]["id"])["totals"]["on_hand_quantity"] == 4
