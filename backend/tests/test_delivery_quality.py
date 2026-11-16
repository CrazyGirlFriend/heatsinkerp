"""Quality reverses delivery credit along the actual affected batch, never the ledger."""

from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from app.database import SessionLocal
from app.delivery_quality import credits
from app.models import (
    InspectionFeedbackTeam,
    MaterialDispatch,
    MaterialInspection,
    MaterialQuantityAdjustment,
    MaterialTransfer,
    ProcessRoute,
    ProductionSchedule,
    ProductionScheduleBatch,
    ProductionScheduleDelivery,
    ProductionScheduleTask,
    Team,
    TeamEmployee,
)
from app.production_schedule_queries import progress_table
from app.schedule_fulfillment import fulfillment_values
from sqlalchemy import select
from test_table_queries import query

BASE = datetime(2026, 1, 1)


def at(day):
    return BASE + timedelta(days=day)


def lot(db, source, target, parent=None, quantity=100, day=0, kind="transfer"):
    row = MaterialTransfer(
        batch_no=uuid4().hex,
        serial_no="QUALITY-001",
        quantity=quantity,
        weight=quantity,
        source_transfer_id=parent.id if parent else None,
        entry_kind=kind,
        source_team_id=source.id,
        source_team_code=source.code,
        source_team_name=source.name,
        next_team_id=target.id,
        next_team_code=target.code,
        next_team_name=target.name,
        status="received",
        stock_tracked=True,
        sent_processing_status="complete",
        material_type="finished",
        created_by="测试",
        created_at=at(day),
        received_at=at(day),
    )
    db.add(row)
    db.flush()
    return row


def inspect(db, s, source=None, *, failed=10, quantity=100, day=2, scope="full", parent=None):
    row = MaterialInspection(
        source_transfer_id=(source or s["lots"][2]).id,
        team_id=s["teams"][3].id,
        inspection_team_id=s["teams"][3].id,
        inspector_employee_id=s["employee"].id,
        inspector_name="检验员",
        kind="inspection",
        checked_at=at(day),
        batch_quantity=quantity,
        sample_quantity=quantity,
        failed_quantity=failed,
        scope=scope,
        parent_id=parent,
        idempotency_key=uuid4().hex,
        request_hash=uuid4().hex,
        created_by="测试",
        created_at=at(day),
        blocks_outbound=False,
    )
    db.add(row)
    db.flush()
    if failed and parent is None:
        db.add(InspectionFeedbackTeam(inspection_id=row.id, team_id=s["teams"][1].id))
    db.flush()
    return row


def repair(db, s, source, quantity=10, day=3):
    team = s["teams"][3]
    reserved = lot(db, team, team, source, quantity, day, "rework_split")
    route = ProcessRoute(
        title="返工",
        filename="",
        source_sha256="",
        source_file=b"",
        source_data={},
        serial_nos=[source.serial_no],
        steps=[{"team_id": team.id}],
        state="published",
        route_kind="rework",
        rework_source_transfer_id=reserved.id,
        created_by="测试",
    )
    db.add(route)
    db.flush()
    output = lot(db, team, team, reserved, quantity, day + 0.1, "processing_output")
    output.processing_role = "produced"
    db.add(
        MaterialQuantityAdjustment(
            source_transfer_id=reserved.id,
            team_id=team.id,
            before_quantity=quantity,
            after_quantity=quantity,
            weight_snapshot=quantity,
            stock_revision_before=0,
            reason="按返工工艺处理",
            idempotency_key=uuid4().hex,
            request_hash=uuid4().hex,
            created_by="测试",
            created_at=at(day + 0.1),
            work_kind="rework",
            processing_status="complete",
            completed_quantity=quantity,
            process_route_id=route.id,
            process_step_index=0,
            outputs=[{"id": output.id, "quantity": quantity, "role": "produced"}],
        )
    )
    db.flush()
    return output


@pytest.fixture()
def chain(client):
    with SessionLocal.begin() as db:
        teams = [
            Team(code=f"QUALITY-{i}", name=name, kind="production", active=True)
            for i, name in enumerate(["线切割", "研磨", "电镀", "检验", "库房"])
        ]
        db.add_all(teams)
        db.flush()
        employee = TeamEmployee(team_id=teams[3].id, name="检验员")
        task = ProductionScheduleTask(
            title="当前批次",
            serial_no="QUALITY-001",
            created_at=BASE,
            idempotency_key=uuid4().hex,
            request_hash=uuid4().hex,
        )
        db.add_all([employee, task])
        db.flush()
        lots, plans = [], []
        for i in range(3):
            item = lot(db, teams[i], teams[i + 1], lots[-1] if lots else None, day=i * 0.1)
            plan = ProductionSchedule(
                task_id=task.id,
                serial_no=task.serial_no,
                team_id=teams[i].id,
                next_team_id=teams[i + 1].id,
                target_quantity=100,
                sequence_no=i + 1,
                due_at=at(4),
                initial_due_at=at(4),
                idempotency_key=uuid4().hex,
                request_hash=uuid4().hex,
            )
            db.add(plan)
            db.flush()
            db.add(ProductionScheduleDelivery(schedule_id=plan.id, transfer_id=item.id))
            lots.append(item)
            plans.append(plan)
        db.flush()
        yield dict(teams=teams, employee=employee, task=task, lots=lots, plans=plans, db=db)


def quantities(s):
    return {row.schedule_id: row for row in s["db"].execute(select(progress_table(s["db"]))).all()}


def test_deducts_involved_operation_and_downstream_but_preserves_physical_receipts(chain):
    s, db = chain, chain["db"]
    assert [row.dispatched_quantity for row in quantities(s).values()] == [100, 100, 100]
    inspect(db, s)
    values = quantities(s)
    assert [values[p.id].dispatched_quantity for p in s["plans"]] == [100, 90, 90]
    for plan in s["plans"][1:]:
        row = values[plan.id]
        assert row.actual_dispatched_quantity == row.received_quantity == 100
        assert row.quality_pending_quantity == 10 and row.completed_at is None
    assert all(item.quantity == 100 for item in s["lots"])
    # Feedback closure is not a successful reinspection.
    check = db.scalar(select(MaterialInspection))
    check.feedback_status, check.released_at = "closed", at(3)
    db.flush()
    assert quantities(s)[s["plans"][1].id].dispatched_quantity == 90


def test_partial_repair_repeated_checks_and_second_round_never_double_count(chain):
    s, db = chain, chain["db"]
    original = inspect(db, s)
    # A passing recheck without engineered repair does not restore delivery credit.
    inspect(db, s, failed=0, parent=original.id, day=2.1)
    first = repair(db, s, s["lots"][2], quantity=6)
    inspect(db, s, first, quantity=1, failed=0, scope="sample", day=3.2)
    assert quantities(s)[s["plans"][1].id].dispatched_quantity == 90
    inspect(db, s, first, quantity=6, failed=0, day=3.3)
    inspect(db, s, first, quantity=6, failed=0, day=3.4)
    assert quantities(s)[s["plans"][1].id].dispatched_quantity == 96
    second = repair(db, s, s["lots"][2], quantity=4, day=4)
    inspect(db, s, second, quantity=4, failed=1, day=4.2)
    assert quantities(s)[s["plans"][1].id].dispatched_quantity == 99
    last = repair(db, s, second, quantity=1, day=5)
    inspect(db, s, last, quantity=1, failed=0, day=5.2)
    for p in s["plans"][1:]:
        row = quantities(s)[p.id]
        assert row.dispatched_quantity == 100 and row.quality_pending_quantity == 0
        assert row.completed_at == at(5.2)


def test_completion_uses_the_recovery_that_meets_the_target_not_the_last_recheck(chain):
    s, db = chain, chain["db"]
    plan = s["plans"][1]
    plan.target_quantity = 95
    inspect(db, s)
    first = repair(db, s, s["lots"][2], quantity=5)
    inspect(db, s, first, quantity=5, failed=0, day=3.2)
    second = repair(db, s, s["lots"][2], quantity=5, day=5)
    inspect(db, s, second, quantity=5, failed=0, day=5.2)
    row = quantities(s)[plan.id]
    assert row.dispatched_quantity == 100
    assert row.completed_at == at(3.2) < plan.due_at
    # The following team still owes 100 pieces and finishes only after the second pass.
    assert quantities(s)[s["plans"][2].id].completed_at == at(5.2)


def test_other_delivery_batch_and_same_serial_stock_are_not_deducted(chain):
    s, db = chain, chain["db"]
    plan = s["plans"][1]
    batches = [
        ProductionScheduleBatch(
            schedule_id=plan.id,
            batch_number=i + 1,
            due_at=at(4 + i),
            target_quantity=100,
            upstream_batch_ids=[],
        )
        for i in range(2)
    ]
    db.add_all(batches)
    db.flush()
    db.get(ProductionScheduleDelivery, s["lots"][1].id).schedule_batch_id = batches[0].id
    other = lot(db, s["teams"][1], s["teams"][2])
    db.add(
        ProductionScheduleDelivery(
            schedule_id=plan.id, transfer_id=other.id, schedule_batch_id=batches[1].id
        )
    )
    inspect(db, s, failed=2, quantity=10, scope="sample")
    rows = {r.schedule_id: r for r in db.execute(select(progress_table(db, batches=True)))}
    assert rows[batches[0].id].dispatched_quantity == 98  # Never extrapolate a sample failure rate.
    assert rows[batches[1].id].dispatched_quantity == 100
    assert other.id not in credits(db)


def test_good_portion_can_leave_while_bad_portion_is_isolated(chain):
    s, db = chain, chain["db"]
    inspect(db, s)
    repaired = repair(db, s, s["lots"][2])
    good = lot(db, s["teams"][3], s["teams"][4], s["lots"][2], quantity=90, day=3.2)
    assert credits(db).get(good.id) is None or credits(db)[good.id].pending == 0
    assert quantities(s)[s["plans"][1].id].dispatched_quantity == 90
    inspect(db, s, repaired, quantity=10, failed=0, day=4)
    # A second traversal of the same schedule is physical movement, not a second quota.
    returned = lot(db, s["teams"][1], s["teams"][2], repaired, quantity=10, day=4.1)
    db.add(ProductionScheduleDelivery(schedule_id=s["plans"][1].id, transfer_id=returned.id))
    row = quantities(s)[s["plans"][1].id]
    assert row.dispatched_quantity == 100
    assert row.actual_dispatched_quantity == 110 and row.quality_pending_quantity == 0


@pytest.mark.parametrize("failed", [10, 100])
def test_list_filter_paging_detail_and_batch_status_share_quality_credit(client, chain, failed):
    s, db = chain, chain["db"]
    inspect(db, s, failed=failed)
    effective = 100 - failed
    ids = [p.id for p in s["plans"]]
    db.commit()
    response = client.get(
        "/api/production-schedules",
        params={
            "table_query": query(
                "dispatched_quantity", str(effective), str(effective), kind="number"
            ),
            "page_size": 1,
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 2
    detail = client.get(f"/api/production-schedules/{ids[1]}")
    assert detail.status_code == 200, detail.text
    item = detail.json()
    assert item["dispatched_quantity"] == effective and item["remaining_quantity"] == failed
    assert item["deliveries"][0]["quantity"] == 100
    assert item["deliveries"][0]["effective_quantity"] == effective
    assert item["deliveries"][0]["counts_toward_delivery"] is (effective > 0)
    assert item["handover_completed_at"] is None


def test_recheck_of_remainder_does_not_restore_the_departed_unchecked_portion(chain):
    s, db = chain, chain["db"]
    inspect(db, s)
    output = repair(db, s, s["lots"][2])
    departed = lot(db, s["teams"][3], s["teams"][4], output, quantity=4, day=3.2)
    inspect(db, s, output, quantity=6, failed=0, day=3.3)
    assert quantities(s)[s["plans"][1].id].dispatched_quantity == 96
    inspect(db, s, departed, quantity=4, failed=0, day=3.4)
    assert quantities(s)[s["plans"][1].id].dispatched_quantity == 100


@pytest.mark.parametrize("scope", ["full", "sample"])
def test_a_later_failed_recheck_revokes_the_previously_restored_credit(chain, scope):
    s, db = chain, chain["db"]
    inspect(db, s)
    output = repair(db, s, s["lots"][2])
    inspect(db, s, output, quantity=10, failed=0, day=3.2)
    assert quantities(s)[s["plans"][1].id].dispatched_quantity == 100
    inspect(db, s, output, quantity=10 if scope == "full" else 2, failed=2, day=3.3, scope=scope)
    row = quantities(s)[s["plans"][1].id]
    assert row.dispatched_quantity == 98 and row.completed_at is None


def test_customer_fulfillment_excludes_known_rejected_pieces_from_shipment(chain, client):
    s, db = chain, chain["db"]
    inspect(db, s)
    dispatch = MaterialDispatch(
        source_team_id=s["teams"][3].id,
        entry_kind="inspection_shipment",
        external_destination="对外转料",
        idempotency_key=uuid4().hex,
        request_hash=uuid4().hex,
        created_by="测试",
    )
    db.add(dispatch)
    db.flush()
    shipped = lot(db, s["teams"][3], s["teams"][4], s["lots"][2], day=3)
    shipped.entry_kind, shipped.status, shipped.stock_tracked = (
        "inspection_shipment",
        "dispatched",
        False,
    )
    shipped.next_team_id = shipped.next_team_code = shipped.next_team_name = None
    shipped.dispatch_id, shipped.external_destination, shipped.dispatched_at = (
        dispatch.id,
        "对外转料",
        at(3),
    )
    task_id = s["task"].id
    values = fulfillment_values(db, [task_id])[task_id]
    assert values["shipped_quantity"] == 90 and not values["order_completed"]
    db.commit()
    response = client.get(f"/api/production-schedules/tasks/{task_id}/progress")
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["shipped_quantity"] == data["tasks"][0]["shipped_quantity"] == 90
    assert data["shipments"][0]["quantity"] == 100
    assert data["shipments"][0]["effective_quantity"] == 90


def test_weight_commitment_remains_unfinished_until_failed_pieces_pass_reinspection(chain):
    s, db = chain, chain["db"]
    plan = s["plans"][1]
    plan.completion_basis, plan.target_quantity, plan.target_weight = "weight", None, 100
    inspect(db, s)
    assert quantities(s)[plan.id].completed_at is None
    output = repair(db, s, s["lots"][2])
    inspect(db, s, output, quantity=10, failed=0, day=3.2)
    assert quantities(s)[plan.id].completed_at == at(3.2)
