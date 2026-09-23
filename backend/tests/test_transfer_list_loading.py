"""List reads must not expand the source chain or load document history."""

from contextlib import contextmanager

import pytest
from app.database import SessionLocal, async_engine, engine
from app.material_transfer_workflow import material_transfer_dict, material_transfer_list_options
from app.models import MaterialDispatch, MaterialTransfer
from app.schemas import MaterialTransferResponse
from sqlalchemy import event, inspect, select
from test_warehouse_classification import confirm, dispatch
from test_warehouse_receipts import intake, warehouse  # noqa: F401


@contextmanager
def read_statements():
    statements = []

    def capture(_connection, _cursor, statement, _parameters, _context, _many):
        if (
            statement.lstrip().upper().startswith("SELECT")
            and "notification_outbox" not in statement
        ):
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture)
    event.listen(async_engine.sync_engine, "before_cursor_execute", capture)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", capture)
        event.remove(async_engine.sync_engine, "before_cursor_execute", capture)


@pytest.fixture()
def list_scenario(client, warehouse):  # noqa: F811
    origins = []
    for index in range(2):
        response = intake(
            client, warehouse, serial_no=f"00000{index + 1}", idempotency_key=f"list-origin-{index}"
        )
        assert response.status_code == 201, response.text
        origins.append(response.json())
    response = dispatch(
        client,
        warehouse,
        [
            {"source_transfer_id": origins[index % 2]["id"], "quantity": 3, "weight": ".300"}
            for index in range(12)
        ],
    )
    assert response.status_code == 201, response.text
    sent = response.json()
    assert confirm(client, warehouse, sent, workshop=True).status_code == 200
    response = dispatch(
        client,
        warehouse,
        [
            {"source_transfer_id": item["id"], "quantity": 1, "weight": ".100"}
            for item in sent["items"]
        ],
        workshop=True,
    )
    assert response.status_code == 201, response.text
    returned = response.json()
    assert confirm(client, warehouse, {"items": returned["items"][:6]}).status_code == 200
    # Keep a historical grouped document in the fixture without issuing new CK numbers.
    with SessionLocal() as db:
        submission = db.get(
            MaterialDispatch, db.get(MaterialTransfer, sent["items"][0]["id"]).dispatch_id
        )
        submission.dispatch_no = "CK-LEGACY-LIST"
        db.commit()
    response = client.put(
        "/api/serial-urgency",
        json={
            "serial_no": "000001",
            "urgent": True,
            "reason": "交期提前",
            "expected_version": 0,
        },
    )
    assert response.status_code == 200, response.text
    response = client.post(
        f"/api/team-materials/{warehouse['other']['id']}/losses",
        headers=warehouse["other_headers"],
        json={
            "source_transfer_id": sent["items"][0]["id"],
            "quantity": 1,
            "weight": ".100",
            "reason": "清点丢失",
            "idempotency_key": "list-loss",
        },
    )
    assert response.status_code == 201, response.text
    return {**warehouse, "sent": sent["items"], "returned": returned["items"]}


def list_cases(scenario):
    warehouse_url = f"/api/team-materials/{scenario['team']['id']}"
    workshop_url = f"/api/team-materials/{scenario['other']['id']}"
    return [
        ("transfers", "/api/material-transfers", {}, 3),
        ("outbound", workshop_url + "/outbound-batches", {}, 4),
        ("stock", workshop_url + "/stock", {}, 5),
        ("receipts", warehouse_url + "/receipts", {"receipt_source": "internal"}, 4),
        ("sources", workshop_url + f"/inventory/{scenario['sent'][0]['id']}/sources", {}, 5),
        ("legacy-dispatches", warehouse_url + "/dispatches", {}, 6),
    ]


def transfer_rows(kind, result):
    if kind in ("stock", "sources"):
        return [item["transfer"] for item in result["items"]]
    if kind == "legacy-dispatches":
        return [line for item in result["items"] for line in item["items"]]
    return result["items"]


def test_page_reads_have_constant_query_budget(client, list_scenario):
    counts = {}
    for kind, url, params, budget in list_cases(list_scenario):
        for size in (1, 10, 100):
            with read_statements() as statements:
                response = client.get(url, params={**params, "page_size": size})
            assert response.status_code == 200, response.text
            assert response.json()["items"]
            assert len(response.json()["items"]) <= size
            assert all("material_transfer_events" not in sql for sql in statements)
            counts[f"{kind}/{size}"] = (len(statements), budget)
    assert all(actual <= budget for actual, budget in counts.values()), counts


def test_list_payloads_keep_details_permissions_and_history_on_demand(client, list_scenario):
    kinds, states = set(), set()
    for kind, url, params, _budget in list_cases(list_scenario):
        for headers in ({}, list_scenario["headers"], list_scenario["other_headers"]):
            response = client.get(url, params={**params, "page_size": 10}, headers=headers)
            assert response.status_code == 200, response.text
            for row in transfer_rows(kind, response.json()):
                detail = client.get("/api/material-transfers/" + row["batch_no"], headers=headers)
                assert detail.status_code == 200, detail.text
                expected = {**detail.json(), "history": [], "loss_records": []}
                assert (
                    MaterialTransferResponse.model_validate(row).model_dump(mode="json") == expected
                )
                assert row["serial_no"].startswith("00000")
                assert row["urgency"]["urgent"] == (row["serial_no"] == "000001")
                kinds.add(row["dispatch_no"])
                states.add(row["status"])
    assert kinds == {None, "CK-LEGACY-LIST"}
    assert states == {"pending", "received"}
    detail = client.get("/api/material-transfers/" + list_scenario["sent"][0]["batch_no"]).json()
    assert detail["history"] and detail["loss_records"][0]["reason"] == "清点丢失"


def test_empty_pages_and_unauthenticated_lists_remain_bounded(client, list_scenario):
    for _kind, url, params, budget in list_cases(list_scenario):
        with read_statements() as statements:
            response = client.get(url, params={**params, "page": 999, "page_size": 10})
        assert response.status_code == 200, response.text
        assert response.json()["items"] == [] and response.json()["total"] > 0
        assert len(statements) <= budget
    client.headers.pop("Authorization")
    for _kind, url, params, _budget in list_cases(list_scenario):
        assert client.get(url, params=params).status_code == 401


def test_immediate_source_loads_identity_only_not_its_own_chain(list_scenario):
    with SessionLocal() as db, read_statements() as statements:
        row = db.scalar(
            select(MaterialTransfer)
            .options(*material_transfer_list_options())
            .where(MaterialTransfer.id == list_scenario["returned"][0]["id"])
        )
        result = material_transfer_dict(row, include_history=False)
        source = row.stock_source
        assert source.id == list_scenario["sent"][0]["id"]
        assert result["source_transfer_batch_no"] == list_scenario["sent"][0]["batch_no"]
        assert {
            "stock_source",
            "urgency",
            "dispatch",
            "notes",
            "technical_requirements",
        } <= inspect(source).unloaded
    assert len(statements) == 1
