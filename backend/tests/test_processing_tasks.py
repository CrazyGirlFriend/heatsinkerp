"""Tasks count separate worker operations while each physical unit remains unique."""

import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from app.database import SessionLocal
from app.models import MaterialStockBalance, TeamProcessingTask
from sqlalchemy import create_engine
from test_processing_daily import setup_lot, work
from test_warehouse_classification import base, confirm, dispatch
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401


def tasks(client, s):
    url = base(s, True)
    result = []
    for name in ("粗磨", "精磨"):
        response = client.post(url + "/processing-tasks", json={"name": name})
        assert response.status_code == 201, response.text
        result.append(response.json())
    return result


def ctx(client, s, lot):
    result = client.get(base(s, True) + f"/stock/{lot['id']}/quantity-adjustments")
    assert result.status_code == 200, result.text
    return result.json()


def test_task_directory_permissions_versions_and_duplicate_names(client, warehouse):
    s = warehouse
    url = base(s, True) + "/processing-tasks"
    assert client.get(url, headers=s["headers"]).status_code == 403
    assert client.post(url, headers=s["headers"], json={"name": "粗磨"}).status_code == 403
    assert client.post(base(s) + "/processing-tasks", json={"name": "库房加工"}).status_code == 422
    response = client.post(url, headers=s["other_headers"], json={"name": " 粗磨 "})
    assert response.status_code == 201, response.text
    row = response.json()
    assert row["name"] == "粗磨"
    assert client.post(url, json={"name": "粗磨"}).status_code == 409
    endpoint = url + f"/{row['id']}"
    assert client.patch(endpoint, json={"name": "粗研", "expected_version": 9}).status_code == 409
    response = client.patch(endpoint, json={"name": "粗研", "expected_version": 1})
    assert response.status_code == 200 and response.json()["version"] == 2
    assert (
        client.patch(endpoint, json={"name": "另一个改名", "expected_version": 1}).status_code
        == 409
    )
    assert client.get(url).json()[0]["name"] == "粗研"


def test_two_tasks_keep_100_physical_pieces_and_group_work_separately(client, warehouse):
    s = warehouse
    lot, employee = setup_lot(client, s, quantity=100)
    first_task, second_task = tasks(client, s)
    url = base(s, True)
    purpose = client.post(url + "/purposes", json={"name": "产品加工"}).json()
    first = work(
        client, s, lot, employee, processing_task_id=first_task["id"], purpose_id=purpose["id"]
    )
    assert first.status_code == 201, first.text
    record1 = first.json()
    child = record1["outputs"][0]
    context = ctx(client, s, child)
    assert context["task_required"]
    assert context["completed_task_ids"] == [first_task["id"]]
    assert context["allowed_task_ids"] == [second_task["id"]]
    assert context["purpose_id"] == purpose["id"]
    candidates = client.get(url + "/processing-stock").json()
    assert candidates["total"] == 1 and candidates["items"][0]["transfer"]["id"] == child["id"]
    assert (
        work(
            client,
            s,
            child,
            employee,
            processing_task_id=first_task["id"],
            idempotency_key="same-task",
        ).status_code
        == 409
    )
    second = work(
        client,
        s,
        child,
        employee,
        processing_task_id=second_task["id"],
        idempotency_key="second-task",
    )
    assert second.status_code == 201, second.text
    final = second.json()["outputs"][0]
    totals = client.get(url + "/overview").json()["totals"]
    assert totals["on_hand_quantity"] == 100 and totals["on_hand_weight"] == 100
    assert ctx(client, s, final)["allowed_task_ids"] == []
    assert client.get(url + "/processing-stock").json()["total"] == 0
    daily = client.get(url + "/processing-daily").json()["items"]
    assert {(row["processing_task_name"], row["completed_quantity"]) for row in daily} == {
        ("粗磨", 100),
        ("精磨", 100),
    }
    summary = client.get(url + "/processing-records").json()["summary"]
    assert summary["completed_quantity"] == 200 and summary["employee_day_count"] == 1
    assert summary["daily_group_count"] == 2
    assert summary["record_count"] == 2
    with SessionLocal() as db:
        assert db.get(MaterialStockBalance, lot["id"]).on_hand_quantity == 0
        assert db.get(MaterialStockBalance, child["id"]).on_hand_quantity == 0
        assert db.get(MaterialStockBalance, final["id"]).on_hand_quantity == 100


def test_partial_task_remaining_keeps_only_previous_completed_tasks(client, warehouse):
    s = warehouse
    lot, employee = setup_lot(client, s)
    task1, task2 = tasks(client, s)
    first = work(client, s, lot, employee, processing_task_id=task1["id"]).json()
    first_child = first["outputs"][0]
    second = work(
        client,
        s,
        first_child,
        employee,
        processing_task_id=task2["id"],
        completed_quantity=4,
        completed_weight=40,
        idempotency_key="partial-second",
    )
    assert second.status_code == 201, second.text
    done, remaining = second.json()["outputs"]
    assert set(ctx(client, s, done)["completed_task_ids"]) == {task1["id"], task2["id"]}
    context = ctx(client, s, remaining)
    assert context["completed_task_ids"] == [task1["id"]]
    assert context["allowed_task_ids"] == [task2["id"]]
    assert {row["processing_task_id"] for row in context["rework_task_records"]} == {task1["id"]}
    assert (
        work(
            client,
            s,
            remaining,
            employee,
            processing_task_id=task2["id"],
            work_kind="rework",
            idempotency_key="not-completed-task",
        ).status_code
        == 409
    )
    finish = work(
        client,
        s,
        remaining,
        employee,
        processing_task_id=task2["id"],
        idempotency_key="finish-second",
    )
    assert finish.status_code == 201, finish.text
    daily = client.get(
        base(s, True) + "/processing-daily", params={"processing_task_id": task2["id"]}
    ).json()
    assert daily["total"] == 1 and daily["items"][0]["completed_quantity"] == 10


def test_task_rework_selects_correct_original_after_another_task(client, warehouse):
    s = warehouse
    lot, employee = setup_lot(client, s)
    task1, task2 = tasks(client, s)
    first = work(client, s, lot, employee, processing_task_id=task1["id"]).json()
    second = work(
        client,
        s,
        first["outputs"][0],
        employee,
        processing_task_id=task2["id"],
        idempotency_key="second",
    ).json()
    lot = second["outputs"][0]
    records = {
        row["processing_task_id"]: row["rework_of_id"]
        for row in ctx(client, s, lot)["rework_task_records"]
    }
    assert records == {task1["id"]: first["id"], task2["id"]: second["id"]}
    bad = work(
        client,
        s,
        lot,
        employee,
        processing_task_id=task1["id"],
        work_kind="rework",
        rework_of_id=second["id"],
        idempotency_key="wrong-original",
    )
    assert bad.status_code == 409
    result = work(
        client,
        s,
        lot,
        employee,
        processing_task_id=task1["id"],
        work_kind="rework",
        rework_of_id=first["id"],
        idempotency_key="rework-first",
    )
    assert result.status_code == 201, result.text
    assert result.json()["rework_of_id"] == first["id"]
    daily = client.get(
        base(s, True) + "/processing-daily", params={"processing_task_id": task1["id"]}
    ).json()["items"][0]
    assert (daily["completed_quantity"], daily["rework_quantity"]) == (10, 10)
    totals = client.get(base(s, True) + "/overview").json()["totals"]
    assert totals["on_hand_quantity"] == 10


def test_remaining_of_later_task_can_rework_an_earlier_completed_task(client, warehouse):
    s = warehouse
    lot, employee = setup_lot(client, s)
    task1, task2 = tasks(client, s)
    first = work(client, s, lot, employee, processing_task_id=task1["id"]).json()
    second = work(
        client,
        s,
        first["outputs"][0],
        employee,
        processing_task_id=task2["id"],
        completed_quantity=4,
        completed_weight=40,
        idempotency_key="partial-second",
    ).json()
    remaining = second["outputs"][1]
    candidates = client.get(
        base(s, True) + "/processing-stock", params={"rework_record_id": first["id"]}
    ).json()
    assert {row["transfer"]["id"] for row in candidates["items"]} == {
        remaining["id"],
        second["outputs"][0]["id"],
    }
    other_candidates = client.get(
        base(s, True) + "/processing-stock", params={"rework_record_id": second["id"]}
    ).json()
    assert [row["transfer"]["id"] for row in other_candidates["items"]] == [
        second["outputs"][0]["id"]
    ]
    result = work(
        client,
        s,
        remaining,
        employee,
        processing_task_id=task1["id"],
        work_kind="rework",
        rework_of_id=first["id"],
        idempotency_key="rework-earlier-task",
    )
    assert result.status_code == 201, result.text
    assert result.json()["completed_quantity"] == 6
    assert ctx(client, s, result.json()["outputs"][0])["completed_task_ids"] == [task1["id"]]
    assert client.get(base(s, True) + "/overview").json()["totals"]["on_hand_quantity"] == 10


def test_rework_preserves_original_task_business_even_when_disabled_or_legacy(client, warehouse):
    s = warehouse
    lot, employee = setup_lot(client, s)
    legacy = work(client, s, lot, employee).json()
    task1, _ = tasks(client, s)
    url = base(s, True)
    purpose = client.post(url + "/purposes", json={"name": "原业务"}).json()
    first = work(
        client,
        s,
        legacy["outputs"][0],
        employee,
        processing_task_id=task1["id"],
        purpose_id=purpose["id"],
        idempotency_key="named-task",
    ).json()
    client.patch(
        url + f"/processing-tasks/{task1['id']}",
        json={"name": "更名任务", "active": False, "expected_version": 1},
    )
    client.patch(
        url + f"/purposes/{purpose['id']}",
        json={"name": "更名业务", "active": False, "expected_version": 1},
    )
    retry = work(
        client,
        s,
        first["outputs"][0],
        employee,
        processing_task_id=task1["id"],
        purpose_id=purpose["id"],
        work_kind="rework",
        rework_of_id=first["id"],
        idempotency_key="disabled-task-rework",
    )
    assert retry.status_code == 201, retry.text
    assert (retry.json()["processing_task_name"], retry.json()["purpose_name"]) == (
        "粗磨",
        "原业务",
    )
    legacy_retry = work(
        client,
        s,
        retry.json()["outputs"][0],
        employee,
        work_kind="rework",
        rework_of_id=legacy["id"],
        idempotency_key="legacy-rework",
    )
    assert legacy_retry.status_code == 201, legacy_retry.text
    assert legacy_retry.json()["processing_task_id"] is None
    assert legacy_retry.json()["purpose_id"] is None
    assert client.get(url + "/overview").json()["totals"]["on_hand_quantity"] == 10
    summary = client.get(url + "/processing-records").json()["summary"]
    assert summary["completed_quantity"] == 20 and summary["rework_quantity"] == 20


def test_task_validation_legacy_no_task_disabled_and_cross_team(client, warehouse):
    s = warehouse
    lot, employee = setup_lot(client, s)
    old = work(client, s, lot, employee)
    assert old.status_code == 201 and old.json()["processing_task_id"] is None
    child = old.json()["outputs"][0]
    assert work(client, s, child, employee, idempotency_key="legacy-repeat").status_code == 409
    task1, task2 = tasks(client, s)
    assert work(client, s, child, employee, idempotency_key="missing-task").status_code == 422
    with SessionLocal() as db:
        foreign = TeamProcessingTask(team_id=s["team"]["id"], name="外班组任务")
        db.add(foreign)
        db.commit()
        foreign_id = foreign.id
    assert (
        work(
            client, s, child, employee, processing_task_id=foreign_id, idempotency_key="foreign"
        ).status_code
        == 422
    )
    for task in (task1, task2):
        assert (
            client.patch(
                base(s, True) + f"/processing-tasks/{task['id']}",
                json={"name": task["name"], "active": False, "expected_version": 1},
            ).status_code
            == 200
        )
    assert (
        work(
            client, s, child, employee, processing_task_id=task1["id"], idempotency_key="disabled"
        ).status_code
        == 422
    )
    assert work(client, s, child, employee, idempotency_key="no-task-bypass").status_code == 422
    assert (
        ctx(client, s, child)["task_required"] and ctx(client, s, child)["allowed_task_ids"] == []
    )
    client.patch(
        base(s, True) + f"/processing-tasks/{task1['id']}",
        json={"name": task1["name"], "active": True, "expected_version": 2},
    )
    valid = work(
        client, s, child, employee, processing_task_id=task1["id"], idempotency_key="new-task"
    )
    assert valid.status_code == 201, valid.text


def test_task_date_replay_filters_and_immutable_names(client, warehouse):
    s = warehouse
    lot, employee = setup_lot(client, s)
    task1, task2 = tasks(client, s)
    url = base(s, True)
    purpose1 = client.post(url + "/purposes", json={"name": "业务一"}).json()
    purpose2 = client.post(url + "/purposes", json={"name": "业务二"}).json()
    extra = {
        "processing_task_id": task1["id"],
        "purpose_id": purpose1["id"],
        "expected_revision": 0,
        "quantity": 10,
        "completed_quantity": 10,
        "completed_weight": 100,
    }
    first = work(client, s, lot, employee, **extra)
    assert first.status_code == 201, first.text
    assert work(client, s, lot, employee, **extra).json() == first.json()
    assert (
        work(client, s, lot, employee, **{**extra, "purpose_id": purpose2["id"]}).status_code == 409
    )
    child = first.json()["outputs"][0]
    assert (
        work(
            client,
            s,
            child,
            employee,
            processing_task_id=task2["id"],
            processing_date="2026-10-14",
            idempotency_key="earlier",
        ).status_code
        == 422
    )
    second = work(
        client,
        s,
        child,
        employee,
        processing_task_id=task2["id"],
        purpose_id=purpose2["id"],
        idempotency_key="second",
    )
    assert second.status_code == 201, second.text
    client.patch(
        url + f"/processing-tasks/{task1['id']}",
        json={"name": "粗磨改名", "active": False, "expected_version": 1},
    )
    client.patch(
        url + f"/purposes/{purpose1['id']}",
        json={"name": "业务改名", "active": False, "expected_version": 1},
    )
    params = {
        "processing_task_id": task1["id"],
        "purpose_id": purpose1["id"],
        "processor_id": employee["id"],
        "work_date": "2026-10-15",
    }
    records = client.get(url + "/processing-records", params=params).json()
    daily = client.get(url + "/processing-daily", params=params).json()
    assert records["total"] == daily["total"] == 1
    assert records["summary"]["completed_quantity"] == daily["items"][0]["completed_quantity"] == 10
    assert (
        records["items"][0]["processing_task_name"]
        == daily["items"][0]["processing_task_name"]
        == "粗磨"
    )
    assert records["items"][0]["purpose_name"] == daily["items"][0]["purpose_name"] == "业务一"
    assert records["processing_tasks"] == [
        {"id": task1["id"], "name": "粗磨"},
        {"id": task2["id"], "name": "精磨"},
    ]
    # Read-only viewers can filter facts they can already see, without directory access.
    viewer = client.get(url + "/processing-records", headers=s["headers"]).json()
    assert viewer["processing_tasks"] == records["processing_tasks"]
    assert client.get(url + "/processing-tasks", headers=s["headers"]).status_code == 403
    assert client.get(url + "/processing-records", params={"query": "粗磨"}).json()["total"] == 1
    assert client.get(url + "/processing-daily", params={"query": "业务一"}).json()["total"] == 1


def test_ordinary_transfer_back_starts_a_new_task_cycle(client, warehouse):
    s = warehouse
    lot, employee = setup_lot(client, s)
    task1, _ = tasks(client, s)
    done = work(client, s, lot, employee, processing_task_id=task1["id"]).json()["outputs"][0]
    sent = dispatch(
        client,
        s,
        [{"source_transfer_id": done["id"], "quantity": 10, "weight": 100}],
        workshop=True,
    ).json()
    assert confirm(client, s, sent).status_code == 200
    back = dispatch(
        client,
        s,
        [{"source_transfer_id": sent["items"][0]["id"], "quantity": 10, "weight": 100}],
        idempotency_key="returned",
    ).json()
    assert confirm(client, s, back, workshop=True).status_code == 200
    returned = back["items"][0]
    context = ctx(client, s, returned)
    assert context["completed_task_ids"] == context["rework_task_records"] == []
    result = work(
        client, s, returned, employee, processing_task_id=task1["id"], idempotency_key="new-cycle"
    )
    assert result.status_code == 201, result.text


def test_processing_task_migration_keeps_history_unknown_and_is_repeatable():
    path = Path(__file__).parents[1] / "alembic/versions/20261020_0042_processing_tasks.py"
    spec = importlib.util.spec_from_file_location("processing_tasks_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as conn:
            conn.exec_driver_sql("CREATE TABLE teams (id INTEGER PRIMARY KEY)")
            conn.exec_driver_sql("CREATE TABLE team_purposes (id INTEGER PRIMARY KEY)")
            conn.exec_driver_sql(
                "CREATE TABLE material_quantity_adjustments (id INTEGER PRIMARY KEY, team_id INTEGER, processing_date DATE)"
            )
            conn.exec_driver_sql(
                "INSERT INTO material_quantity_adjustments VALUES (1, 2, '2026-10-15')"
            )
            with Operations.context(MigrationContext.configure(conn)):
                migration.upgrade()
                migration.upgrade()
            assert conn.exec_driver_sql(
                "SELECT processing_task_id, processing_task_name, purpose_id, purpose_name FROM material_quantity_adjustments"
            ).one() == (None, None, None, None)
    finally:
        engine.dispose()
