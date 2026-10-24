"""Word review and route execution on partial physical stock."""

from uuid import uuid4

from app.database import SessionLocal
from app.models import MaterialTransfer, ProcessRoute, TeamEmployee
from sqlalchemy import func, select
from test_process_route_import import CONTENT_TYPES, PROCESS, docx
from test_quantity_adjustments import change
from test_warehouse_classification import base, confirm, dispatch
from test_warehouse_receipts import intake
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

URL = "/api/process-routes"


def word(rows):
    return docx(rows)


def imported(client):
    data = word(
        [
            ["流水号", "尺寸规格"],
            ["WAREHOUSE-001", "按图纸"],
            ["序号", "工序名称", "工艺要求", "计划完成天数", "计划加工数量"],
            [0, "中转库", "备料", "0", "100"],
            [1, "轧板", "厚度2.5(+0.01/-0.02)，禁止摞放", "7", "100"],
            [1, "轧板", "重复原行", "7", "100"],
        ]
    )
    response = client.post(URL + "/import", files={"file": ("工艺.docx", data)})
    assert response.status_code == 201, response.text
    return response.json(), data


def test_invalid_word_package_leaves_no_draft_and_valid_original_is_preserved(client):
    for parts in (
        {"[Content_Types].xml": None},
        {"_rels/.rels": None},
        {
            "[Content_Types].xml": CONTENT_TYPES.replace(
                "wordprocessingml.document.main+xml", "spreadsheetml.sheet.main+xml"
            )
        },
    ):
        content = docx([["流水号", "OPC-VALIDATION"], *PROCESS], parts=parts)
        response = client.post(URL + "/import", files={"file": ("工艺.docx", content)})
        assert response.status_code == 422, response.text
        with SessionLocal() as db:
            assert db.scalar(select(func.count(ProcessRoute.id))) == 0
    content = docx([["流水号", "OPC-VALIDATION"], *PROCESS])
    response = client.post(URL + "/import", files={"file": ("工艺.docx", content)})
    assert response.status_code == 201, response.text
    source = client.get(URL + f"/{response.json()['id']}/source")
    assert source.status_code == 200 and source.content == content


def published(client, s, same_team=False):
    row, _ = imported(client)
    task = client.post(base(s, True) + "/processing-tasks", json={"name": "精轧"}).json()
    purpose = client.post(base(s, True) + "/purposes", json={"name": "产品加工"}).json()
    steps = row["steps"][:2]
    steps[0]["team_id"] = s["team"]["id"]
    steps[1].update(
        team_id=s["other"]["id"], processing_task_id=task["id"], purpose_id=purpose["id"]
    )
    if same_team:
        steps.append({**steps[1], "sequence_no": 2, "name": "二次轧板"})
    steps.append({**steps[0], "sequence_no": 3, "name": "库房成品入库"})
    result = client.put(
        URL + f"/{row['id']}",
        json={
            "title": "首批派工",
            "serial_nos": ["WAREHOUSE-001"],
            "steps": steps,
            "version": 1,
            "review_note": "已核对重复行",
        },
    )
    assert result.status_code == 200, result.text
    result = client.post(URL + f"/{row['id']}/publish", json={"version": result.json()["version"]})
    assert result.status_code == 200, result.text
    return result.json()


def bind(client, route, lot, **kwargs):
    return client.post(
        URL + f"/{route['id']}/bind", json={"source_transfer_ids": [lot["id"]]}, **kwargs
    )


def receive(client, s, lot):
    result = dispatch(
        client,
        s,
        [{"source_transfer_id": lot["id"], "quantity": lot["quantity"], "weight": lot["weight"]}],
    )
    assert result.status_code == 201, result.text
    assert confirm(client, s, result.json(), workshop=True).status_code == 200
    item = result.json()["items"][0]
    detail = client.get("/api/material-transfers/" + item["batch_no"]).json()
    assert detail["process_route"]["id"] == item["process_route"]["id"]
    return item


def work(client, s, lot, partial=False):
    outputs = [
        {
            "role": "produced",
            "quantity": 60 if partial else 100,
            "weight": 6 if partial else 10,
            "material_type": "semi_finished",
        }
    ]
    if partial:
        outputs.append(
            {"role": "remaining", "quantity": 40, "weight": 4, "material_type": "semi_finished"}
        )
    with SessionLocal() as db:
        employee_id = db.scalar(
            select(TeamEmployee.id).where(TeamEmployee.team_id == s["other"]["id"])
        )
    return change(
        client,
        s,
        lot,
        100,
        processor_employee_id=employee_id,
        workshop=True,
        key=uuid4().hex,
        processing_mode="split",
        processing_date="2026-10-23",
        input_quantity=lot["quantity"],
        processing_status="partial" if partial else "complete",
        outputs=outputs,
    )


def test_word_review_permissions_original_and_revision(client, warehouse):
    s = warehouse
    row, data = imported(client)
    assert row["serial_nos"] == ["WAREHOUSE-001"]
    assert row["steps"][0]["team_id"] == s["team"]["id"]
    assert row["source_data"]["original_steps"][0]["name"] == "中转库"
    assert row["source_data"]["original_steps"][0]["team_id"] is None

    assert len(row["steps"]) == 3 and "重复" in row["source_data"]["issues"][0]
    assert client.get(URL + f"/{row['id']}/source").content == data
    assert (
        client.post(
            URL + "/import", headers=s["headers"], files={"file": ("a.docx", data)}
        ).status_code
        == 403
    )
    assert client.post(URL + f"/{row['id']}/publish", json={"version": 1}).status_code == 422
    assert client.post(URL + "/import", files={"file": ("a.docx", b"bad")}).status_code == 422
    assert (
        client.post(
            URL + "/import", files={"file": ("a.docx", b"x" * (5 * 1024 * 1024 + 1))}
        ).status_code
        == 413
    )
    route = published(client, s)
    payload = {
        key: route[key] for key in ("title", "steps", "serial_nos", "review_note", "version")
    }
    assert client.put(URL + f"/{route['id']}", json=payload).status_code == 409
    new = client.post(URL + f"/{route['id']}/revise").json()
    assert new["state"] == "draft" and new["parent_id"] == route["id"]


def test_partial_processed_and_remaining_stock_have_separate_cursors(client, warehouse):
    s = warehouse
    route = published(client, s)
    lot = intake(client, s, weight=10).json()
    lines = [{"source_transfer_id": lot["id"], "quantity": 100, "weight": 10}]
    assert dispatch(client, s, lines).status_code == 422
    assert bind(client, route, lot, headers=s["other_headers"]).status_code == 403
    assert bind(client, route, lot).status_code == 200
    current = receive(client, s, lot)
    assert current["process_route"]["step_index"] == 1 and not current["process_route"]["complete"]
    assert (
        dispatch(
            client,
            s,
            [{"source_transfer_id": current["id"], "quantity": 100, "weight": 10}],
            workshop=True,
        ).status_code
        == 422
    )
    done = work(client, s, current, True)
    assert done.status_code == 201, done.text
    assert done.json()["process_step_name"] == "1 · 轧板"
    good, remaining = done.json()["outputs"]
    assert (
        dispatch(
            client,
            s,
            [{"source_transfer_id": remaining["id"], "quantity": 40, "weight": 4}],
            workshop=True,
        ).status_code
        == 422
    )
    out = dispatch(
        client, s, [{"source_transfer_id": good["id"], "quantity": 60, "weight": 6}], workshop=True
    )
    assert out.status_code == 201, out.text
    assert out.json()["items"][0]["process_route"]["sequence_no"] == 3
    with SessionLocal() as db:
        assert not db.get(MaterialTransfer, remaining["id"]).process_step_complete
        assert db.get(MaterialTransfer, good["id"]).process_step_complete


def test_planned_repeated_local_task_is_not_rework(client, warehouse):
    s = warehouse
    route = published(client, s, True)
    lot = intake(client, s, weight=10).json()
    assert bind(client, route, lot).status_code == 200
    current = receive(client, s, lot)
    result = work(client, s, current)
    assert result.status_code == 201, result.text
    child = result.json()["outputs"][0]
    assert (
        dispatch(
            client,
            s,
            [{"source_transfer_id": child["id"], "quantity": 100, "weight": 10}],
            workshop=True,
        ).status_code
        == 422
    )
    ctx = client.get(base(s, True) + f"/stock/{child['id']}/quantity-adjustments").json()
    assert ctx["process_route"]["sequence_no"] == 2
    choices = client.get(base(s, True) + "/processing-stock").json()
    assert child["id"] in {item["transfer"]["id"] for item in choices["items"]}

    result = work(client, s, child)
    assert result.status_code == 201, result.text
    assert result.json()["work_kind"] == "initial" and result.json()["process_step_index"] == 2


def test_legacy_warehouse_stock_requires_route_before_first_transfer(client, warehouse):
    lot = intake(client, warehouse).json()
    imported(client)
    assert (
        dispatch(
            client, warehouse, [{"source_transfer_id": lot["id"], "quantity": 100, "weight": 10}]
        ).status_code
        == 422
    )


def test_shared_common_work_then_designated_partial_split_preserves_remaining_step(
    client, warehouse
):
    s = warehouse
    route = published(client, s, True)
    draft = client.post(URL + f"/{route['id']}/revise").json()
    steps = draft["steps"]
    steps[2]["split_here"] = True
    steps[3]["serial_nos"] = ["A"]
    steps.append({**steps[3], "sequence_no": 4, "serial_nos": ["B"]})
    saved = client.put(
        URL + f"/{draft['id']}",
        json={
            "title": "共投首批",
            "serial_nos": ["A", "B"],
            "steps": steps,
            "version": draft["version"],
            "review_note": "原文核对，共投在二次轧制时拆分",
        },
    ).json()
    result = client.post(URL + f"/{draft['id']}/publish", json={"version": saved["version"]})
    assert result.status_code == 200, result.text
    route = result.json()
    lot = intake(
        client,
        s,
        serial_no="",
        weight=10,
        shared_serials=[
            {
                "serial_no": "A",
                "planned_weight": 6,
                "planned_quantity": 60,
                "planned_specification": "20×10×2",
            },
            {
                "serial_no": "B",
                "planned_weight": 4,
                "planned_quantity": 40,
                "planned_specification": "10×10×2",
            },
        ],
    ).json()
    assert bind(client, route, lot).status_code == 200
    current = receive(client, s, lot)
    done = work(client, s, current)
    assert done.status_code == 201, done.text
    common = done.json()["outputs"][0]
    assert common["shared_unallocated"]
    with SessionLocal() as db:
        employee = db.scalar(
            select(TeamEmployee.id).where(TeamEmployee.team_id == s["other"]["id"])
        )
    result = change(
        client,
        s,
        common,
        100,
        workshop=True,
        processor_employee_id=employee,
        key="split",
        processing_mode="split",
        processing_date="2026-10-23",
        input_quantity=100,
        processing_status="partial",
        outputs=[
            {
                "role": "produced",
                "serial_no": "A",
                "quantity": 60,
                "weight": 6,
                "material_type": "semi_finished",
            },
            {"role": "remaining", "quantity": 40, "weight": 4, "material_type": "semi_finished"},
        ],
    )
    assert result.status_code == 201, result.text
    assigned, remaining = result.json()["outputs"]
    context = client.get(base(s, True) + f"/stock/{remaining['id']}/quantity-adjustments").json()
    assert context["process_route"]["step_index"] == 2  # Next local step, not a repeat of step 1.
    assert context["process_route"]["split_here"]
    out = dispatch(
        client,
        s,
        [{"source_transfer_id": assigned["id"], "quantity": 60, "weight": 6}],
        workshop=True,
    )
    assert out.status_code == 201, out.text
    assert (
        out.json()["items"][0]["serial_no"] == "A"
        and out.json()["items"][0]["process_route"]["sequence_no"] == 3
    )


def test_route_schedule_reuses_steps_and_auto_matches_partial_delivery(client, warehouse):
    s = warehouse
    route = published(client, s)
    nodes = []
    for index, step in enumerate(route["steps"]):
        nodes.append(
            {
                "team_id": step["team_id"],
                "next_team_id": route["steps"][index + 1]["team_id"] if index < 2 else None,
                "external_destination": None if index < 2 else "库房成品",
                "due_at": "2026-12-01T12:00:00+08:00",
                "target_quantity": 100,
                "completion_basis": "quantity",
                "sources": [],
                "process_route_id": route["id"],
                "process_step_index": index,
            }
        )
    response = client.post(
        "/api/production-schedules/tasks",
        json={
            "title": "工艺交货",
            "serial_no": "WAREHOUSE-001",
            "idempotency_key": uuid4().hex,
            "nodes": nodes,
        },
    )
    assert response.status_code == 201, response.text
    task = response.json()
    lot = intake(client, s, weight=10).json()
    assert bind(client, route, lot).status_code == 200
    current = receive(client, s, lot)
    done = work(client, s, current, True)
    assert done.status_code == 201, done.text
    assigned = done.json()["outputs"][0]
    out = dispatch(
        client,
        s,
        [{"source_transfer_id": assigned["id"], "quantity": 60, "weight": 6}],
        workshop=True,
    )
    assert out.status_code == 201, out.text
    detail = client.get(f"/api/production-schedules/tasks/{task['id']}").json()
    assert detail["nodes"][1]["dispatched_quantity"] == 60
    assert detail["nodes"][0]["assessment_enabled"] is False
    assert detail["nodes"][1]["process_route_id"] == route["id"]
    assert detail["locations"]


def test_route_migration_is_repeatable_preserves_legacy_rows_and_cutover(tmp_path):
    import importlib.util
    from pathlib import Path

    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import create_engine, inspect, text

    filename = Path(__file__).parents[1] / "alembic/versions/20261023_0047_process_routes.py"
    spec = importlib.util.spec_from_file_location("route_migration", filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    engine = create_engine("sqlite:///" + str(tmp_path / "route.sqlite"))
    with engine.begin() as connection:
        for name in (
            "material_transfers",
            "material_quantity_adjustments",
            "production_schedules",
            "material_inspections",
        ):
            connection.execute(
                text(f"CREATE TABLE {name} (id INTEGER PRIMARY KEY, old_value VARCHAR(80))")
            )
            connection.execute(text(f"INSERT INTO {name} VALUES (1, 'existing')"))
        module.op = Operations(MigrationContext.configure(connection))
        module.upgrade()
        cutoff = connection.execute(
            text("SELECT enforced_after FROM process_route_policy")
        ).scalar_one()
        module.upgrade()
        assert (
            cutoff
            == connection.execute(
                text("SELECT enforced_after FROM process_route_policy")
            ).scalar_one()
        )
        for name in ("material_transfers", "material_quantity_adjustments", "production_schedules"):
            assert connection.execute(
                text(f"SELECT old_value, process_route_id FROM {name}")
            ).one() == ("existing", None)
            assert any(
                fk["referred_table"] == "process_routes"
                for fk in inspect(connection).get_foreign_keys(name)
            )
        assert "process_step" in {
            column["name"] for column in inspect(connection).get_columns("material_inspections")
        }
        assert connection.execute(
            text("SELECT old_value, process_step FROM material_inspections")
        ).one() == ("existing", None)
    engine.dispose()
