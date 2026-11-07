"""Joint production starts at warehouse transfer and splits into independent routes."""

from copy import deepcopy
from types import SimpleNamespace

import pytest
from app.database import SessionLocal
from app.models import MaterialTransfer, ProcessRoute, SharedMaterialGroup, Team, TeamEmployee
from app.process_routes import dispatch_fields
from app.shared_material import common_split_index, is_split_step
from fastapi import HTTPException
from route_document_helpers import add_documents
from sqlalchemy import func, select
from test_process_route_intake import publish_payload, route_payload
from test_quantity_adjustments import change
from test_warehouse_classification import base, confirm, dispatch
from test_warehouse_receipts import intake
from test_warehouse_receipts import warehouse as warehouse


@pytest.fixture()
def joint(client, warehouse):
    payload = route_payload(client, warehouse)
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
        )
        db.add(other)
        db.flush()
        other_id = other.id
    add_documents(other_id)
    second_response = client.post(
        f"/api/process-routes/{other_id}/publish", json={"version": 1, "confirmed_imports": True}
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
    response = intake(client, warehouse, serial_no="", quantity=2, weight=20)
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
    assert [row["process_route_id"] for row in lot["shared_serials"]] == [
        m["process_route_id"] for m in members
    ]
    assert lot["shared_origin_batch_no"] == lot["batch_no"]
    assert send(client, warehouse, joint).json() == result
    with SessionLocal() as db:
        assert db.scalar(select(func.count(SharedMaterialGroup.id))) == 1
        parent = db.get(MaterialTransfer, origin["id"])
        assert (
            parent.serial_no == ""
            and parent.shared_group_id is None
            and parent.process_route_id is None
        )
    rows = client.get(base(warehouse) + "/stock").json()["items"]
    remainder = next(item for item in rows if item["transfer"]["id"] == origin["id"])
    assert remainder["available_quantity"] == 1 and remainder["available_weight"] == 10


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
    result = change(
        client,
        warehouse,
        lot,
        61,
        workshop=True,
        processor_employee_id=employee,
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
            },
        ],
    )
    assert second.status_code == 201, second.text
    with SessionLocal() as db:
        a, b = (
            db.get(MaterialTransfer, first["id"]),
            db.get(MaterialTransfer, second.json()["outputs"][0]["id"]),
        )
        assert a.process_route_id == joint[1][0]["process_route_id"]
        assert b.process_route_id == joint[1][1]["process_route_id"]
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
    ["duplicate", "missing_plan", "stale_route", "different_path", "wrong_route", "external"],
)
def test_invalid_joint_transfer_rolls_back_stock_and_group(client, warehouse, joint, change_kind):
    origin, members = joint
    members = deepcopy(members)
    if change_kind == "duplicate":
        members[1]["serial_no"] = members[0]["serial_no"]
    elif change_kind == "missing_plan":
        members[1]["planned_weight"] = None
    elif change_kind == "stale_route":
        members[1]["process_route_version"] += 1
    elif change_kind == "wrong_route":
        members[1]["process_route_id"] = members[0]["process_route_id"]
    elif change_kind == "different_path":
        with SessionLocal.begin() as db:
            route = db.get(ProcessRoute, members[1]["process_route_id"])
            steps = deepcopy(route.steps)
            steps[1]["purpose_id"] = None
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
    with SessionLocal() as db:
        assert db.scalar(select(func.count(SharedMaterialGroup.id))) == 0
        assert db.scalar(select(func.count(MaterialTransfer.id))) == 1
    rows = client.get(base(warehouse) + "/stock").json()["items"]
    assert rows[0]["available_weight"] == 20
