"""Each planned operation keeps its own requirement and exact rework origin."""

import importlib.util
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from app.database import SessionLocal
from app.models import MaterialQuantityAdjustment, MaterialTransfer
from engineered_rework_helpers import approve_rework, resume_rework
from sqlalchemy import create_engine, text
from test_engineered_rework import approved_quality_issue
from test_process_route_intake import publish_payload, route_payload
from test_processing_daily import work
from test_warehouse_classification import base, confirm, dispatch
from test_warehouse_receipts import intake
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401


def routed_lot(client, s, code="FACTORY-GRIND", second=True):
    assert client.patch(f"/api/teams/{s['other']['id']}", json={"code": code}).status_code == 200
    payload = route_payload(client, s)
    anneal = code == "FACTORY-ANNEAL"
    payload["steps"][1].update(
        name="退火" if anneal else "粗磨",
        instructions="900～950℃，保温60分钟" if anneal else "粗磨至2.55mm，禁止叠放",
    )
    if second:
        payload["steps"].append(
            {
                **payload["steps"][1],
                "sequence_no": 2,
                "name": "退火" if anneal else "精磨",
                "instructions": "700～750℃，保温30分钟" if anneal else "精磨至2.50±0.01mm",
            }
        )
    payload["steps"].append({**payload["steps"][0], "sequence_no": 3, "name": "库房接收"})
    payload = publish_payload(client, payload)
    receipt = intake(client, s, process_route=payload, quantity=10, weight=100)
    assert receipt.status_code == 201, receipt.text
    sent = dispatch(
        client, s, [{"source_transfer_id": receipt.json()["id"], "quantity": 10, "weight": 100}]
    )
    assert sent.status_code == 201, sent.text
    assert confirm(client, s, sent.json(), workshop=True).status_code == 200
    worker = client.get(base(s, True) + "/employees").json()[0]
    return sent.json()["items"][0], worker, payload


def processed(client, s, lot, worker, **extra):
    rework = extra.get("work_kind") == "rework"
    if rework:
        lot = approve_rework(client, s, lot, {"id": extra["rework_of_id"]})
        extra.pop("processing_task_id", None)
    response = work(client, s, lot, worker, idempotency_key=uuid4().hex, **extra)
    assert response.status_code == 201, response.text
    result = response.json()
    if rework:
        for output in result["outputs"]:
            if output["role"] == "produced":
                resume_rework(client, s, output)
    return result


@pytest.mark.parametrize("code", ["FACTORY-GRIND", "FACTORY-ANNEAL"])
def test_same_task_operations_keep_distinct_snapshots_and_rework_selected_earlier_step(
    client, warehouse, code
):
    s = warehouse
    lot, worker, payload = routed_lot(client, s, code)
    first = processed(client, s, lot, worker)
    assert first["process_step_instructions"] == payload["steps"][1]["instructions"]
    first_child = first["outputs"][0]
    assert (
        dispatch(
            client,
            s,
            [{"source_transfer_id": first_child["id"], "quantity": 10, "weight": 100}],
            workshop=True,
        ).status_code
        == 422
    )
    second = processed(client, s, first_child, worker)
    assert first["processing_task_id"] == second["processing_task_id"]
    assert second["process_step_index"] == 2
    assert second["process_step_instructions"] == payload["steps"][2]["instructions"]
    current = second["outputs"][0]
    missing = work(client, s, current, worker, work_kind="rework", idempotency_key="missing-origin")
    assert missing.status_code == 422, missing.text
    ctx = client.get(base(s, True) + f"/stock/{current['id']}/quantity-adjustments").json()
    origins = {item["rework_of_id"]: item for item in ctx["rework_task_records"]}
    assert set(origins) == {first["id"], second["id"]}
    assert origins[first["id"]]["process_step_index"] == 1
    assert origins[second["id"]]["process_step_index"] == 2
    assert origins[first["id"]]["process_step_instructions"] == first["process_step_instructions"]
    result = processed(
        client,
        s,
        current,
        worker,
        work_kind="rework",
        rework_of_id=first["id"],
        processing_task_id=first["processing_task_id"],
    )
    assert result["rework_of_id"] == first["id"]
    assert result["process_route_id"] != first["process_route_id"]
    assert result["process_step_instructions"] == "返工精磨至2.50±0.01mm"
    assert result["processing_task_name"] == "返工精磨"
    child = result["outputs"][0]
    with SessionLocal() as db:
        physical = db.get(MaterialTransfer, child["id"])
        assert physical.process_step_index == 2 and physical.process_step_complete
    totals = client.get(base(s, True) + "/overview").json()["totals"]
    assert totals["on_hand_quantity"] == 10 and totals["on_hand_weight"] == 100
    daily = client.get(base(s, True) + "/processing-daily").json()
    assert daily["total"] == 3
    by_step = {item["process_step_index"]: item for item in daily["items"]}
    assert (by_step[1]["completed_quantity"], by_step[1]["rework_quantity"]) == (10, 0)
    assert (by_step[2]["completed_quantity"], by_step[2]["rework_quantity"]) == (10, 0)
    records = client.get(
        base(s, True) + "/processing-records", params={"query": first["process_step_name"]}
    ).json()
    assert records["total"] == 1
    assert records["summary"]["completed_quantity"] == 10
    performance = client.get(
        "/api/factory-performance",
        params={
            "date_from": "2026-10-15",
            "date_to": "2026-10-15",
            "team_id": s["other"]["id"],
            "work_id": second["id"],
        },
    )
    assert performance.status_code == 200, performance.text
    production = performance.json()["production"]
    assert {item["process_step_index"] for item in production["scopes"]} == {0, 1, 2}
    assert production["scope"]["process_step_index"] == 2
    assert production["totals"]["completed_quantity"] == 10
    assert production["totals"]["rework_quantity"] == 0


def test_partial_later_step_does_not_make_its_remaining_eligible_for_same_task_rework(
    client, warehouse
):
    s = warehouse
    lot, worker, _ = routed_lot(client, s)
    first = processed(client, s, lot, worker)
    # QC identifies the earlier operation's issue before further partial processing.
    first_lot = first["outputs"][0]
    context = client.get(base(s, True) + f"/stock/{first_lot['id']}/quantity-adjustments").json()
    approved_quality_issue(client, s, first_lot, context)
    second = processed(
        client, s, first["outputs"][0], worker, completed_quantity=4, completed_weight=40
    )
    done, remaining = second["outputs"]
    url = base(s, True)
    ctx = client.get(url + f"/stock/{remaining['id']}/quantity-adjustments").json()
    assert ctx["rework_of_id"] == first["id"]
    assert [item["rework_of_id"] for item in ctx["rework_task_records"]] == [first["id"]]
    coarse = client.get(url + "/processing-stock", params={"rework_record_id": first["id"]}).json()
    fine = client.get(url + "/processing-stock", params={"rework_record_id": second["id"]}).json()
    assert {item["transfer"]["id"] for item in coarse["items"]} == {done["id"], remaining["id"]}
    assert [item["transfer"]["id"] for item in fine["items"]] == [done["id"]]
    bad = work(
        client,
        s,
        remaining,
        worker,
        work_kind="rework",
        rework_of_id=second["id"],
        processing_task_id=second["processing_task_id"],
        idempotency_key="not-finished-fine",
    )
    assert bad.status_code == 422, bad.text
    retry = processed(client, s, remaining, worker, work_kind="rework", rework_of_id=first["id"])
    assert retry["process_step_index"] == 0
    with SessionLocal() as db:
        child = db.get(MaterialTransfer, retry["outputs"][0]["id"])
        assert child.process_step_index == 1 and child.process_step_complete


def test_repeated_local_operations_deliver_only_against_final_step_schedule(client, warehouse):
    s = warehouse
    lot, worker, route = routed_lot(client, s)
    nodes = []
    # A team's delivery milestone follows its final consecutive local operation.
    for index in (0, 2, 3):
        nodes.append(
            {
                "process_route_id": route["id"],
                "process_step_index": index,
                "team_id": route["steps"][index]["team_id"],
                "next_team_id": route["steps"][index + 1]["team_id"] if index < 3 else None,
                "external_destination": None if index < 3 else "库房成品",
                "due_at": "2026-12-01T12:00:00+08:00",
                "target_quantity": 10,
            }
        )
    saved = client.post(
        "/api/production-schedules/tasks",
        json={
            "title": "粗磨精磨同班组交货",
            "serial_no": lot["serial_no"],
            "idempotency_key": uuid4().hex,
            "nodes": nodes,
        },
    )
    assert saved.status_code == 201, saved.text
    task_id = saved.json()["id"]
    coarse = processed(client, s, lot, worker)
    fine = processed(client, s, coarse["outputs"][0], worker)
    rework = processed(
        client, s, fine["outputs"][0], worker, work_kind="rework", rework_of_id=coarse["id"]
    )
    child = rework["outputs"][0]
    sent = dispatch(
        client,
        s,
        [{"source_transfer_id": child["id"], "quantity": 6, "weight": 60}],
        workshop=True,
    )
    assert sent.status_code == 201, sent.text
    task = client.get(f"/api/production-schedules/tasks/{task_id}").json()
    assert task["nodes"][1]["process_step_index"] == 2
    assert task["nodes"][1]["dispatched_quantity"] == 6
    assert task["nodes"][1]["completed_at"] is None
    assert task["nodes"][2]["dispatched_quantity"] == 0


def test_old_missing_requirements_need_new_engineering_instruction_for_rework(client, warehouse):
    s = warehouse
    lot, worker, _ = routed_lot(client, s)
    first = processed(client, s, lot, worker)
    with SessionLocal() as db:
        # Simulate an existing 0047 row before the nullable 0048 snapshot was added.
        db.connection().execute(
            MaterialQuantityAdjustment.__table__.update()
            .where(MaterialQuantityAdjustment.id == first["id"])
            .values(process_step_instructions=None)
        )
        db.commit()
    child = first["outputs"][0]
    ctx = client.get(base(s, True) + f"/stock/{child['id']}/quantity-adjustments").json()
    assert ctx["rework_task_records"][0]["process_step_instructions"] is None
    retry = processed(client, s, child, worker, work_kind="rework", rework_of_id=first["id"])
    assert retry["process_step_name"] == "1 · 返工精磨"
    assert retry["process_step_instructions"] == "返工精磨至2.50±0.01mm"


def test_inline_outbound_completion_uses_same_requirement_snapshot(client, warehouse):
    s = warehouse
    lot, worker, payload = routed_lot(client, s, code="FACTORY-ROLL", second=False)
    ctx = client.get(base(s, True) + f"/stock/{lot['id']}/quantity-adjustments").json()
    response = dispatch(
        client,
        s,
        [{"source_transfer_id": lot["id"], "quantity": 10, "weight": 100}],
        workshop=True,
        quantity_adjustments=[
            dict(
                source_transfer_id=lot["id"],
                expected_revision=ctx["revision"],
                quantity=10,
                processor_employee_id=worker["id"],
                processor_name=worker["name"],
                processing_date="2026-10-15",
                processing_mode="split",
                input_quantity=10,
                processing_status="complete",
            )
        ],
    )
    assert response.status_code == 201, response.text
    row = client.get(base(s, True) + "/processing-records").json()["items"][0]
    assert row["process_step_instructions"] == payload["steps"][1]["instructions"]
    assert row["process_step_index"] == 1


def test_0048_adds_nullable_snapshot_to_existing_history_and_repeats(tmp_path):
    source = (
        Path(__file__).parents[1] / "alembic/versions/20261023_0048_processing_step_instructions.py"
    )
    spec = importlib.util.spec_from_file_location("step_instructions_migration", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    engine = create_engine("sqlite:///" + str(tmp_path / "0048.sqlite"))
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "CREATE TABLE material_quantity_adjustments (id INTEGER PRIMARY KEY, process_step_name VARCHAR(120))"
                )
            )
            connection.execute(text("INSERT INTO material_quantity_adjustments VALUES (1, '粗磨')"))
            module.op = Operations(MigrationContext.configure(connection))
            module.upgrade()
            module.upgrade()
            assert connection.execute(
                text(
                    "SELECT process_step_name, process_step_instructions FROM material_quantity_adjustments"
                )
            ).one() == ("粗磨", None)
    finally:
        engine.dispose()
