"""Factory material/grade matrix stays consistent with physical team inventory."""

import pytest
from app.database import SessionLocal
from app.models import MaterialTransfer, Team
from test_external_outbound import confirm, dispatch
from test_external_outbound import outbound as outbound
from test_factory_overview import report
from test_warehouse_receipts import intake
from test_warehouse_receipts import warehouse as warehouse


def assert_totals(data):
    matrix = data["stock_matrix"]
    assert len(matrix["rows"]) == 8
    for unit in ("quantity", "weight"):
        assert matrix["total"][unit] == pytest.approx(data["totals"][f"on_hand_{unit}"])
        assert sum(row[unit] for row in matrix["materials"]) == pytest.approx(matrix["total"][unit])
        assert sum(
            row["total"][unit] for row in matrix["rows"] if row["total"] is not None
        ) == pytest.approx(matrix["total"][unit])
        for row in matrix["rows"]:
            if row["total"] is not None:
                assert sum(value[unit] for value in row["amounts"].values()) == pytest.approx(
                    row["total"][unit]
                )
    return matrix


def test_matrix_exact_grades_weight_only_scrap_and_more_than_eight_materials(client, warehouse):
    for index, (name, kind, quantity, weight) in enumerate(
        [
            ("铜钼 CuMo70", "semi_finished", 10, "1.125"),
            ("铜钼 CuMo70", "waste", 0, "0.250"),
            ("铜钼 CuMo50", "finished", 3, "0.005"),
            *[(f"材质-{n:02}", "raw_material", 1, "0.001") for n in range(10)],
        ]
    ):
        response = intake(
            client,
            warehouse,
            serial_no=f"MATRIX-{index}",
            material_name=name,
            material_type=kind,
            quantity=quantity,
            weight=weight,
            idempotency_key=f"matrix-{index}",
        )
        assert response.status_code == 201, response.text
    matrix = assert_totals(report(client))
    assert len(matrix["materials"]) == 12
    assert [row["name"] for row in matrix["materials"]] == sorted(
        row["name"] for row in matrix["materials"]
    )
    row = matrix["rows"][0]
    assert row["amounts"]["铜钼 CuMo70"] == {"quantity": 10, "weight": 1.375}
    assert row["amounts"]["铜钼 CuMo50"] == {"quantity": 3, "weight": 0.005}
    assert row["total"] == {"quantity": 23, "weight": 1.39}


def test_matrix_excludes_in_transit_and_moves_only_confirmed_stock_to_destination(client, outbound):
    response = dispatch(
        client,
        outbound,
        entry_kind="transfer",
        external_destination=None,
        next_team_id=outbound["other"]["id"],
    )
    assert response.status_code == 201, response.text
    matrix = assert_totals(report(client))
    source = next(row for row in matrix["rows"] if row["team_id"] == outbound["team"]["id"])
    target = next(row for row in matrix["rows"] if row["team_id"] == outbound["other"]["id"])
    assert source["total"] == {"quantity": 140, "weight": 14}
    assert target["total"] == {"quantity": 0, "weight": 0}
    first, second = response.json()["items"]
    assert (
        client.post(
            f"/api/material-transfers/{first['batch_no']}/confirm",
            headers=outbound["other_headers"],
            json={"idempotency_key": "matrix-receive"},
        ).status_code
        == 200
    )
    assert (
        client.delete(
            f"/api/material-transfers/{second['batch_no']}", headers=outbound["headers"]
        ).status_code
        == 204
    )
    matrix = assert_totals(report(client))
    assert matrix["total"] == {"quantity": 200, "weight": 20}
    assert next(row for row in matrix["rows"] if row["team_id"] == target["team_id"])["total"] == {
        "quantity": 30,
        "weight": 3,
    }


def test_matrix_external_dispatch_confirmation_and_loss_do_not_double_deduct(client, outbound):
    group = dispatch(client, outbound).json()
    assert assert_totals(report(client))["total"] == {"quantity": 140, "weight": 14}
    for line in group["items"]:
        assert confirm(client, outbound, line).status_code == 200
    assert assert_totals(report(client))["total"] == {"quantity": 140, "weight": 14}
    response = client.post(
        outbound["url"] + "/losses",
        headers=outbound["headers"],
        json={
            "source_transfer_id": outbound["lots"][0]["id"],
            "quantity": 1,
            "weight": "0.125",
            "reason": "清点丢失",
            "idempotency_key": "matrix-loss",
        },
    )
    assert response.status_code == 201, response.text
    assert assert_totals(report(client))["total"] == {"quantity": 139, "weight": 13.875}


def test_matrix_missing_and_disabled_teams_unknown_grade_and_legacy(client, warehouse):
    empty = assert_totals(report(client))
    assert empty["materials"] == [] and empty["total"] == {"quantity": 0, "weight": 0}
    assert empty["rows"][0]["total"] == {"quantity": 0, "weight": 0}
    assert empty["rows"][1]["total"] is None
    lots = [intake(client, warehouse, idempotency_key=f"unknown-{i}").json() for i in range(2)]
    with SessionLocal() as db:
        db.get(Team, warehouse["team"]["id"]).active = False
        db.get(MaterialTransfer, lots[0]["id"]).material_name = "  "
        legacy = db.get(MaterialTransfer, lots[1]["id"])
        legacy.entry_kind = "transfer"
        legacy.source_team_id = warehouse["other"]["id"]
        legacy.source_team_code = warehouse["other"]["code"]
        legacy.source_team_name = warehouse["other"]["name"]
        legacy.stock_tracked = False
        db.commit()
    matrix = assert_totals(report(client))
    assert matrix["rows"][0]["active"] is False
    assert matrix["materials"] == [{"name": "未填写材质", "quantity": 100, "weight": 10.125}]
