"""Warehouse material inputs are reserved by source and processed on the receiving plan."""

from datetime import datetime

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import aliased

from .models import ProcessRoute, Team
from .models import ProductionSchedule as Plan
from .models import ProductionScheduleTask as Task
from .production_schedule_queries import progress_table
from .team_constants import WAREHOUSE_TEAM_CODE


class FeedingTarget(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    serial_no: str = Field(min_length=1, max_length=80)
    schedule_id: int = Field(ge=1)
    route_id: int = Field(ge=1)
    route_version: int = Field(ge=1)


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
    values = summaries(db, [plan.id for plan, _ in pairs])
    return [
        {
            "serial_no": plan.serial_no,
            "schedule_id": plan.id,
            "route_id": route.id,
            "route_version": route.version,
            "team_id": plan.team_id,
            "task_id": plan.task_id,
            "due_at": iso(plan.due_at),
            **{
                key: values[plan.id][key]
                for key in (
                    "task_batch_number",
                    "team_name",
                    "remaining_quantity",
                    "remaining_weight",
                )
            },
        }
        for plan, route in pairs
        if not values[plan.id]["completed_at"]
    ]


def prepare(db, source, target, selection, lot):
    from .material_transfer_workflow import DOCUMENT_FIELDS
    from .process_routes import require_dispatch_documents, warehouse_dispatch_portion
    from .schedule_order_documents import route_order

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
    require_dispatch_documents(db, route, lot, plan.serial_no, plan.task_id)
    cursor = warehouse_dispatch_portion(db, route, source, plan.serial_no)
    order = route_order(db, route.id, plan.serial_no, plan.task_id)
    fields = {
        **route.source_data.get("receipt_fields", {}),
        **((order.document or {}).get("receipt_fields", {}) if order else {}),
    }
    physical = {
        "material_name",
        "material_type",
        "transfer_specification",
        "source_batch_no",
        "material_shape",
        "material_description",
        "is_outsourced",
        "outsourced_unit",
    }
    order_fields = {
        key: (fields.get(key) or {}).get("value") or None
        for key in DOCUMENT_FIELDS
        if key not in physical
    }
    return plan, cursor, order_fields
