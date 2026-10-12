"""Actual receivers are roster members, independent from login/audit accounts."""

import pytest
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from app.database import SessionLocal
from app.models import MaterialTransfer, TeamEmployee
from sqlalchemy import create_engine, inspect
from test_dispatch_batches import internal_dispatch
from test_material_stock import receive_lot
from test_material_stock import stock_setup as stock_setup
from test_material_transfers import _create, _setup_three_teams
from test_warehouse_receipts import migration


def employee(client, team_id, name="王师傅", active=True):
    result = client.post(
        f"/api/team-materials/{team_id}/employees", json={"name": name, "active": active}
    )
    assert result.status_code == 201, result.text
    return result.json()


def test_receiver_snapshot_account_and_receipt_ledger(client):
    s = _setup_three_teams(client)
    person = employee(client, s["target"]["id"])
    row = _create(client, s).json()
    url = f"/api/material-transfers/{row['batch_no']}"
    payload = {
        "idempotency_key": "receive-person",
        "received_employee_id": person["id"],
        "expected_version": row["version"],
    }
    response = client.post(url + "/confirm", headers=s["target_headers"], json=payload)
    assert response.status_code == 200, response.text
    done = response.json()
    assert done["received_employee_id"] == person["id"]
    assert done["received_employee_name"] == "王师傅"
    assert done["received_by_user_id"] == s["target_user"]["id"]
    assert done["received_by"] == s["target_user"]["display_name"]
    assert done["received_at"]
    assert done["history"][-1]["actor"] == s["target_user"]["display_name"]
    assert done["history"][-1]["changes"]["received_employee_name"] == {
        "before": None,
        "after": "王师傅",
    }
    ledger = client.get(f"/api/team-materials/{s['target']['id']}/receipts").json()
    assert ledger["items"][0]["received_employee_name"] == "王师傅"

    renamed = client.patch(
        f"/api/team-materials/{s['target']['id']}/employees/{person['id']}",
        json={"name": "王师傅新姓名", "active": False, "expected_version": person["version"]},
    )
    assert renamed.status_code == 200, renamed.text
    assert client.get(url).json()["received_employee_name"] == "王师傅"
    retry = client.post(url + "/confirm", headers=s["target_headers"], json=payload)
    assert retry.status_code == 200 and retry.json() == done
    other = employee(client, s["target"]["id"], "李师傅")
    mismatch = client.post(
        url + "/confirm",
        headers=s["target_headers"],
        json={**payload, "received_employee_id": other["id"]},
    )
    assert mismatch.status_code == 409
    assert client.get(url).json()["received_employee_name"] == "王师傅"


@pytest.mark.parametrize("invalid", ["missing", "zero", "unknown", "inactive", "other-team"])
def test_invalid_receiver_cannot_sign_or_change_stock(client, invalid):
    s = _setup_three_teams(client)
    row = _create(client, s).json()
    payload = {"idempotency_key": "bad-receiver"}
    if invalid in ("zero", "unknown"):
        payload["received_employee_id"] = 0 if invalid == "zero" else 999999
    elif invalid in ("inactive", "other-team"):
        person = employee(
            client,
            s["source" if invalid == "other-team" else "target"]["id"],
            active=invalid != "inactive",
        )
        payload["received_employee_id"] = person["id"]
    response = client.post(
        f"/api/material-transfers/{row['batch_no']}/confirm",
        headers=s["target_headers"],
        json=payload,
    )
    assert response.status_code == 422, response.text
    fresh = client.get(f"/api/material-transfers/{row['batch_no']}").json()
    assert fresh["status"] == "pending" and fresh["version"] == row["version"]
    assert fresh["received_employee_name"] is None and fresh["received_at"] is None
    assert len(fresh["history"]) == 1
    assert client.get(f"/api/team-materials/{s['target']['id']}/receipts").json()["total"] == 0


def test_receiver_selection_does_not_grant_account_permission(client):
    s = _setup_three_teams(client)
    person = employee(client, s["target"]["id"])
    row = _create(client, s).json()
    for headers in ({}, s["source_headers"], s["third_headers"]):
        response = client.post(
            f"/api/material-transfers/{row['batch_no']}/confirm",
            headers=headers,
            json={"idempotency_key": "wrong-account", "received_employee_id": person["id"]},
        )
        assert response.status_code == 403


def test_historical_group_requires_receiver_and_preserves_completed_lines(client, stock_setup):
    s = stock_setup
    person = employee(client, s["third"]["id"])
    old_person = employee(client, s["third"]["id"], "李师傅")
    lots = [receive_lot(client, s, key=f"receiver-{i}") for i in range(2)]
    group = internal_dispatch(
        client, s, [{"source_transfer_id": lot["id"], "quantity": 10, "weight": 1} for lot in lots]
    ).json()
    first = group["items"][0]
    first_done = client.post(
        f"/api/material-transfers/{first['batch_no']}/confirm",
        headers=s["third_headers"],
        json={"idempotency_key": "first-only", "received_employee_id": old_person["id"]},
    )
    assert first_done.status_code == 200, first_done.text
    url = f"/api/material-dispatches/{group['dispatch_no']}"
    fresh = client.get(url).json()
    payload = {"idempotency_key": "receive-group", "expected_revision": fresh["revision"]}
    assert (
        client.post(url + "/confirm", headers=s["third_headers"], json=payload).status_code == 422
    )
    payload["received_employee_id"] = person["id"]
    response = client.post(url + "/confirm", headers=s["third_headers"], json=payload)
    assert response.status_code == 200, response.text
    assert [line["received_employee_name"] for line in response.json()["items"]] == [
        "李师傅",
        "王师傅",
    ]
    with SessionLocal.begin() as db:
        db.get(TeamEmployee, person["id"]).active = False
    assert (
        client.post(url + "/confirm", headers=s["third_headers"], json=payload).json()
        == response.json()
    )
    assert (
        client.post(
            url + "/confirm",
            headers=s["third_headers"],
            json={**payload, "received_employee_id": old_person["id"]},
        ).status_code
        == 409
    )


def test_historical_receipts_do_not_invent_an_employee(client):
    s = _setup_three_teams(client)
    row = _create(client, s).json()
    with SessionLocal.begin() as db:
        record = db.get(MaterialTransfer, row["id"])
        record.status = "received"
        record.received_by = "旧班组长账号"
    result = client.get(f"/api/material-transfers/{row['batch_no']}").json()
    assert result["received_employee_name"] is None and result["received_employee_id"] is None
    assert result["received_by"] == "旧班组长账号"


def test_receiving_employee_migration_keeps_legacy_data_and_replays():
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE team_employees (id INTEGER PRIMARY KEY)")
        connection.exec_driver_sql(
            "CREATE TABLE material_transfers (id INTEGER PRIMARY KEY, received_by VARCHAR(80))"
        )
        connection.exec_driver_sql("INSERT INTO material_transfers VALUES (1, '历史操作账号')")
        with Operations.context(MigrationContext.configure(connection)):
            module = migration("20261012_0036_receiving_employee.py")
            module.upgrade()
            module.upgrade()
        row = connection.exec_driver_sql("SELECT * FROM material_transfers").mappings().one()
        assert row["received_by"] == "历史操作账号"
        assert row["received_employee_id"] is None and row["received_employee_name"] is None
        assert len(inspect(connection).get_foreign_keys("material_transfers")) == 1
    engine.dispose()
