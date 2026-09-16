import importlib.util
import re
from pathlib import Path

from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine, inspect, select, text

from app.database import SessionLocal
from app.models import MaterialTransfer
from app.legacy_models import Operation, OperationReport, WorkOrder
from app.seed_material_transfer_showcase import seed_material_transfer_showcase


def _team(client, code: str, name: str, *, active: bool = True) -> dict:
    response = client.post(
        "/api/teams", json={"code": code, "name": name, "active": active}
    )
    assert response.status_code == 201, response.text
    return response.json()


def _leader(client, username: str, team_id: int) -> tuple[dict, dict[str, str]]:
    password = "Leader123!"
    response = client.post(
        "/api/accounts",
        json={
            "username": username,
            "display_name": f"{username}班组长",
            "password": password,
            "role": "TEAM",
            "team_id": team_id,
        },
    )
    assert response.status_code == 201, response.text
    login = client.post(
        "/api/auth/login", json={"username": username, "password": password}
    )
    assert login.status_code == 200, login.text
    return response.json(), {
        "Authorization": f"Bearer {login.json()['access_token']}"
    }


def _setup_three_teams(client):
    source = _team(client, "SOURCE", "上序班")
    target = _team(client, "TARGET", "下序班")
    third = _team(client, "THIRD", "后续班")
    source_user, source_headers = _leader(client, "source-leader", source["id"])
    target_user, target_headers = _leader(client, "target-leader", target["id"])
    third_user, third_headers = _leader(client, "third-leader", third["id"])
    return {
        "source": source,
        "target": target,
        "third": third,
        "source_user": source_user,
        "target_user": target_user,
        "third_user": third_user,
        "source_headers": source_headers,
        "target_headers": target_headers,
        "third_headers": third_headers,
    }


def _create(client, setup, **overrides):
    payload = {
        "serial_no": "SERIAL-001",
        "next_team_id": setup["target"]["id"],
        "quantity": 12,
        "weight": "3.250",
        "notes": "本次整批交接",
        "idempotency_key": "create-001",
        **overrides,
    }
    return client.post(
        "/api/material-transfers",
        json=payload,
        headers=setup["source_headers"],
    )


def test_material_transfer_is_a_single_team_handoff_without_process_dependencies(client):
    setup = _setup_three_teams(client)
    assert client.get("/api/work-orders").status_code == 404

    response = _create(client, setup)
    assert response.status_code == 201, response.text
    body = response.json()
    assert re.fullmatch(r"TL\d{8}\d{6}", body["batch_no"])
    assert body["barcode_payload"] == body["batch_no"]
    assert body["barcode_type"] == "CODE128"
    assert body["serial_no"] == "SERIAL-001"
    assert body["source_team"] == {
        "id": setup["source"]["id"],
        "code": "SOURCE",
        "name": "上序班",
        "kind": "production",
    }
    assert body["next_team"] == {
        "id": setup["target"]["id"],
        "code": "TARGET",
        "name": "下序班",
        "kind": "production",
    }
    assert body["quantity"] == 12 and body["quantity_unit"] == "件"
    assert body["weight"] == 3.25 and body["weight_unit"] == "kg"
    assert body["status"] == "pending"
    assert body["locked"] is False
    assert body["allowed_actions"] == ["edit", "void"]
    assert "work_order_id" not in body
    assert "operation_report_id" not in body
    assert "source_operation" not in body

    with SessionLocal() as db:
        transfer = db.scalar(select(MaterialTransfer))
        assert transfer is not None
        assert db.scalar(select(WorkOrder.id)) is None
        assert db.scalar(select(Operation.id)) is None
        assert db.scalar(select(OperationReport.id)) is None


def test_permissions_whole_batch_confirmation_and_permanent_lock(client):
    setup = _setup_three_teams(client)
    created = _create(client, setup).json()
    batch_no = created["batch_no"]

    target_view = client.get(
        f"/api/material-transfers/{batch_no}", headers=setup["target_headers"]
    )
    assert target_view.status_code == 200
    assert target_view.json()["allowed_actions"] == ["confirm"]
    assert client.get(f"/api/material-transfers/{batch_no}").json()["allowed_actions"] == []

    assert client.patch(
        f"/api/material-transfers/{batch_no}",
        json={"quantity": 13},
        headers=setup["target_headers"],
    ).status_code == 403
    assert client.delete(
        f"/api/material-transfers/{batch_no}", headers=setup["target_headers"]
    ).status_code == 403
    assert client.post(
        f"/api/material-transfers/{batch_no}/confirm",
        json={"idempotency_key": "wrong-source-confirm"},
        headers=setup["source_headers"],
    ).status_code == 403

    updated = client.patch(
        f"/api/material-transfers/{batch_no}",
        json={
            "serial_no": "SERIAL-001-A",
            "next_team_id": setup["third"]["id"],
            "quantity": 9,
            "weight": "2.125",
            "notes": "上序复核后修正",
        },
        headers=setup["source_headers"],
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["next_team"]["id"] == setup["third"]["id"]
    assert updated.json()["quantity"] == 9

    forbidden_receipt_fields = client.post(
        f"/api/material-transfers/{batch_no}/confirm",
        json={"idempotency_key": "receive-001", "received_quantity": 8},
        headers=setup["third_headers"],
    )
    assert forbidden_receipt_fields.status_code == 422

    confirmed = client.post(
        f"/api/material-transfers/{batch_no}/confirm",
        json={"idempotency_key": "receive-001"},
        headers=setup["third_headers"],
    )
    assert confirmed.status_code == 200, confirmed.text
    received = confirmed.json()
    assert received["status"] == "received"
    assert received["locked"] is True
    assert received["locked_at"] == received["received_at"]
    assert received["received_by"] == "third-leader班组长"
    assert received["received_by_user_id"] == setup["third_user"]["id"]
    assert received["quantity"] == 9 and received["weight"] == 2.125
    assert received["allowed_actions"] == []

    retry = client.post(
        f"/api/material-transfers/{batch_no}/confirm",
        json={"idempotency_key": "receive-001"},
        headers=setup["third_headers"],
    )
    assert retry.status_code == 200
    assert retry.json()["received_at"] == received["received_at"]
    assert retry.json()["id"] == received["id"]

    assert client.post(
        f"/api/material-transfers/{batch_no}/confirm",
        json={"idempotency_key": "receive-002"},
        headers=setup["third_headers"],
    ).status_code == 409
    assert client.patch(
        f"/api/material-transfers/{batch_no}",
        json={"notes": "不得修改"},
        headers=setup["source_headers"],
    ).status_code == 409
    assert client.delete(
        f"/api/material-transfers/{batch_no}", headers=setup["source_headers"]
    ).status_code == 409


def test_admin_is_read_only_and_source_only_can_void_pending_transfer(client):
    setup = _setup_three_teams(client)
    assert _create(client, setup).status_code == 201
    batch_no = client.get("/api/material-transfers").json()["items"][0]["batch_no"]

    assert _create(
        client, setup, serial_no="ADMIN-CREATE", idempotency_key="admin-create"
    ).status_code == 201
    admin_attempt = client.post(
        "/api/material-transfers",
        json={
            "serial_no": "ADMIN-DENIED",
            "next_team_id": setup["target"]["id"],
            "quantity": 1,
            "weight": 1,
        },
    )
    assert admin_attempt.status_code == 403
    assert client.patch(
        f"/api/material-transfers/{batch_no}", json={"quantity": 2}
    ).status_code == 403
    assert client.delete(f"/api/material-transfers/{batch_no}").status_code == 403
    assert client.post(
        f"/api/material-transfers/{batch_no}/confirm",
        json={"idempotency_key": "admin-receive"},
    ).status_code == 403

    voided = client.delete(
        f"/api/material-transfers/{batch_no}", headers=setup["source_headers"]
    )
    assert voided.status_code == 204
    detail = client.get(f"/api/material-transfers/{batch_no}").json()
    assert detail["status"] == "voided"
    assert detail["locked"] is True
    assert detail["voided_by"] == "source-leader班组长"
    assert detail["locked_at"] == detail["voided_at"]
    assert detail["allowed_actions"] == []
    assert client.delete(
        f"/api/material-transfers/{batch_no}", headers=setup["source_headers"]
    ).status_code == 409


def test_creation_idempotency_and_validation(client):
    setup = _setup_three_teams(client)
    first = _create(client, setup)
    duplicate = _create(client, setup)
    assert first.status_code == duplicate.status_code == 201
    assert first.json()["id"] == duplicate.json()["id"]
    assert first.json()["batch_no"] == duplicate.json()["batch_no"]
    changed = _create(client, setup, quantity=13)
    assert changed.status_code == 409

    for field, value in (("quantity", -1), ("weight", -1)):
        response = _create(
            client,
            setup,
            **{field: value, "idempotency_key": f"invalid-{field}-{value}"},
        )
        assert response.status_code == 422
    assert _create(
        client,
        setup,
        next_team_id=setup["source"]["id"],
        idempotency_key="same-team",
    ).status_code == 422

    inactive = _team(client, "INACTIVE", "停用班", active=False)
    assert _create(
        client,
        setup,
        next_team_id=inactive["id"],
        idempotency_key="inactive-target",
    ).status_code == 422

    payload = {
        "serial_no": "NO-PROCESS-FIELDS",
        "next_team_id": setup["target"]["id"],
        "quantity": 1,
        "weight": 1,
        "operation_report_id": 999,
    }
    assert client.post(
        "/api/material-transfers",
        json=payload,
        headers=setup["source_headers"],
    ).status_code == 422


def test_document_fields_round_trip_clear_audit_and_lock(client):
    setup = _setup_three_teams(client)
    fields = {
        "material_type": "finished", "source_batch_no": "RAW-001",
        "material_name": "Mo70Cu30", "finished_specification": "图纸 NP000500010-A4",
        "transfer_specification": "20×30×2 mm", "finished_quantity": 12460,
        "customer_code": "001440", "technical_requirements": "按图纸加工\n外观 A 级",
        "product_code": "T4-03-71-MT", "part_no": "P-001", "material_shape": "板",
        "material_description": "热沉零件", "outsourced_unit": "示例外委单位",
        "purpose_category": "热沉", "category_level3": "钼铜热沉",
        "order_category": "产品订单", "special_process": "特殊要求仅作文字说明",
    }
    created_response = _create(client, setup, quantity=132, **fields)
    assert created_response.status_code == 201, created_response.text
    created = created_response.json()
    assert {key: created[key] for key in fields} == fields
    assert created["quantity"] == 132 and created["finished_quantity"] == 12460
    assert created["source_batch_no"] != created["barcode_payload"] == created["batch_no"]
    assert created["version"] == 1
    assert [event["action"] for event in created["history"]] == ["created"]
    assert created["history"][0]["changes"]["material_name"] == {"before": None, "after": "Mo70Cu30"}

    url = f"/api/material-transfers/{created['batch_no']}"
    updated_response = client.patch(url, headers=setup["source_headers"], json={
        "expected_version": 1, "quantity": 120, "source_batch_no": " RAW-002 ",
        "customer_code": None, "finished_quantity": None, "special_process": "   ",
    })
    assert updated_response.status_code == 200, updated_response.text
    updated = updated_response.json()
    assert updated["version"] == 2
    assert updated["quantity"] == 120 and updated["source_batch_no"] == "RAW-002"
    assert updated["customer_code"] is None and updated["finished_quantity"] is None
    assert updated["special_process"] is None
    assert updated["technical_requirements"] == fields["technical_requirements"]
    event = updated["history"][-1]
    assert event["action"] == "updated" and event["actor"] == "source-leader班组长"
    assert event["occurred_at"].endswith("Z")
    assert event["changes"]["quantity"] == {"before": 132, "after": 120}
    assert event["changes"]["customer_code"] == {"before": "001440", "after": None}
    assert "technical_requirements" not in event["changes"]

    confirmed = client.post(url + "/confirm", headers=setup["target_headers"], json={
        "idempotency_key": "full-doc-receive", "expected_version": 2,
    })
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["version"] == 3
    assert [event["action"] for event in confirmed.json()["history"]] == ["created", "updated", "received"]
    for field in fields:
        assert client.patch(url, headers=setup["source_headers"], json={field: fields[field]}).status_code == 409
    assert client.get(url).json()["version"] == 3
    assert len(client.get(url).json()["history"]) == 3


def test_versions_prevent_unseen_confirmation_and_lost_edits_with_retry_safety(client):
    setup = _setup_three_teams(client)
    created = _create(client, setup, material_type="finished").json()
    url = f"/api/material-transfers/{created['batch_no']}"
    assert client.patch(url, headers=setup["source_headers"], json={
        "expected_version": 1, "material_name": "W80Cu20",
    }).status_code == 200
    assert client.patch(url, headers=setup["source_headers"], json={
        "expected_version": 1, "quantity": 99,
    }).status_code == 409
    assert client.post(url + "/confirm", headers=setup["target_headers"], json={
        "idempotency_key": "version-receive", "expected_version": 1,
    }).status_code == 409
    unchanged = client.get(url).json()
    assert unchanged["quantity"] == 12 and unchanged["status"] == "pending"
    assert len(unchanged["history"]) == 2
    payload = {"idempotency_key": "version-receive", "expected_version": 2}
    received = client.post(url + "/confirm", headers=setup["target_headers"], json=payload)
    retry = client.post(url + "/confirm", headers=setup["target_headers"], json=payload)
    assert received.status_code == retry.status_code == 200
    assert retry.json() == received.json()
    assert retry.json()["version"] == 3 and len(retry.json()["history"]) == 3


def test_all_material_types_and_independent_counts_weight_validation(client):
    setup = _setup_three_teams(client)
    for material_type in ("finished", "semi_finished", "finished_surplus", "semi_finished_surplus", "defective", "waste", "sludge", "scrap_chips"):
        response = _create(client, setup, material_type=material_type,
                           quantity=0, weight="1.235", idempotency_key=material_type)
        assert response.status_code == 201, response.text
        assert response.json()["material_type"] == material_type
        assert response.json()["quantity"] == 0 and response.json()["weight"] == 1.235
    counted = _create(client, setup, quantity=8, weight=0, idempotency_key="count-only")
    assert counted.status_code == 201, counted.text
    url = f"/api/material-transfers/{counted.json()['batch_no']}"
    assert client.patch(url, headers=setup["source_headers"], json={"quantity": 0}).status_code == 422
    assert client.get(url).json()["quantity"] == 8
    for i, invalid in enumerate((
        {"quantity": 0, "weight": 0}, {"material_type": "invented"},
        {"finished_quantity": -1}, {"finished_quantity": 1.2}, {"weight": "1.0001"},
        {"customer_code": "X" * 81}, {"technical_requirements": "X" * 4001},
        {"source_team_id": setup["third"]["id"]}, {"version": 5},
        {"history": [{"action": "received"}]},
    )):
        assert _create(client, setup, **invalid, idempotency_key=f"invalid-doc-{i}").status_code == 422
    assert client.patch(url, headers=setup["source_headers"], json={"expected_version": 1}).status_code == 422


def test_document_idempotency_search_and_legacy_empty_fields(client):
    setup = _setup_three_teams(client)
    created = _create(client, setup, material_name="铜钼", source_batch_no="RAW-SEARCH-001").json()
    duplicate = _create(client, setup, material_name="铜钼", source_batch_no="RAW-SEARCH-001").json()
    assert created == duplicate
    assert len(duplicate["history"]) == 1
    assert _create(client, setup, material_name="钨铜", source_batch_no="RAW-SEARCH-001").status_code == 409
    for query in ("RAW-SEARCH-001", "铜钼"):
        listed = client.get("/api/material-transfers", params={"query": query}).json()
        assert listed["total"] == 1
        assert listed["items"][0]["source_batch_no"] == "RAW-SEARCH-001"
        assert listed["items"][0]["history"] == []
    legacy = _create(client, setup, idempotency_key="legacy-fields").json()
    assert legacy["material_type"] is None and legacy["finished_quantity"] is None
    url = f"/api/material-transfers/{legacy['batch_no']}"
    no_change = client.patch(url, headers=setup["source_headers"], json={"quantity": 12}).json()
    assert no_change["version"] == 1 and len(no_change["history"]) == 1
    assert client.delete(url, headers=setup["source_headers"]).status_code == 204
    voided = client.get(url).json()
    assert voided["version"] == 2
    assert [item["action"] for item in voided["history"]] == ["created", "voided"]


def test_document_history_failure_rolls_back_business_changes(client, monkeypatch):
    import pytest
    from app import material_transfer_workflow

    setup = _setup_three_teams(client)
    created = _create(client, setup).json()
    url = f"/api/material-transfers/{created['batch_no']}"

    def fail_history(*args, **kwargs):
        raise RuntimeError("simulated audit failure")

    monkeypatch.setattr(material_transfer_workflow, "_record_event", fail_history)
    with pytest.raises(RuntimeError, match="simulated audit failure"):
        client.patch(url, headers=setup["source_headers"], json={
            "quantity": 500, "material_name": "should not persist", "expected_version": 1,
        })
    after = client.get(url, headers=setup["source_headers"]).json()
    assert after == created
    with pytest.raises(RuntimeError, match="simulated audit failure"):
        client.post(url + "/confirm", headers=setup["target_headers"], json={
            "idempotency_key": "audit-failure-confirm", "expected_version": 1,
        })
    assert client.get(url, headers=setup["source_headers"]).json() == created


def test_search_modes_fields_types_and_combined_filters(client):
    setup = _setup_three_teams(client)
    for i, serial in enumerate(("SEARCH-10", "SEARCH-100", "XSEARCH-10")):
        response = _create(client, setup, serial_no=serial, idempotency_key=f"search-mode-{i}",
                           material_type="finished" if i < 2 else "waste",
                           source_batch_no=f"RAW-{i:03d}", customer_code=f"CUSTOMER-{i}",
                           product_code=f"PRODUCT-{i}", material_name=f"铜钼-{i}")
        assert response.status_code == 201, response.text
    for mode, expected in (("exact", 1), ("prefix", 2), ("contains", 3)):
        params = {"query": "SEARCH-10", "search_field": "serial_no", "search_mode": mode}
        result = client.get("/api/material-transfers", params=params)
        assert result.status_code == 200, result.text
        assert result.json()["total"] == expected
    assert client.get("/api/material-transfers", params={"query": "SEARCH-10"}).json()["total"] == 3
    for field, term in (("source_batch_no", "RAW-000"), ("customer_code", "CUSTOMER-0"),
                        ("product_code", "PRODUCT-0"), ("material_name", "铜钼-0")):
        result = client.get("/api/material-transfers", params={
            "query": term, "search_field": field, "search_mode": "exact",
            "material_type": "finished", "source_team_id": setup["source"]["id"],
            "next_team_id": setup["target"]["id"], "status": "pending",
        }).json()
        assert result["total"] == 1 and result["items"][0][field] == term
    assert client.get("/api/material-transfers", params={
        "query": "上序班", "search_mode": "contains",
    }).json()["total"] == 3
    assert client.get("/api/material-transfers", params={
        "query": "上序班", "search_mode": "exact",
    }).json()["total"] == 0
    paged = client.get("/api/material-transfers", params={
        "query": "SEARCH-10", "search_mode": "prefix", "material_type": "finished",
        "page_size": 1, "page": 2,
    }).json()
    assert paged["total"] == 2 and len(paged["items"]) == 1
    for invalid in ({"search_mode": "fuzzy"}, {"search_field": "created_by"}, {"material_type": "bad"}):
        assert client.get("/api/material-transfers", params=invalid).status_code == 422


def test_search_wildcards_are_literal_and_not_sql(client):
    setup = _setup_three_teams(client)
    for i, serial in enumerate(("SPECIAL%_!001", "SPECIALabcX001", "OTHER")):
        assert _create(client, setup, serial_no=serial, idempotency_key=f"literal-{i}").status_code == 201
    for mode, term in (("contains", "%_!"), ("prefix", "SPECIAL%_!"), ("exact", "SPECIAL%_!001")):
        result = client.get("/api/material-transfers", params={
            "query": term, "search_mode": mode, "search_field": "serial_no",
        }).json()
        assert result["total"] == 1
        assert result["items"][0]["serial_no"] == "SPECIAL%_!001"
    assert client.get("/api/material-transfers", params={"query": "' OR 1=1 --"}).json()["total"] == 0


def test_list_filters_pagination_and_chronological_serial_trace(client):
    setup = _setup_three_teams(client)
    first = _create(client, setup, idempotency_key="trace-1").json()
    confirm = client.post(
        f"/api/material-transfers/{first['batch_no']}/confirm",
        json={"idempotency_key": "trace-receive-1"},
        headers=setup["target_headers"],
    )
    assert confirm.status_code == 200
    second = client.post(
        "/api/material-transfers",
        json={
            "serial_no": "SERIAL-001",
            "next_team_id": setup["third"]["id"],
            "quantity": 12,
            "weight": 3.25,
            "idempotency_key": "trace-2",
        },
        headers=setup["target_headers"],
    ).json()
    other = _create(
        client,
        setup,
        serial_no="OTHER-SERIAL",
        quantity=3,
        weight="0.750",
        idempotency_key="trace-other",
    ).json()

    trace = client.get(
        "/api/material-transfers",
        params={"serial_no": "SERIAL-001", "page_size": 100},
    )
    assert trace.status_code == 200
    assert [item["id"] for item in trace.json()["items"]] == [first["id"], second["id"]]
    assert trace.json()["total"] == 2

    assert client.get(
        "/api/material-transfers", params={"status": "received"}
    ).json()["items"][0]["id"] == first["id"]
    assert client.get(
        "/api/material-transfers", params={"source_team_id": setup["target"]["id"]}
    ).json()["items"][0]["id"] == second["id"]
    assert client.get(
        "/api/material-transfers", params={"next_team_id": setup["third"]["id"]}
    ).json()["items"][0]["id"] == second["id"]
    assert client.get(
        "/api/material-transfers", params={"target_team_id": setup["target"]["id"]}
    ).json()["total"] == 2
    assert client.get(
        "/api/material-transfers", params={"query": other["batch_no"]}
    ).json()["items"][0]["id"] == other["id"]
    paged = client.get(
        "/api/material-transfers", params={"page": 2, "page_size": 1}
    ).json()
    assert paged["total"] == 3 and paged["page"] == 2 and len(paged["items"]) == 1
    assert client.get(
        "/api/material-transfers",
        params={"next_team_id": setup["target"]["id"], "target_team_id": setup["third"]["id"]},
    ).status_code == 422
    assert client.get(
        "/api/material-transfers", params={"status": "partially_received"}
    ).status_code == 422


def test_team_workspace_directions_counts_pagination_and_intersecting_filters(client):
    setup = _setup_three_teams(client)
    source_id, target_id, third_id = (setup[key]["id"] for key in ("source", "target", "third"))
    outgoing = _create(client, setup, material_type="semi_finished").json()
    incoming = _create(client, {**setup, "source_headers": setup["third_headers"]},
                       next_team_id=source_id, idempotency_key="workspace-incoming",
                       serial_no="INCOMING", material_type="finished").json()
    unrelated = _create(client, {**setup, "source_headers": setup["target_headers"]},
                        next_team_id=third_id, idempotency_key="workspace-unrelated",
                        material_type="semi_finished").json()
    voided = _create(client, setup, idempotency_key="workspace-void").json()
    assert client.delete(f"/api/material-transfers/{voided['batch_no']}",
                         headers=setup["source_headers"]).status_code == 204
    assert client.post(f"/api/material-transfers/{incoming['batch_no']}/confirm",
                       json={"idempotency_key": "workspace-receive"},
                       headers=setup["source_headers"]).status_code == 200

    expected = {
        "all": [voided["id"], incoming["id"], outgoing["id"]],
        "outgoing": [voided["id"], outgoing["id"]],
        "incoming": [incoming["id"]],
    }
    for direction, ids in expected.items():
        params = {"team_id": source_id, "direction": direction, "page_size": 1}
        pages = [client.get("/api/material-transfers", params={**params, "page": page}).json()
                 for page in range(1, len(ids) + 1)]
        assert all(page["total"] == len(ids) for page in pages)
        assert [page["items"][0]["id"] for page in pages] == ids
        counts = [client.get("/api/material-transfers", params={**params, "status": status}).json()["total"]
                  for status in ("pending", "received", "voided")]
        assert counts == ({"all": [1, 1, 1], "outgoing": [1, 0, 1], "incoming": [0, 1, 0]}[direction])
        # Any authenticated team can read; the workspace is a filter, not new read authorization.
        read = client.get("/api/material-transfers", params={"team_id": source_id, "direction": direction},
                          headers=setup["third_headers"])
        assert read.status_code == 200 and read.json()["total"] == len(ids)
        assert unrelated["id"] not in [item["id"] for item in read.json()["items"]]
    matched = client.get("/api/material-transfers", params={
        "team_id": source_id, "direction": "outgoing", "material_type": "semi_finished",
        "status": "pending", "query": "SERIAL-001", "search_mode": "exact", "search_field": "serial_no",
        "source_team_id": source_id, "target_team_id": target_id,
    }).json()
    assert matched["total"] == 1 and matched["items"][0]["id"] == outgoing["id"]
    contradictory = client.get("/api/material-transfers", params={
        "team_id": source_id, "direction": "incoming", "source_team_id": target_id,
    }).json()
    assert contradictory["total"] == 0 and contradictory["items"] == []
    assert client.get("/api/material-transfers", params={"team_id": source_id}).json()["total"] == 3
    assert client.get("/api/material-transfers").json()["total"] == 4
    for invalid in ({"team_id": 0}, {"team_id": -1}, {"team_id": "oops"},
                    {"team_id": source_id, "direction": "both"},
                    {"direction": "incoming"}, {"direction": "outgoing"}):
        assert client.get("/api/material-transfers", params=invalid).status_code == 422
    assert client.get("/api/material-transfers", params={"team_id": 999999}).status_code == 404


def test_dynamic_team_directory_and_current_account_binding(client):
    setup = _setup_three_teams(client)
    for order, key in enumerate(("third", "source", "target")):
        response = client.patch(f"/api/teams/{setup[key]['id']}", json={"sort_order": order * 10})
        assert response.status_code == 200, response.text
    directory = client.get("/api/team-directory", headers=setup["source_headers"]).json()
    assert [team["id"] for team in directory] == [setup[key]["id"] for key in ("third", "source", "target")]
    assert client.patch(f"/api/teams/{setup['third']['id']}", json={"name": "新增接收班"}).status_code == 200
    assert client.get("/api/team-directory").json()[0]["name"] == "新增接收班"
    # A newly configured team is visible even before an account is assigned.
    unbound = _team(client, "UNBOUND", "待分配班组长")
    assert unbound["id"] in [row["id"] for row in client.get("/api/team-directory").json()]
    assert client.patch(f"/api/teams/{unbound['id']}", json={"active": False}).status_code == 200
    assert unbound["id"] not in [row["id"] for row in client.get("/api/team-directory").json()]
    # A current login follows the latest admin binding; an old token cannot impersonate the old team.
    assert client.patch(f"/api/accounts/{setup['source_user']['id']}",
                        json={"team_id": setup["third"]["id"]}).status_code == 200
    me = client.get("/api/auth/me", headers=setup["source_headers"])
    assert me.status_code == 200 and me.json()["team_id"] == setup["third"]["id"]
    transfer = _create(client, setup)
    assert transfer.status_code == 201, transfer.text
    assert transfer.json()["source_team_id"] == setup["third"]["id"]
    assert client.post("/api/teams", json={"code": "FORBIDDEN", "name": "不能创建"},
                       headers=setup["source_headers"]).status_code == 403


def test_warehouse_requires_classification_and_preserves_notes_audit_and_kind(client):
    setup = _setup_three_teams(client)
    response = client.post("/api/teams", json={"code": "FACTORY-WAREHOUSE", "name": "库房", "kind": "warehouse"})
    assert response.status_code == 201, response.text
    warehouse = response.json()
    _, warehouse_headers = _leader(client, "warehouse-leader", warehouse["id"])
    for material_type in (None, "", "   "):
        missing = _create(client, setup, next_team_id=warehouse["id"], material_type=material_type,
                          idempotency_key=f"missing-type-{material_type}")
        assert missing.status_code == 422, missing.text
    incoming = _create(client, setup, next_team_id=warehouse["id"], material_type="semi_finished",
                       notes="半成品暂存，后续继续转料", idempotency_key="warehouse-semi")
    assert incoming.status_code == 201, incoming.text
    body = incoming.json()
    assert body["next_team"]["kind"] == "warehouse" and body["material_type"] == "semi_finished"
    assert body["notes"] == "半成品暂存，后续继续转料"
    assert body["history"][0]["changes"]["notes"]["after"] == body["notes"]
    url = f"/api/material-transfers/{body['batch_no']}"
    assert client.patch(url, json={"material_type": None}, headers=setup["source_headers"]).status_code == 422
    assert client.get(url).json()["version"] == 1
    classified = client.patch(url, json={"material_type": "finished", "notes": "成品交库"},
                              headers=setup["source_headers"])
    assert classified.status_code == 200, classified.text
    assert classified.json()["history"][-1]["changes"]["material_type"] == {
        "before": "semi_finished", "after": "finished",
    }
    confirm = client.post(url + "/confirm", json={"idempotency_key": "warehouse-receipt", "expected_version": 2},
                          headers=warehouse_headers)
    assert confirm.status_code == 200, confirm.text
    assert client.patch(url, json={"notes": "不能覆盖"}, headers=setup["source_headers"]).status_code == 409

    ordinary = _create(client, setup, idempotency_key="switch-warehouse").json()
    url = f"/api/material-transfers/{ordinary['batch_no']}"
    assert client.patch(url, json={"next_team_id": warehouse["id"]},
                        headers=setup["source_headers"]).status_code == 422
    assert client.get(url).json()["next_team_id"] == setup["target"]["id"]
    switched = client.patch(url, json={"next_team_id": warehouse["id"], "material_type": "semi_finished_surplus"},
                            headers=setup["source_headers"])
    assert switched.status_code == 200, switched.text
    assert switched.json()["next_team"]["kind"] == "warehouse"
    assert switched.json()["notes"] == ordinary["notes"]
    switched_back = client.patch(url, json={"next_team_id": setup["third"]["id"], "material_type": None},
                                 headers=setup["source_headers"])
    assert switched_back.status_code == 200, switched_back.text
    assert switched_back.json()["next_team"]["kind"] == "production"
    assert client.patch(f"/api/teams/{setup['third']['id']}", json={"kind": "scrap"}).status_code == 409
    assert client.patch(f"/api/teams/{setup['third']['id']}", json={"name": "新的班组名"}).status_code == 200
    read = client.get(url).json()
    assert read["next_team"]["name"] == "后续班"  # Name is a historic snapshot.
    assert read["next_team"]["kind"] == "production"  # Current directory classification; referenced kind is protected.
    assert read["version"] == switched_back.json()["version"]
    outbound = _create(client, {**setup, "source_headers": warehouse_headers},
                       idempotency_key="warehouse-outbound", material_type="semi_finished")
    assert outbound.status_code == 201 and outbound.json()["source_team"]["kind"] == "warehouse"


def test_historical_warehouse_without_type_can_be_confirmed_without_inventing_fields(client, monkeypatch):
    from app import material_transfer_workflow

    setup = _setup_three_teams(client)
    assert client.patch(f"/api/teams/{setup['target']['id']}", json={
        "code": "FACTORY-WAREHOUSE", "name": "库房", "kind": "warehouse",
    }).status_code == 200
    # Build an old-client fixture under the old rule (warehouse type was optional).
    # Restore the new validator before replaying, editing, or confirming the historic record.
    with monkeypatch.context() as old_backend:
        old_backend.setattr(material_transfer_workflow, "_validate_warehouse_type", lambda target, material_type: None)
        created_response = _create(client, setup)
        assert created_response.status_code == 201, created_response.text
        created = created_response.json()
    retry = _create(client, setup)
    assert retry.status_code == 201 and retry.json()["id"] == created["id"]
    assert retry.json()["material_type"] is None
    url = f"/api/material-transfers/{created['batch_no']}"
    updated = client.patch(url, json={"notes": "历史入库单复核"}, headers=setup["source_headers"])
    assert updated.status_code == 200 and updated.json()["material_type"] is None
    confirmed = client.post(url + "/confirm", json={"idempotency_key": "legacy-warehouse-confirm"},
                            headers=setup["target_headers"])
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["material_type"] is None and confirmed.json()["locked"] is True
    assert confirmed.json()["next_team"]["kind"] == "warehouse"


def test_referenced_teams_cannot_be_deleted_even_after_accounts_are_removed(client):
    setup = _setup_three_teams(client)
    created = _create(client, setup)
    assert created.status_code == 201
    for key in ("source_user", "target_user"):
        assert client.delete(f"/api/accounts/{setup[key]['id']}").status_code == 204
    assert client.delete(f"/api/teams/{setup['source']['id']}").status_code == 409
    assert client.delete(f"/api/teams/{setup['target']['id']}").status_code == 409


def test_admin_can_create_team_leaders_but_not_more_administrators(client):
    team = _team(client, "LEADER-TEAM", "班组长测试班")
    admin_create = client.post(
        "/api/accounts",
        json={
            "username": "second-admin",
            "display_name": "第二管理员",
            "password": "Admin123!",
            "role": "ADMIN",
        },
    )
    assert admin_create.status_code == 422
    leader, _ = _leader(client, "ordinary-leader", team["id"])
    assert client.patch(
        f"/api/accounts/{leader['id']}", json={"role": "ADMIN"}
    ).status_code == 422

    admin = client.get("/api/auth/me").json()
    maintenance = client.patch(
        f"/api/accounts/{admin['id']}", json={"display_name": "系统管理员"}
    )
    assert maintenance.status_code == 200
    assert maintenance.json()["role"] == "ADMIN"
    assert maintenance.json()["display_name"] == "系统管理员"


def test_showcase_seed_skips_without_leaders_and_is_idempotent_with_three(client):
    with SessionLocal() as db:
        empty = seed_material_transfer_showcase(db)
        assert empty["created"] == []
        assert "至少需要两个" in empty["skipped"][0]
        assert db.scalar(select(MaterialTransfer.id)) is None

    _setup_three_teams(client)
    with SessionLocal() as db:
        first = seed_material_transfer_showcase(db)
        second = seed_material_transfer_showcase(db)
        transfers = db.scalars(
            select(MaterialTransfer).order_by(MaterialTransfer.id)
        ).all()
    assert len(first["created"]) == 2
    assert len(first["confirmed"]) == 1
    assert first["skipped"] == []
    assert second["created"] == []
    assert len(second["reused"]) == 2
    assert len(transfers) == 2
    assert transfers[0].status == "received"
    assert transfers[1].status == "pending"
    assert transfers[0].serial_no == transfers[1].serial_no == "DEMO-DIRECT-FLOW-001"


def _material_transfer_migration():
    path = (
        Path(__file__).parents[1]
        / "alembic"
        / "versions"
        / "20260906_0004_material_transfers.py"
    )
    spec = importlib.util.spec_from_file_location("material_transfer_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_material_transfer_migration_preserves_legacy_data_and_is_idempotent(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'material-transfer.sqlite'}")
    migration = _material_transfer_migration()
    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        connection.exec_driver_sql("CREATE TABLE teams (id INTEGER PRIMARY KEY)")
        connection.exec_driver_sql("CREATE TABLE users (id INTEGER PRIMARY KEY)")
        connection.exec_driver_sql(
            "CREATE TABLE work_orders (id INTEGER PRIMARY KEY, order_no VARCHAR(64) NOT NULL)"
        )
        connection.exec_driver_sql("INSERT INTO work_orders VALUES (7, 'LEGACY-KEPT')")
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            migration.upgrade()
        assert "material_transfers" in inspect(connection).get_table_names()
        assert connection.execute(
            text("SELECT id, order_no FROM work_orders")
        ).one() == (7, "LEGACY-KEPT")
        columns = {item["name"] for item in inspect(connection).get_columns("material_transfers")}
        assert {"serial_no", "source_team_id", "next_team_id", "quantity", "weight"} <= columns
        assert "work_order_id" not in columns and "operation_id" not in columns
        assert connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall() == []
    engine.dispose()


def test_document_migration_preserves_existing_transfer_and_adds_constraints(tmp_path):
    from sqlalchemy.exc import IntegrityError
    import pytest

    path = Path(__file__).parents[1] / "alembic" / "versions" / "20260906_0005_transfer_document.py"
    spec = importlib.util.spec_from_file_location("transfer_document_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine(f"sqlite:///{tmp_path / 'transfer-document.sqlite'}")
    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        connection.exec_driver_sql("CREATE TABLE teams (id INTEGER PRIMARY KEY)")
        connection.exec_driver_sql("CREATE TABLE users (id INTEGER PRIMARY KEY)")
        connection.exec_driver_sql("INSERT INTO teams VALUES (1), (2)")
        with Operations.context(MigrationContext.configure(connection)):
            _material_transfer_migration().upgrade()
        connection.execute(text("""
            INSERT INTO material_transfers
                (id, batch_no, serial_no, source_team_id, source_team_code, source_team_name,
                 next_team_id, next_team_code, next_team_name, quantity, weight, status,
                 notes, created_by, created_at, updated_at, request_hash)
            VALUES (10, 'TL20260906000001', 'OLD-SERIAL', 1, 'SOURCE', '原转出班',
                    2, 'TARGET', '原接收班', 12, 3.25, 'received', '原单备注', '原操作人',
                    '2026-09-06 01:00:00', '2026-09-06 02:00:00', 'original-hash')
        """))
        before = dict(connection.execute(text("SELECT * FROM material_transfers")).mappings().one())
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            migration.upgrade()
        after = dict(connection.execute(text("SELECT * FROM material_transfers")).mappings().one())
        assert {key: after[key] for key in before} == before
        assert after["version"] == 1
        for key in ("material_type", "source_batch_no", "finished_quantity", "technical_requirements"):
            assert after[key] is None
        assert connection.execute(text("SELECT count(*) FROM material_transfer_events")).scalar() == 0
        connection.execute(text("UPDATE material_transfers SET quantity=0 WHERE id=10"))
        assert connection.execute(text("SELECT weight FROM material_transfers")).scalar() == 3.25
        for statement in (
            "UPDATE material_transfers SET weight=0 WHERE id=10",
            "UPDATE material_transfers SET quantity=-1 WHERE id=10",
            "UPDATE material_transfers SET finished_quantity=-1 WHERE id=10",
        ):
            with pytest.raises(IntegrityError):
                with connection.begin_nested():
                    connection.execute(text(statement))
        connection.execute(text("""
            INSERT INTO material_transfer_events (transfer_id, action, actor, occurred_at, changes)
            VALUES (10, 'updated', '测试操作人', '2026-09-06 03:00:00', '{}')
        """))
        with pytest.raises(IntegrityError):
            with connection.begin_nested():
                connection.execute(text("DELETE FROM material_transfers WHERE id=10"))
        assert connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall() == []
    engine.dispose()
