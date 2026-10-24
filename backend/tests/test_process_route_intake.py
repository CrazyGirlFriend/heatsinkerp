"""Imported route review and stock creation are one warehouse transaction."""

from copy import deepcopy
from hashlib import sha256

import pytest
from app import material_transfer_workflow, process_route_api
from app.database import SessionLocal
from app.models import MaterialTransfer, ProcessRoute, ProcessRoutePath, User
from app.process_route_schemas import StepWrite
from app.schemas import WarehouseReceiptCreate
from sqlalchemy import func, select
from test_material_transfers import _leader
from test_warehouse_receipts import intake
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

URL = "/api/process-routes"


def route_payload(client, setup, *, creator_headers=None):
    owner = client.get("/api/auth/me", headers=creator_headers or setup["headers"]).json()
    other_base = f"/api/team-materials/{setup['other']['id']}"
    task = client.post(other_base + "/processing-tasks", json={"name": "精轧"}).json()
    purpose = client.post(other_base + "/purposes", json={"name": "轧制加工"}).json()
    steps = [
        StepWrite(sequence_no=0, name="中转库", instructions="备料", team_id=setup["team"]["id"]),
        StepWrite(
            sequence_no=1,
            name="轧板",
            instructions="厚度2.5(+0.01/-0.02)",
            team_id=setup["other"]["id"],
            processing_task_id=task["id"],
            purpose_id=purpose["id"],
        ),
    ]
    data = b"original document bytes"
    with SessionLocal() as db:
        row = ProcessRoute(
            title="本批派工",
            filename="工艺.docx",
            source_file=data,
            source_sha256=sha256(data).hexdigest(),
            source_data={"tables": [["原件内容"]], "original_steps": [steps[0].model_dump()]},
            serial_nos=["WAREHOUSE-001"],
            steps=[step.model_dump() for step in steps],
            created_by=owner["display_name"],
            created_by_user_id=owner["id"],
        )
        db.add(row)
        db.commit()
        return {
            "id": row.id,
            "version": row.version,
            "title": row.title,
            "serial_nos": row.serial_nos,
            "steps": row.steps,
            "review_note": "已对照原单核对",
        }


def assert_no_receipt(route_id):
    with SessionLocal() as db:
        assert db.scalar(select(func.count(MaterialTransfer.id))) == 0
        assert db.scalar(select(func.count(ProcessRoutePath.route_id))) == 0
        row = db.get(ProcessRoute, route_id)
        assert row.state == "draft" and row.version == 1
        assert row.review_note is None


def test_official_warehouse_import_tracks_stable_user_ownership(client, warehouse, monkeypatch):
    original = StepWrite(sequence_no=0, name="中转库", instructions="备料").model_dump()
    monkeypatch.setattr(
        process_route_api,
        "parse_docx",
        lambda _: (
            {"tables": [["原件"]], "original_steps": [deepcopy(original)]},
            ["WAREHOUSE-001"],
            [deepcopy(original)],
        ),
    )
    result = client.post(
        URL + "/import", headers=warehouse["headers"], files={"file": ("工艺.docx", b"original")}
    )
    assert result.status_code == 201, result.text
    row = result.json()
    owner = client.get("/api/auth/me", headers=warehouse["headers"]).json()
    assert row["created_by_user_id"] == owner["id"]
    assert row["steps"][0]["team_id"] == warehouse["team"]["id"]
    assert row["source_data"]["original_steps"][0]["team_id"] is None
    assert (
        client.post(
            URL + "/import",
            headers=warehouse["other_headers"],
            files={"file": ("工艺.docx", b"original")},
        ).status_code
        == 403
    )
    with SessionLocal() as db:
        db.get(User, owner["id"]).display_name = "库房姓名已修改"
        db.commit()
    saved = client.put(
        URL + f"/{row['id']}",
        headers=warehouse["headers"],
        json={
            "title": row["title"],
            "version": row["version"],
            "serial_nos": row["serial_nos"],
            "steps": row["steps"],
            "review_note": "核对完成",
        },
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["created_by_user_id"] == owner["id"]
    published = client.post(
        URL + f"/{row['id']}/publish",
        headers=warehouse["headers"],
        json={"version": saved.json()["version"]},
    )
    assert published.status_code == 200, published.text
    assert published.json()["state"] == "published"


def test_intake_publishes_binds_once_and_preserves_original(client, warehouse):
    payload = route_payload(client, warehouse)
    result = intake(client, warehouse, process_route=payload)
    assert result.status_code == 201, result.text
    body = result.json()
    assert body["process_route"]["id"] == payload["id"]
    assert body["process_route"]["step_index"] == 0
    assert body["process_route"]["complete"] is True
    assert body["process_route"]["next_team_id"] == warehouse["other"]["id"]
    assert intake(client, warehouse, process_route=payload).json() == body
    with SessionLocal() as db:
        route = db.get(ProcessRoute, payload["id"])
        assert route.state == "published" and route.version == 2
        assert route.source_file == b"original document bytes"
        assert route.source_data["tables"] == [["原件内容"]]
        assert route.source_data["original_steps"][0]["team_name"] is None
        assert db.scalar(select(func.count(MaterialTransfer.id))) == 1
        assert db.scalar(select(func.count(ProcessRoutePath.route_id))) == 4
    published = client.get(URL + f"/{payload['id']}").json()
    reused = {key: published[key] for key in payload}
    second = intake(
        client, warehouse, process_route=reused, idempotency_key="second-lot-same-route"
    )
    assert second.status_code == 201, second.text
    changed = deepcopy(reused)
    changed["steps"][1]["instructions"] = "擅改已发布工艺"
    denied = intake(client, warehouse, process_route=changed, idempotency_key="published-edited")
    assert denied.status_code == 409
    with SessionLocal() as db:
        assert db.scalar(select(func.count(MaterialTransfer.id))) == 2


@pytest.mark.parametrize("bad", ["serial", "warehouse", "task", "version", "id", "return", "scrap"])
def test_invalid_route_cannot_leave_published_route_or_stock(client, warehouse, bad):
    route = route_payload(client, warehouse)
    original_id = route["id"]
    extra = {}
    if bad == "serial":
        route["serial_nos"] = ["OTHER-SERIAL"]
    elif bad == "warehouse":
        route["steps"][0]["team_id"] = warehouse["other"]["id"]
    elif bad == "task":
        route["steps"][1]["processing_task_id"] = None
    elif bad == "version":
        route["version"] = 99
    elif bad == "id":
        route["id"] = 999999
    elif bad == "return":
        extra = {"receipt_kind": "return", "external_source": "返料单位"}
    elif bad == "scrap":
        extra = {"material_type": "waste"}
    result = intake(client, warehouse, process_route=route, **extra)
    assert result.status_code in (404, 409, 422), result.text
    assert_no_receipt(original_id)


def test_another_warehouse_account_cannot_claim_draft_by_name(client, warehouse):
    payload = route_payload(client, warehouse)
    other, headers = _leader(client, "second-warehouse", warehouse["team"]["id"])
    with SessionLocal() as db:
        route = db.get(ProcessRoute, payload["id"])
        route.created_by = other["display_name"]
        db.commit()
    assert client.get(URL + f"/{payload['id']}", headers=headers).status_code == 403
    assert client.get(URL + f"/{payload['id']}/source", headers=headers).status_code == 403
    assert client.get(URL, headers=headers).json()["total"] == 0
    write = {key: value for key, value in payload.items() if key != "id"}
    assert client.put(URL + f"/{payload['id']}", headers=headers, json=write).status_code == 403
    assert (
        client.post(
            URL + f"/{payload['id']}/publish", headers=headers, json={"version": payload["version"]}
        ).status_code
        == 403
    )
    forged = client.post(
        warehouse["url"],
        headers=headers,
        json={
            "serial_no": "WAREHOUSE-001",
            "material_name": "铜钼",
            "material_type": "semi_finished",
            "quantity": 100,
            "weight": 10,
            "idempotency_key": "claim-other-draft",
            "process_route": payload,
        },
    )
    assert forged.status_code == 403, forged.text
    assert_no_receipt(payload["id"])


def test_failure_after_route_review_rolls_back_publication(client, warehouse):
    payload = route_payload(client, warehouse)
    # A missing selected location fails after route validation/publication, before stock creation.
    result = intake(client, warehouse, process_route=payload, warehouse_location="不存在的仓位")
    assert result.status_code == 422, result.text
    assert_no_receipt(payload["id"])


def test_optional_route_keeps_pre_upgrade_idempotency_hash():
    data = {
        "serial_no": "OLD-SERIAL",
        "material_name": "铜钼",
        "material_type": "semi_finished",
        "quantity": 100,
        "weight": "10.125",
        "notes": "",
        "idempotency_key": "old-intake",
    }
    # Frozen using the pre-route WarehouseReceiptCreate/fingerprint contract.
    expected = "4f0c74609c43a7f041cf356a00b1161f763a4338b75ec257d6985d9b48c5c09f"
    assert (
        material_transfer_workflow._creation_fingerprint(
            WarehouseReceiptCreate.model_validate(data)
        )
        == expected
    )
    assert (
        material_transfer_workflow._creation_fingerprint(
            WarehouseReceiptCreate.model_validate({**data, "process_route": None})
        )
        == expected
    )


def test_shared_intake_keeps_one_physical_origin_with_all_route_serials(client, warehouse):
    payload = route_payload(client, warehouse)
    payload["serial_nos"] = ["ORDER-A", "ORDER-B"]
    payload["steps"][1]["split_here"] = True
    shared = [
        {
            "serial_no": serial,
            "planned_weight": weight,
            "planned_quantity": quantity,
            "planned_specification": "25 × 10 × 2 mm",
        }
        for serial, weight, quantity in (("ORDER-A", 6, 60), ("ORDER-B", 4, 40))
    ]
    result = intake(
        client, warehouse, process_route=payload, serial_no="", shared_serials=shared, weight=10
    )
    assert result.status_code == 201, result.text
    body = result.json()
    assert body["shared_unallocated"] is True
    assert {member["serial_no"] for member in body["shared_serials"]} == set(payload["serial_nos"])
    assert body["quantity"] == 100 and body["weight"] == 10
    assert body["process_route"]["step_index"] == 0
    with SessionLocal() as db:
        assert db.scalar(select(func.count(MaterialTransfer.id))) == 1
        assert db.get(ProcessRoute, payload["id"]).serial_nos == payload["serial_nos"]


def test_migration_adds_owner_to_existing_drafts_without_claiming_them(tmp_path):
    import importlib.util
    from pathlib import Path

    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext
    from sqlalchemy import create_engine, inspect, text

    source = Path(__file__).parents[1] / "alembic/versions/20261023_0047_process_routes.py"
    spec = importlib.util.spec_from_file_location("route_owner_migration", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    engine = create_engine("sqlite:///" + str(tmp_path / "route-owner.sqlite"))
    try:
        with engine.begin() as connection:
            connection.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY)"))
            connection.execute(
                text("CREATE TABLE process_routes (id INTEGER PRIMARY KEY, created_by VARCHAR(80))")
            )
            connection.execute(text("INSERT INTO process_routes VALUES (1, '旧姓名')"))
            for name in (
                "material_transfers",
                "material_quantity_adjustments",
                "production_schedules",
                "material_inspections",
            ):
                connection.execute(text(f"CREATE TABLE {name} (id INTEGER PRIMARY KEY)"))
            module.op = Operations(MigrationContext.configure(connection))
            module.upgrade()
            module.upgrade()
            assert connection.execute(
                text("SELECT id, created_by, created_by_user_id FROM process_routes")
            ).one() == (1, "旧姓名", None)
            assert any(
                item["referred_table"] == "users"
                for item in inspect(connection).get_foreign_keys("process_routes")
            )
    finally:
        engine.dispose()


def test_route_options_exposes_only_active_execution_vocabulary(client, warehouse):
    from app.models import Team, TeamProcessingTask

    team_id = warehouse["other"]["id"]
    base = f"/api/team-materials/{team_id}"
    task = client.post(base + "/processing-tasks", json={"name": "精轧"}).json()
    purpose = client.post(base + "/purposes", json={"name": "轧制加工"}).json()
    assert (
        client.post(
            base + "/processing-tasks", json={"name": "停用任务", "active": False}
        ).status_code
        == 201
    )
    assert (
        client.post(base + "/purposes", json={"name": "停用业务", "active": False}).status_code
        == 201
    )
    response = client.get(URL + f"/options/{team_id}", headers=warehouse["headers"])
    assert response.status_code == 200, response.text
    assert response.json() == {"tasks": [task], "purposes": [purpose]}
    assert client.get(URL + f"/options/{team_id}").json() == response.json()
    assert (
        client.get(URL + f"/options/{team_id}", headers=warehouse["other_headers"]).status_code
        == 403
    )
    assert client.get(base + "/processing-tasks", headers=warehouse["headers"]).status_code == 403
    assert (
        client.post(
            base + "/processing-tasks", headers=warehouse["headers"], json={"name": "越权任务"}
        ).status_code
        == 403
    )
    warehouse_id = warehouse["team"]["id"]
    with SessionLocal() as db:
        # Historical/misconfigured warehouse task rows must not become executable options.
        db.add(TeamProcessingTask(team_id=warehouse_id, name="旧仓库任务"))
        db.commit()
    own = client.get(URL + f"/options/{warehouse_id}", headers=warehouse["headers"])
    assert own.status_code == 200 and own.json()["tasks"] == []
    with SessionLocal() as db:
        db.get(Team, team_id).active = False
        db.commit()
    assert client.get(URL + f"/options/{team_id}", headers=warehouse["headers"]).status_code == 404
