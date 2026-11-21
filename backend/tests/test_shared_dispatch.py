"""Joint production starts at warehouse transfer and splits into independent routes."""

import json
from copy import deepcopy
from types import SimpleNamespace

import pytest
from app.database import SessionLocal
from app.models import (
    MaterialTransfer,
    ProcessRoute,
    SharedMaterialGroup,
    Team,
    TeamEmployee,
    TeamProcessingTask,
    TeamPurpose,
)
from app.process_routes import dispatch_fields, prepare_processing
from app.shared_material import common_split_index, is_split_step
from fastapi import HTTPException
from route_document_helpers import add_documents
from sqlalchemy import func, select
from test_dispatch_planning import URL, submit
from test_dispatch_planning import dispatcher as dispatcher
from test_engineering_team import author
from test_process_route_intake import publish_payload, route_payload
from test_quantity_adjustments import change
from test_warehouse_classification import base, confirm, dispatch
from test_warehouse_receipts import intake
from test_warehouse_receipts import warehouse as warehouse


@pytest.fixture()
def joint(client, warehouse, request):
    mode = getattr(request, "param", "with_plan")
    payload = route_payload(client, warehouse)
    if mode == "scheduled":
        payload["steps"].append({**payload["steps"][0], "sequence_no": 2, "name": "成品入库"})
        for step in payload["steps"]:
            step["planned_quantity"] = "100"
    first = publish_payload(client, payload)
    with SessionLocal.begin() as db:
        original = db.get(ProcessRoute, first["id"])
        other = ProcessRoute(
            title="另一流水号工艺",
            filename="",
            source_file=b"",
            source_sha256="",
            serial_nos=["ORDER-B"],
            steps=deepcopy(original.steps),
            source_data={"tables": [], "issues": []},
            created_by=original.created_by,
            created_by_user_id=original.created_by_user_id,
            engineering_employee_id=original.engineering_employee_id,
            engineering_employee_name=original.engineering_employee_name,
        )
        if mode in ("unspecified_first", "unspecified_second"):
            other.steps[1]["processing_task_id"] = None
            other.steps[1]["purpose_id"] = None
        db.add(other)
        db.flush()
        other_id = other.id
    add_documents(other_id)
    headers, _ = author(client)
    second_response = client.post(
        f"/api/process-routes/{other_id}/publish",
        headers=headers,
        json={"version": 1, "confirmed_imports": True},
    )
    assert second_response.status_code == 200, second_response.text
    second = second_response.json()
    members = [
        {
            "serial_no": serial,
            "process_route_id": route["id"],
            "process_route_version": route["version"],
            "planned_weight": weight,
            "planned_quantity": quantity,
            "planned_specification": "20 × 10 × 2 mm",
        }
        for serial, route, weight, quantity in [
            ("WAREHOUSE-001", first, 6, 60),
            ("ORDER-B", second, 4, 40),
        ]
    ]
    if mode != "with_plan":
        for member in members:
            for field in ("planned_weight", "planned_quantity", "planned_specification"):
                member.pop(field)
    if mode == "unspecified_first":
        members.reverse()
    response = intake(client, warehouse, serial_no=members[0]["serial_no"], quantity=2, weight=20)
    assert response.status_code == 201, response.text
    return response.json(), members


def send(client, warehouse, joint, **changes):
    lot, members = joint
    return dispatch(
        client,
        warehouse,
        [
            {
                "source_transfer_id": lot["id"],
                "quantity": 1,
                "weight": 10,
                "shared_serials": members,
                **changes,
            }
        ],
    )


@pytest.mark.parametrize(
    "joint", ["without_plan", "with_plan", "unspecified_first", "unspecified_second"], indirect=True
)
def test_joint_transfer_counts_one_physical_lot_preserves_remainder_and_retry(
    client, warehouse, joint
):
    origin, members = joint
    response = send(client, warehouse, joint)
    assert response.status_code == 201, response.text
    result = response.json()
    assert len(result["items"]) == 1
    lot = result["items"][0]
    assert lot["quantity"] == 1 and lot["weight"] == 10
    assert lot["shared_unallocated"]
    with SessionLocal() as db:
        specified = next(
            db.get(ProcessRoute, member["process_route_id"]).steps[1]
            for member in members
            if member["serial_no"] == "WAREHOUSE-001"
        )
        assert lot["purpose_id"] == specified["purpose_id"]
        assert lot["process_route"]["processing_task_id"] == specified["processing_task_id"]
    for member, stored in zip(members, lot["shared_serials"], strict=True):
        for field in ("planned_weight", "planned_quantity", "planned_specification"):
            assert stored[field] == member.get(field)
    assert [row["process_route_id"] for row in lot["shared_serials"]] == [
        m["process_route_id"] for m in members
    ]
    assert lot["shared_origin_batch_no"] == lot["batch_no"]
    assert send(client, warehouse, joint).json() == result
    with SessionLocal() as db:
        assert db.scalar(select(func.count(SharedMaterialGroup.id))) == 1
        parent = db.get(MaterialTransfer, origin["id"])
        assert (
            parent.serial_no == origin["serial_no"]
            and parent.shared_group_id is None
            and parent.process_route_id is None
        )
    rows = client.get(base(warehouse) + "/stock").json()["items"]
    remainder = next(item for item in rows if item["transfer"]["id"] == origin["id"])
    assert remainder["available_quantity"] == 1 and remainder["available_weight"] == 10


@pytest.mark.parametrize(
    "joint", ["without_plan", "with_plan", "unspecified_first", "unspecified_second"], indirect=True
)
def test_cutting_assigns_each_output_its_own_route_and_keeps_shared_remainder(
    client, warehouse, joint
):
    response = send(client, warehouse, joint)
    assert response.status_code == 201, response.text
    assert confirm(client, warehouse, response.json(), workshop=True).status_code == 200
    lot = response.json()["items"][0]
    with SessionLocal() as db:
        employee = db.scalar(
            select(TeamEmployee.id).where(TeamEmployee.team_id == warehouse["other"]["id"])
        )
    equipment = client.post(base(warehouse, True) + "/equipment", json={"name": "共投拆料机"})
    assert equipment.status_code == 201, equipment.text
    result = change(
        client,
        warehouse,
        lot,
        61,
        workshop=True,
        processor_employee_id=employee,
        equipment_id=equipment.json()["id"],
        processing_minutes=60,
        processing_mode="split",
        processing_date="2026-11-01",
        input_quantity=1,
        processing_status="partial",
        outputs=[
            {
                "role": "produced",
                "serial_no": "WAREHOUSE-001",
                "quantity": 60,
                "weight": 6,
                "material_type": "semi_finished",
                "transfer_specification": "20 × 10 × 2 mm",
            },
            {"role": "remaining", "quantity": 1, "weight": 4, "material_type": "semi_finished"},
        ],
    )
    assert result.status_code == 201, result.text
    first, remaining = result.json()["outputs"]
    second = change(
        client,
        warehouse,
        remaining,
        40,
        workshop=True,
        key="second-cut",
        processor_employee_id=employee,
        equipment_id=equipment.json()["id"],
        processing_minutes=60,
        processing_mode="split",
        processing_date="2026-11-01",
        input_quantity=1,
        processing_status="complete",
        outputs=[
            {
                "role": "produced",
                "serial_no": "ORDER-B",
                "quantity": 40,
                "weight": 4,
                "material_type": "semi_finished",
                "transfer_specification": "10 × 10 × 2 mm",
            },
        ],
    )
    assert second.status_code == 201, second.text
    with SessionLocal() as db:
        a, b = (
            db.get(MaterialTransfer, first["id"]),
            db.get(MaterialTransfer, second.json()["outputs"][0]["id"]),
        )
        routes = {member["serial_no"]: member["process_route_id"] for member in joint[1]}
        assert a.process_route_id == routes["WAREHOUSE-001"]
        assert b.process_route_id == routes["ORDER-B"]
        assert a.process_step_index == b.process_step_index == 1
        assert a.process_step_complete and b.process_step_complete
        assert not a.shared_unallocated and not b.shared_unallocated
    assert client.get(base(warehouse, True) + "/overview").json()["totals"]["on_hand_weight"] == 10


def test_joint_routes_can_share_processing_before_a_later_cut(client, warehouse, joint):
    with SessionLocal.begin() as db:
        anneal = Team(code="FACTORY-ANNEAL", name="退火")
        wire = Team(code="FACTORY-WIRE", name="线切割")
        db.add_all([anneal, wire])
        db.flush()
        route_ids = [member["process_route_id"] for member in joint[1]]
        for index, route_id in enumerate(route_ids):
            route = db.get(ProcessRoute, route_id)
            route.steps = [
                *route.steps,
                {"team_id": anneal.id},
                {"team_id": wire.id},
                {"team_id": anneal.id if index else warehouse["other"]["id"]},
            ]
        assert common_split_index(db, route_ids) == 3
        lot = SimpleNamespace(
            process_route=db.get(ProcessRoute, route_ids[0]),
            process_route_id=route_ids[0],
            shared_unallocated=True,
            shared_group=SimpleNamespace(split_step_index=3),
            next_team_code="FACTORY-ROLL",
            rework_pending=False,
            rework_route_id=None,
            rework_count=0,
            serial_no="共投料",
            process_step_index=1,
            process_step_complete=True,
            next_team_id=warehouse["other"]["id"],
        )
        assert is_split_step(lot, 1)
        # Earlier common operations may finish and transfer the intact piece.
        assert dispatch_fields(db, lot, anneal, "semi_finished")["process_step_index"] == 2
        lot.next_team_code, lot.next_team_id = anneal.code, anneal.id
        assert not is_split_step(lot, 2)
        lot.next_team_code, lot.next_team_id = wire.code, wire.id
        lot.process_step_index = 3
        assert is_split_step(lot, 3)
        # The piece must be allocated before the two orders take different paths.
        with pytest.raises(HTTPException, match="共投料须"):
            dispatch_fields(db, lot, anneal, "semi_finished")


@pytest.mark.parametrize(
    "change_kind",
    [
        "duplicate",
        "partial_plan",
        "stale_route",
        "different_purpose",
        "different_task",
        "different_team",
        "wrong_route",
        "external",
    ],
)
def test_invalid_joint_transfer_rolls_back_stock_and_group(client, warehouse, joint, change_kind):
    origin, members = joint
    members = deepcopy(members)
    if change_kind == "duplicate":
        members[1]["serial_no"] = members[0]["serial_no"]
    elif change_kind == "partial_plan":
        members[1]["planned_weight"] = None
    elif change_kind == "stale_route":
        members[1]["process_route_version"] += 1
    elif change_kind == "wrong_route":
        members[1]["process_route_id"] = members[0]["process_route_id"]
    elif change_kind.startswith("different_"):
        with SessionLocal.begin() as db:
            route = db.get(ProcessRoute, members[1]["process_route_id"])
            steps = deepcopy(route.steps)
            if change_kind == "different_team":
                other = Team(code="FACTORY-WIRE", name="线切割")
                field = "team_id"
            else:
                model = TeamPurpose if change_kind == "different_purpose" else TeamProcessingTask
                other = model(team_id=warehouse["other"]["id"], name="其他任务")
                field = "purpose_id" if change_kind == "different_purpose" else "processing_task_id"
            db.add(other)
            db.flush()
            steps[1][field] = other.id
            route.steps = steps
    if change_kind == "external":
        response = dispatch(
            client,
            warehouse,
            [
                {
                    "source_transfer_id": origin["id"],
                    "quantity": 1,
                    "weight": 10,
                    "shared_serials": members,
                }
            ],
            entry_kind="warehouse_outbound",
            next_team_id=None,
            external_destination="外委库",
        )
    else:
        response = send(client, warehouse, (origin, members))
    assert response.status_code in (409, 422), response.text
    if change_kind.startswith("different_"):
        assert "第 2 道" in response.json()["detail"]
        assert "不同" in response.json()["detail"]
    with SessionLocal() as db:
        assert db.scalar(select(func.count(SharedMaterialGroup.id))) == 0
        assert db.scalar(select(func.count(MaterialTransfer.id))) == 1
    rows = client.get(base(warehouse) + "/stock").json()["items"]
    assert rows[0]["available_weight"] == 20


@pytest.mark.parametrize("joint", ["unspecified_first", "unspecified_second"], indirect=True)
def test_joint_explicit_tasks_still_apply_when_another_route_is_unspecified(
    client, warehouse, joint
):
    other = client.post(base(warehouse, True) + "/purposes", json={"name": "其他任务"}).json()
    rejected = send(client, warehouse, joint, purpose_id=other["id"])
    assert rejected.status_code == 422, rejected.text
    assert "与已发布工艺一致" in rejected.json()["detail"]
    with SessionLocal() as db:
        assert db.scalar(select(func.count(SharedMaterialGroup.id))) == 0
    response = send(client, warehouse, joint)
    assert response.status_code == 201, response.text
    with SessionLocal() as db:
        lot = db.get(MaterialTransfer, response.json()["items"][0]["id"])
        # Reordering the serials must not bypass the task specified by either route.
        for field, message in (("processing_task_id", "具体任务"), ("purpose_id", "指定的业务")):
            payload = SimpleNamespace(
                work_kind="normal", processing_task_id=None, purpose_id=None, outputs=[]
            )
            setattr(payload, field, -1)
            with pytest.raises(HTTPException, match=message):
                prepare_processing(lot, payload)


def test_shared_records_list_only_joint_dispatch_with_member_search(client, warehouse, joint):
    response = send(client, warehouse, joint)
    assert response.status_code == 201, response.text
    lot = response.json()["items"][0]
    for params in ({}, {"query": "ORDER-B"}, {"serial_query": "WAREHOUSE-001"}):
        result = client.get(
            "/api/material-transfers",
            params={
                "record_kind": "shared",
                "page_size": 1,
                "include_summary": True,
                **params,
            },
        )
        assert result.status_code == 200, result.text
        assert result.json()["total"] == 1
        assert result.json()["items"][0]["id"] == lot["id"]
    empty = client.get(
        "/api/material-transfers",
        params={
            "record_kind": "reallocation",
            "include_summary": True,
        },
    )
    assert empty.json()["total"] == 0
    assert (
        client.get(
            "/api/material-transfers",
            params={
                "record_kind": "shared",
                "page_size": 1,
                "page": 2,
            },
        ).json()["items"]
        == []
    )


@pytest.fixture
def feeding_plans(client, warehouse, joint, dispatcher):
    person = client.post(URL + "/business-people", json={"name": "业务甲"}).json()["id"]
    targets, task_ids, all_receiving_ids = [], [], []
    for member in joint[1]:
        serial = member["serial_no"]
        for number in (1, 2):
            task = submit(
                client,
                {
                    "serial_no": serial,
                    "route_id": member["process_route_id"],
                    "route_version": member["process_route_version"],
                    "business_person_ids": [person],
                    "final_due_at": "2026-12-30T16:00:00+08:00",
                    "delivery_batches": [
                        {
                            "batch_number": 1,
                            "target_quantity": 100,
                            "due_at": "2026-12-29T16:00:00+08:00",
                        }
                    ],
                    "idempotency_key": f"joint-{serial}-{number}",
                },
                dispatcher,
            )
            assert task.status_code == 201, task.text
        options = client.get(
            URL + "/warehouse-feeding-options",
            params={"team_id": warehouse["team"]["id"], "serial_no": serial},
        ).json()
        assert len(options) == 2
        chosen = options[len(targets)]
        all_receiving_ids.extend(option["schedule_id"] for option in options)
        targets.append(
            {key: chosen[key] for key in ("serial_no", "schedule_id", "route_id", "route_version")}
        )
        task_ids.append(chosen["task_id"])
    return targets, task_ids, all_receiving_ids


@pytest.mark.parametrize("joint", ["scheduled"], indirect=True)
def test_joint_feeding_binds_each_target_batch_only_when_split(client, warehouse, feeding_plans):
    from app.models import MaterialStockBalance
    from app.production_schedule_queries import linked_lots
    from test_processing_daily import work

    targets, task_ids, all_receiving_ids = feeding_plans
    raw = intake(
        client,
        warehouse,
        serial_no="STOCK-C",
        idempotency_key="raw-c",
        quantity=4,
        weight=20,
        product_code="RAW-CODE",
    ).json()
    lines = [{"source_transfer_id": raw["id"], "quantity": 2, "weight": 10}]
    for invalid in (
        {"feeding_targets": targets, "feeding_target": targets[0]},
        {"feeding_targets": [targets[0], targets[0]]},
        {"feeding_targets": [targets[0], {**targets[1], "schedule_id": targets[0]["schedule_id"]}]},
        {
            "feeding_targets": [
                targets[0],
                {**targets[1], "route_version": targets[1]["route_version"] + 1},
            ]
        },
    ):
        assert dispatch(client, warehouse, lines, **invalid).status_code in (409, 422)
    response = dispatch(client, warehouse, lines, feeding_targets=targets)
    assert response.status_code == 201, response.text
    assert dispatch(client, warehouse, lines, feeding_targets=targets).json() == response.json()
    doc = client.get(
        f"/api/material-dispatches/warehouse/{response.json()['items'][0]['warehouse_dispatch_id']}"
    )
    assert doc.status_code == 200, doc.text
    assert [line["batch_no"] for line in doc.json()["items"]] == [
        line["batch_no"] for line in response.json()["items"]
    ]
    for line in doc.json()["items"]:
        assert {member["feeding_schedule_id"] for member in line["shared_serials"]} == {
            target["schedule_id"] for target in targets
        }
    [lot] = response.json()["items"]
    assert lot["shared_unallocated"] and lot["source_serial_no"] == "STOCK-C"
    assert (lot["quantity"], lot["weight"]) == (2, 10)
    assert lot["product_code"] is None
    assert [m["feeding_schedule_id"] for m in lot["shared_serials"]] == [
        t["schedule_id"] for t in targets
    ]
    assert [m["task_batch_number"] for m in lot["shared_serials"]] == [1, 2]
    assert [m["schedule_task_id"] for m in lot["shared_serials"]] == task_ids
    with SessionLocal() as db:
        balance = db.get(MaterialStockBalance, raw["id"])
        assert (balance.on_hand_quantity, float(balance.on_hand_weight)) == (2, 10)
        links = linked_lots(all_receiving_ids)
        assert set(
            db.scalars(select(links.c.schedule_id).where(links.c.source_transfer_id == lot["id"]))
        ) == {t["schedule_id"] for t in targets}

    assert confirm(client, warehouse, response.json(), workshop=True).status_code == 200
    worker = client.get(base(warehouse, True) + "/employees").json()[0]
    cut = work(
        client,
        warehouse,
        lot,
        worker,
        quantity=12,
        input_quantity=2,
        processing_mode="split",
        processing_status="complete",
        outputs=[
            {
                "role": "produced",
                "serial_no": target["serial_no"],
                "quantity": 6,
                "weight": 5,
                "material_type": "semi_finished",
                "transfer_specification": "10 × 10 × 5 mm",
            }
            for target in targets
        ],
    )
    assert cut.status_code == 201, cut.text
    for output, target in zip(cut.json()["outputs"], targets, strict=True):
        with SessionLocal() as db:
            child = db.get(MaterialTransfer, output["id"])
            assert (child.serial_no, child.processing_schedule_id, child.process_route_id) == (
                target["serial_no"],
                target["schedule_id"],
                target["route_id"],
            )
        assert client.get(URL + "/" + str(target["schedule_id"])).json()["dispatched_quantity"] == 0
    sent = dispatch(
        client,
        warehouse,
        [
            {"source_transfer_id": row["id"], "quantity": 6, "weight": 5}
            for row in cut.json()["outputs"]
        ],
        workshop=True,
    )
    assert sent.status_code == 201, sent.text
    for schedule_id in all_receiving_ids:
        count = 6 if schedule_id in {target["schedule_id"] for target in targets} else 0
        assert client.get(URL + "/" + str(schedule_id)).json()["dispatched_quantity"] == count


@pytest.mark.parametrize("joint", ["scheduled"], indirect=True)
def test_warehouse_independent_destinations_create_separate_documents_atomically(
    client, warehouse, feeding_plans
):
    targets, _, _ = feeding_plans
    materials = [
        intake(
            client,
            warehouse,
            serial_no=f"RAW-{i}",
            idempotency_key=f"receipt-{i}",
            material_name="料 A" if i < 2 else "料 B",
        ).json()
        for i in range(3)
    ]
    lines = [{"source_transfer_id": item["id"], "quantity": 1, "weight": 1} for item in materials]
    assignments = [
        {"target": target, "next_team_id": warehouse["other"]["id"], "source_transfer_ids": sources}
        for target, sources in zip(
            targets, [[materials[0]["id"], materials[1]["id"]], [materials[2]["id"]]], strict=True
        )
    ]

    def send(groups):
        return dispatch(
            client,
            warehouse,
            lines,
            next_team_id=None,
            feeding_assignments=groups,
            idempotency_key="separate",
        )

    invalid = deepcopy(assignments)
    invalid[1]["target"]["route_version"] += 1
    assert send(invalid).status_code == 409
    with SessionLocal() as db:
        assert not db.scalar(
            select(MaterialTransfer.id).where(
                MaterialTransfer.source_transfer_id.in_([lot["id"] for lot in materials])
            )
        )
    issued = send(assignments)
    assert issued.status_code == 201, issued.text
    records = issued.json()["items"]
    assert send(assignments).json() == issued.json()
    assert send(invalid).status_code == 409
    assert [r["serial_no"] for r in records] == [target["serial_no"] for target in targets]
    first, second = (row["warehouse_dispatch_id"] for row in records)
    assert first != second
    assert [r["quantity"] for r in records] == [2, 1]
    for row in records:
        print_rows = client.get(
            f"/api/material-dispatches/warehouse/{row['warehouse_dispatch_id']}"
        ).json()["items"]
        assert [r["batch_no"] for r in print_rows] == [row["batch_no"]]
    with SessionLocal.begin() as db:
        # Older bulk submissions could store independent flows under one header.
        db.get(MaterialTransfer, records[1]["id"]).dispatch_id = first
    historical = client.get(f"/api/material-dispatches/warehouse/{first}").json()["items"]
    assert historical[0]["warehouse_document_no"] != historical[1]["warehouse_document_no"]
    waiting = client.get(
        "/api/material-transfers",
        params={
            "direction": "incoming",
            "team_id": warehouse["other"]["id"],
            "status": "pending",
            "group_warehouse_receipts": True,
        },
    ).json()
    assert waiting["total"] == 2
    assert {row["serial_no"]: row["quantity"] for row in waiting["items"]} == {
        targets[0]["serial_no"]: 2,
        targets[1]["serial_no"]: 1,
    }


@pytest.mark.parametrize("joint", ["scheduled"], indirect=True)
def test_pending_warehouse_receipt_is_one_reviewable_document(client, warehouse, feeding_plans):
    targets, _, _ = feeding_plans
    team = warehouse["other"]["id"]
    lots = [
        intake(
            client,
            warehouse,
            serial_no=f"SRC-{i}",
            quantity=100,
            weight=200 if i == 0 else 100,
            idempotency_key=f"intake-{i}",
        ).json()
        for i in range(3)
    ]

    def issue(key, amounts, weight):
        response = dispatch(
            client,
            warehouse,
            [
                {"source_transfer_id": lot["id"], "quantity": qty, "weight": weight}
                for lot, qty in zip(lots, amounts, strict=False)
            ],
            feeding_target=targets[0],
            idempotency_key=key,
        )
        assert response.status_code == 201, response.text
        return response.json()["items"]

    first = issue("one-doc", [26, 100, 100], 100)
    other = issue("other-doc", [1], 1)

    def pending(**options):
        response = client.get(
            "/api/material-transfers",
            params=dict(
                team_id=team,
                direction="incoming",
                status="pending",
                group_warehouse_receipts=True,
                **options,
            ),
        )
        assert response.status_code == 200, response.text
        return response.json()

    def count():
        return client.get(base(warehouse, workshop=True) + "/overview").json()["pending_incoming"][
            "count"
        ]

    assert pending(page_size=1)["total"] == count() == 2
    assert len(first) == 1
    row = pending(query=first[0]["batch_no"], page_size=1)["items"][0]
    assert (row["quantity"], row["weight"]) == (226, 300)
    assert [r["serial_no"] for r in row["feeding_sources"]] == [
        "SRC-0",
        "SRC-1",
        "SRC-2",
    ]
    assert pending(query="SRC-2", quantity_min=226)["total"] == 1
    amount_filter = json.dumps(
        {"filters": [{"field": "quantity", "kind": "number", "operator": "eq", "value": "226"}]}
    )
    assert pending(table_query=amount_filter)["total"] == 1
    options = pending(table_query=json.dumps({"options": {"field": "quantity", "kind": "number"}}))
    assert set(options["values"]) == {"226", "1"}
    assert pending(page_size=1, page=2)["items"][0]["id"] == row["id"]
    with SessionLocal.begin() as db:
        person = TeamEmployee(team_id=team, name="来料员", active=True)
        db.add(person)
        db.flush()
        receiver = person.id
    url = f"/api/material-transfers/{row['batch_no']}/confirm-warehouse-receipt"
    versions = {item["batch_no"]: item["version"] for item in first}
    payload = {
        "idempotency_key": "review-many",
        "received_employee_id": receiver,
        "versions": versions,
    }
    assert client.post(url, headers=warehouse["headers"], json=payload).status_code == 403
    stale = {**versions, first[-1]["batch_no"]: 999}
    assert (
        client.post(
            url, headers=warehouse["other_headers"], json={**payload, "versions": stale}
        ).status_code
        == 409
    )
    assert pending(query=first[0]["batch_no"])["items"][0]["quantity"] == 226
    for _ in range(2):
        response = client.post(url, headers=warehouse["other_headers"], json=payload)
        assert response.status_code == 204, response.text
    assert count() == pending()["total"] == 1
    assert pending()["items"][0]["batch_no"] == other[0]["batch_no"]
    from app.models import MaterialStockBalance

    with SessionLocal() as db:
        balance = db.get(MaterialStockBalance, first[0]["id"])
        assert (balance.on_hand_quantity, balance.on_hand_weight) == (226, 300)
        for source, quantity in zip(lots, [26, 100, 100], strict=True):
            balance = db.get(MaterialStockBalance, source["id"])
            assert (balance.dispatched_quantity, balance.dispatched_weight) == (quantity, 100)
    for lot in first:
        detail = client.get("/api/material-transfers/" + lot["batch_no"]).json()
        assert detail["received_employee_id"] == receiver
        assert sum(ev["action"] == "received" for ev in detail["history"]) == 1


@pytest.mark.parametrize("joint", ["scheduled"], indirect=True)
def test_pooled_feeding_requires_same_material_and_restores_each_source_on_void(
    client, warehouse, feeding_plans
):
    from app.material_lineage import relatives
    from app.models import MaterialStockBalance, WarehousePlacement

    targets, _, _ = feeding_plans

    def receive(serial, **fields):
        receipt = intake(client, warehouse, serial_no=serial, idempotency_key=serial, **fields)
        assert receipt.status_code == 201, receipt.text
        return receipt.json()

    root = receive("RAW-1", transfer_specification="100 × 80 × 5 mm")

    def issue(other):
        return dispatch(
            client,
            warehouse,
            [
                {"source_transfer_id": root["id"], "quantity": 3, "weight": 2},
                {"source_transfer_id": other["id"], "quantity": 4, "weight": 5},
            ],
            feeding_target=targets[0],
            idempotency_key="feed-" + other["serial_no"],
        )

    for label, fields in [
        ("材质", {"material_name": "另一材质"}),
        ("物料类型", {"material_type": "raw_material"}),
        ("尺寸", {"transfer_specification": "100 × 80 × 6 mm"}),
    ]:
        other = receive("BAD-" + label, **fields)
        result = issue(other)
        assert result.status_code == 422 and label in result.text
        with SessionLocal() as db:
            for source in (root, other):
                assert db.get(MaterialStockBalance, source["id"]).reserved_weight == 0
    other = receive("RAW-2", transfer_specification="100*80*5", source_batch_no="OTHER")
    result = issue(other)
    assert result.status_code == 201, result.text
    [row] = result.json()["items"]
    from test_stock_balances import reconcile

    reconcile()
    with SessionLocal() as db:
        target = relatives([row["id"]], ancestors=True)
        assert set(db.scalars(select(target.c.id))) == {root["id"], other["id"], row["id"]}
        child = relatives([other["id"]])
        assert row["id"] in db.scalars(select(child.c.id)).all()
        for source, qty in [(root, 3), (other, 4)]:
            assert (
                db.scalar(
                    select(WarehousePlacement.quantity).where(
                        WarehousePlacement.transfer_id == source["id"]
                    )
                )
                == source["quantity"] - qty
            )
    trace = client.get("/api/material-trace", params={"serial_no": other["serial_no"]})
    assert trace.status_code == 200, trace.text
    nodes = {item["id"]: item for item in trace.json()["items"]}
    assert nodes[row["id"]]["context_only"] and not nodes[other["id"]]["context_only"]
    assert len(nodes[row["id"]]["feeding_sources"]) == 2
    result = client.delete(
        "/api/material-transfers/" + row["batch_no"], headers=warehouse["headers"]
    )
    assert result.status_code == 204, result.text
    with SessionLocal() as db:
        for source in (root, other):
            balance = db.get(MaterialStockBalance, source["id"])
            assert balance.on_hand_quantity == source["quantity"]
            assert float(balance.on_hand_weight) == source["weight"]
            assert (balance.reserved_quantity, balance.in_transit_weight) == (0, 0)
