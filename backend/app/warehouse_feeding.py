"""Warehouse material inputs are reserved by source and processed on the receiving plan."""

from datetime import datetime

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import aliased

from .models import MaterialTransfer, ProcessRoute, ProductionScheduleDelivery, Team
from .models import ProductionSchedule as Plan
from .models import ProductionScheduleTask as Task
from .production_schedule_queries import progress_table
from .schemas import MaterialTransferDocumentFields
from .team_constants import WAREHOUSE_TEAM_CODE

PHYSICAL_FIELDS = {
    "material_name",
    "material_type",
    "transfer_specification",
    "source_batch_no",
    "material_shape",
    "material_description",
    "is_outsourced",
    "outsourced_unit",
}
ORDER_FIELDS = MaterialTransferDocumentFields.model_fields.keys() - PHYSICAL_FIELDS


class FeedingTarget(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    serial_no: str = Field(min_length=1, max_length=80)
    schedule_id: int = Field(ge=1)
    route_id: int = Field(ge=1)
    route_version: int = Field(ge=1)


class FeedingAssignment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target: FeedingTarget
    next_team_id: int = Field(ge=1)
    source_transfer_ids: list[int] = Field(min_length=1, max_length=100)


class FeedingOption(FeedingTarget):
    task_id: int
    task_batch_number: int
    team_id: int
    team_name: str
    due_at: datetime
    remaining_quantity: int | None
    remaining_weight: float | None


def eligible_plans(team_id, serial):
    upstream = aliased(Plan)
    warehouse = aliased(Team)
    return (
        select(Plan, ProcessRoute)
        .join(upstream, upstream.id == Plan.predecessor_id)
        .join(warehouse, warehouse.id == upstream.team_id)
        .join(ProcessRoute, ProcessRoute.id == Plan.process_route_id)
        .join(Task, Task.id == Plan.task_id)
        .join(Team, Team.id == Plan.team_id)
        .where(
            warehouse.id == team_id,
            warehouse.code == WAREHOUSE_TEAM_CODE,
            upstream.predecessor_id.is_(None),
            upstream.process_step_index == 0,
            upstream.process_route_id == Plan.process_route_id,
            upstream.task_id == Plan.task_id,
            upstream.next_team_id == Plan.team_id,
            upstream.cancelled_at.is_(None),
            Plan.serial_no == serial,
            Plan.cancelled_at.is_(None),
            Task.cancelled_at.is_(None),
            Task.serial_no == serial,
            ProcessRoute.state == "published",
            ProcessRoute.route_kind == "normal",
            Team.kind == "production",
            Team.active.is_(True),
        )
    )


def options(db, team_id, serial):
    from .production_schedules import iso, summaries

    pairs = db.execute(eligible_plans(team_id, serial).order_by(Plan.id)).all()
    if not pairs:
        return []
    receiving_ids = [plan.id for plan, _ in pairs]
    values = summaries(db, [*receiving_ids, *(plan.predecessor_id for plan, _ in pairs)])
    # Target feeding keeps the receiving plan on each lot. Ordinary warehouse
    # transfers are already counted by the predecessor's delivery summary.
    fed = {
        row.processing_schedule_id: row
        for row in db.execute(
            select(
                MaterialTransfer.processing_schedule_id,
                func.sum(MaterialTransfer.quantity).label("quantity"),
                func.sum(MaterialTransfer.weight).label("weight"),
            )
            .where(
                MaterialTransfer.processing_schedule_id.in_(receiving_ids),
                MaterialTransfer.source_team_id == team_id,
                MaterialTransfer.serial_no == serial,
                MaterialTransfer.entry_kind == "transfer",
                MaterialTransfer.sent_process_step_index == 0,
                MaterialTransfer.delivery_origin_id.is_(None),
                MaterialTransfer.status.in_(("pending", "received")),
                ~select(ProductionScheduleDelivery.transfer_id)
                .where(ProductionScheduleDelivery.transfer_id == MaterialTransfer.id)
                .exists(),
            )
            .group_by(MaterialTransfer.processing_schedule_id)
        )
    }
    result = []
    for plan, route in pairs:
        receiving = values[plan.id]
        if receiving["completed_at"]:
            continue
        warehouse = values[plan.predecessor_id]
        posted = fed.get(plan.id)
        result.append(
            {
                "serial_no": plan.serial_no,
                "schedule_id": plan.id,
                "route_id": route.id,
                "route_version": route.version,
                "team_id": plan.team_id,
                "task_id": plan.task_id,
                "task_batch_number": receiving["task_batch_number"],
                "team_name": receiving["team_name"],
                "due_at": iso(plan.due_at),
                "remaining_quantity": max(
                    0, warehouse["remaining_quantity"] - (posted.quantity if posted else 0)
                )
                if warehouse["remaining_quantity"] is not None
                else None,
                "remaining_weight": max(
                    0, warehouse["remaining_weight"] - (float(posted.weight) if posted else 0)
                )
                if warehouse["remaining_weight"] is not None
                else None,
            }
        )
    return result


def require_matching_materials(lines, lots, processing):
    from .warehouse_placements import SLOT_MATERIAL_FIELDS, physical_value

    first = {}
    for line in lines:
        lot = lots[line.source_transfer_id]
        record = processing.get(lot.id)
        for field, label in SLOT_MATERIAL_FIELDS.items():
            value = getattr(lot, field)
            if (
                field == "transfer_specification"
                and record
                and record.after_specification is not None
            ):
                value = record.after_specification
            current = physical_value(field, value)
            if first.setdefault(field, current) != current:
                raise HTTPException(422, f"合批转出的来源物料{label}不一致")
            if (
                field in line.model_fields_set
                and physical_value(field, getattr(line, field)) != current
            ):
                raise HTTPException(422, f"合批转出须沿用来源物料的{label}")
    if (
        sum(line.quantity for line in lines) > 2147483647
        or sum(line.weight for line in lines) >= 10**11
    ):
        raise HTTPException(422, "合批后的件数或重量超出单批上限")


def prepare(db, source, target, selection, lots):
    from .process_routes import require_dispatch_documents, warehouse_dispatch_portion

    row = db.execute(
        eligible_plans(source.id, selection.serial_no)
        .where(Plan.id == selection.schedule_id, Plan.team_id == target.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).one_or_none()
    if not row:
        raise HTTPException(422, "请选择目标流水号对应的首个加工班组排期")
    plan, route = row
    if (route.id, route.version) != (selection.route_id, selection.route_version):
        raise HTTPException(409, "目标排期工艺已变更，请重新选择")
    progress = progress_table(db, plan_ids=[plan.id])
    if db.scalar(select(progress.c.completed_at)):
        raise HTTPException(409, "目标排期已完成，请重新选择")
    for lot in lots:
        require_dispatch_documents(db, route, lot, plan.serial_no, plan.task_id)
    cursor = warehouse_dispatch_portion(db, route, source, plan.serial_no)
    return plan, cursor, order_fields(db, route, plan)


def order_fields(db, route, plan):
    from .schedule_order_documents import route_order

    order = route_order(db, route.id, plan.serial_no, plan.task_id)
    fields = {
        **route.source_data.get("receipt_fields", {}),
        **((order.document or {}).get("receipt_fields", {}) if order else {}),
    }
    return {key: (fields.get(key) or {}).get("value") or None for key in ORDER_FIELDS}


def prepare_joint(db, source, target, selections, lots):
    from .schedule_task_identity import task_batch_number_column
    from .schemas import SharedMaterialSerial
    from .shared_material import dispatch_cursor

    prepared = {
        selection.schedule_id: prepare(db, source, target, selection, lots)
        for selection in sorted(selections, key=lambda item: item.schedule_id)
    }
    plans = {}
    members = []
    routes = []
    batch_numbers = dict(
        db.execute(
            select(Task.id, task_batch_number_column()).where(
                Task.id.in_([plan.task_id for plan, _, _ in prepared.values()])
            )
        ).all()
    )
    for selection in selections:
        plan, cursor, fields = prepared[selection.schedule_id]
        routes.append(cursor.process_route)
        members.append(
            SharedMaterialSerial(
                serial_no=plan.serial_no,
                process_route_id=selection.route_id,
                process_route_version=selection.route_version,
                customer_code=fields.get("customer_code"),
                finished_specification=fields.get("finished_specification"),
            )
        )
        plans[plan.serial_no] = {
            "feeding_schedule_id": plan.id,
            "task_batch_number": batch_numbers[plan.task_id],
        }
    return dispatch_cursor(db, source, routes), members, plans
