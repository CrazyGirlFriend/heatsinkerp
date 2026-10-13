"""Sending employees are explicit, team-scoped snapshots, separate from audit actors."""

import pytest
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from app.database import SessionLocal
from app.models import MaterialTransfer
from sqlalchemy import create_engine, inspect
from test_external_outbound import outbound as outbound
from test_material_stock import receive_lot
from test_material_transfers import _setup_three_teams
from test_receiving_employee import employee
from test_warehouse_receipts import migration


def request_for(client, setup, kind):
    if kind == "direct":
        return (
            "/api/material-transfers",
            setup["source_headers"],
            setup["source"]["id"],
            {
                "serial_no": "SENDER-001",
                "next_team_id": setup["third"]["id"],
                "quantity": 12,
                "weight": 3,
                "idempotency_key": "sender-direct",
            },
        )
    lots = [receive_lot(client, setup, key=f"sender-lot-{i}") for i in range(2)]
    team_id = setup["target"]["id"]
    return (
        f"/api/team-materials/{team_id}/dispatches",
        setup["target_headers"],
        team_id,
        {
            "next_team_id": setup["third"]["id"],
            "idempotency_key": "sender-group",
            "lines": [
                {"source_transfer_id": lot["id"], "quantity": 10, "weight": 1} for lot in lots
            ],
        },
    )


def rows(response):
    body = response.json()
    return body.get("items", [body])


@pytest.mark.parametrize("kind", ["direct", "batch"])
def test_sender_snapshot_print_source_search_and_idempotency(client, kind):
    setup = _setup_three_teams(client)
    url, headers, team_id, payload = request_for(client, setup, kind)
    person = employee(client, team_id, "发送王师傅")
    payload["sent_employee_id"] = person["id"]
    response = client.post(url, headers=headers, json=payload)
    assert response.status_code == 201, response.text
    for row in rows(response):
        assert row["sent_employee_id"] == person["id"]
        assert row["sent_employee_name"] == "发送王师傅"
        assert row["created_by"] != row["sent_employee_name"]
        assert row["received_employee_id"] is None
        detail = client.get(f"/api/material-transfers/{row['batch_no']}").json()
        assert detail["history"][0]["changes"]["sent_employee_name"]["after"] == "发送王师傅"
    found = client.get("/api/material-transfers", params={"query": "发送王师傅"}).json()
    assert found["total"] == len(rows(response))
    renamed = client.patch(
        f"/api/team-materials/{team_id}/employees/{person['id']}",
        json={"name": "更名并停用", "active": False, "expected_version": person["version"]},
    )
    assert renamed.status_code == 200
    assert client.post(url, headers=headers, json=payload).json() == response.json()
    other = employee(client, team_id, "发送李师傅")
    changed = client.post(url, headers=headers, json={**payload, "sent_employee_id": other["id"]})
    assert changed.status_code == 409
    for row in rows(response):
        assert (
            client.get(f"/api/material-transfers/{row['batch_no']}").json()["sent_employee_name"]
            == "发送王师傅"
        )


@pytest.mark.parametrize("kind", ["direct", "batch"])
@pytest.mark.parametrize("invalid", ["missing", "zero", "unknown", "inactive", "other-team"])
def test_invalid_sender_leaves_no_document_or_stock_deduction(client, kind, invalid):
    setup = _setup_three_teams(client)
    url, headers, team_id, payload = request_for(client, setup, kind)
    if invalid in ("zero", "unknown"):
        payload["sent_employee_id"] = 0 if invalid == "zero" else 999999
    elif invalid in ("inactive", "other-team"):
        person = employee(
            client,
            setup["third"]["id"] if invalid == "other-team" else team_id,
            active=invalid != "inactive",
        )
        payload["sent_employee_id"] = person["id"]
    before = client.get(f"/api/team-materials/{team_id}/overview").json()["totals"]
    count = client.get("/api/material-transfers").json()["total"]
    response = client.post(url, headers=headers, json=payload)
    assert response.status_code == 422, response.text
    assert client.get(f"/api/team-materials/{team_id}/overview").json()["totals"] == before
    assert client.get("/api/material-transfers").json()["total"] == count


def test_external_shipment_records_selected_sender_and_account(client, outbound):
    s = outbound
    person = employee(client, s["team"]["id"], "发货李师傅")
    payload = {
        "sent_employee_id": person["id"],
        "entry_kind": s["kind"],
        "external_destination": "客户",
        "idempotency_key": "external-sender",
        "lines": [{"source_transfer_id": s["lots"][0]["id"], "quantity": 1, "weight": 0.1}],
    }
    response = client.post(s["url"] + "/dispatches", headers=s["headers"], json=payload)
    assert response.status_code == 201, response.text
    row = rows(response)[0]
    assert row["sent_employee_name"] == "发货李师傅"
    assert row["status"] == "dispatched"
    assert row["created_by"] == row["dispatched_by"] != "发货李师傅"


def test_selected_sender_does_not_grant_permissions(client):
    s = _setup_three_teams(client)
    url, headers, team_id, payload = request_for(client, s, "batch")
    payload["sent_employee_id"] = employee(client, team_id)["id"]
    assert client.post(url, json=payload).status_code == 403
    assert client.post(url, headers=s["third_headers"], json=payload).status_code == 403
    assert client.post(url, headers=headers, json=payload).status_code == 201


def test_old_sender_identity_is_not_invented(client):
    from test_material_transfers import _create

    row = _create(client, _setup_three_teams(client)).json()
    with SessionLocal.begin() as db:
        record = db.get(MaterialTransfer, row["id"])
        record.sent_employee_id = record.sent_employee_name = None
    detail = client.get(f"/api/material-transfers/{row['batch_no']}").json()
    assert detail["sent_employee_name"] is None
    assert detail["sent_employee_id"] is None
    assert detail["created_by"] == row["created_by"]


def test_sender_migration_preserves_history_and_replays():
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE team_employees (id INTEGER PRIMARY KEY)")
        connection.exec_driver_sql(
            "CREATE TABLE material_transfers (id INTEGER PRIMARY KEY, created_by VARCHAR(80))"
        )
        connection.exec_driver_sql("INSERT INTO material_transfers VALUES (1, '原操作账号')")
        with Operations.context(MigrationContext.configure(connection)):
            module = migration("20261013_0037_sending_employee.py")
            module.upgrade()
            module.upgrade()
        row = connection.exec_driver_sql("SELECT * FROM material_transfers").mappings().one()
        assert row["created_by"] == "原操作账号"
        assert row["sent_employee_id"] is None and row["sent_employee_name"] is None
        assert len(inspect(connection).get_foreign_keys("material_transfers")) == 1
    engine.dispose()
