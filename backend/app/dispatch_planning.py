"""Dispatch defines customer dates; route teams submit execution plans for approval."""

from datetime import datetime
from decimal import Decimal, InvalidOperation
from types import SimpleNamespace

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import select

from . import production_schedules as schedules
from .models import ProductionSchedule as Plan
from .models import Team, utcnow
from .production_schedule_schemas import CustomerBatch, ScheduleNode, ScheduleTaskCreate
from .schedule_permissions import require_unlocked


class DispatchTaskCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    idempotency_key: str = Field(min_length=1, max_length=100)
    serial_no: str = Field(min_length=1, max_length=80)
    route_id: int = Field(ge=1)
    route_version: int = Field(ge=1)
    final_due_at: datetime
    delivery_batches: list[CustomerBatch] = Field(default_factory=list, max_length=100)
    business_person_ids: list[int] = Field(min_length=1, max_length=100)
    notes: str | None = Field(default=None, max_length=2000)

    @field_validator("serial_no")
    @classmethod
    def serial(cls, value):
        if not value.strip():
            raise ValueError("请选择流水号")
        return value.strip()

    @field_validator("final_due_at")
    @classmethod
    def hour(cls, value):
        return ScheduleNode.hour(value)

    @model_validator(mode="after")
    def batches(self):
        validate_customer_batches(self.delivery_batches, self.final_due_at)
        return self


def validate_customer_batches(batches, final_due, quantity=None):
    if len({b.batch_number for b in batches}) != len(batches):
        raise ValueError("交货批次不能重复")
    if batches and max(b.due_at for b in batches) != final_due:
        raise ValueError("最后一批交期须与最终交期一致")
    if any(
        a.due_at > b.due_at
        for a, b in zip(
            sorted(batches, key=lambda b: b.batch_number),
            sorted(batches, key=lambda b: b.batch_number)[1:],
            strict=False,
        )
    ):
        raise ValueError("请按批次顺序设置交期")
    if quantity is not None and sum(b.target_quantity for b in batches) != quantity:
        raise ValueError("各批数量合计须等于工艺的计划数量")


def customer_values(batches):
    return [{**b.model_dump(), "due_at": schedules.iso(b.due_at)} for b in batches]


def route_options(db, serial):
    from .schedule_routes import option_documents

    return option_documents(db, SimpleNamespace(serial_no=serial))


def build_task(db, payload):
    routes = route_options(db, payload.serial_no)
    route = next((r for r in routes if r["id"] == payload.route_id), None)
    if not route or route["version"] != payload.route_version:
        raise HTTPException(409, "工艺已变化，请重新选择当前工艺")
    nodes = []
    for index, step in enumerate(route["steps"]):
        if step.get("serial_nos") and payload.serial_no not in step["serial_nos"]:
            continue
        try:
            raw = Decimal(str(step.get("planned_quantity") or "0"))
            quantity = int(raw) if raw.is_finite() and raw == raw.to_integral() else 0
        except (ValueError, InvalidOperation):
            quantity = 0
        if quantity <= 0 or quantity > 2_147_483_647:
            raise HTTPException(422, f"工艺的{step['name']}缺少有效计划件数，请由工艺人员补齐")
        team = db.get(Team, step.get("team_id"))
        if not team or not team.active or team.kind not in ("warehouse", "production"):
            raise HTTPException(422, "工艺包含未启用的执行班组，请先修正工艺")
        node = dict(
            process_route_id=route["id"],
            process_step_index=index,
            team_id=team.id,
            target_quantity=quantity,
            due_at=payload.final_due_at,
            completion_basis="quantity",
            sources=[],
            notes=step["name"],
        )
        if nodes and nodes[-1]["team_id"] == team.id:
            nodes[-1] = node
        else:
            nodes.append(node)
    if not nodes:
        raise HTTPException(422, "工艺中没有该流水号的执行班组")
    batches = payload.delivery_batches or [
        CustomerBatch.model_construct(
            batch_number=1,
            due_at=payload.final_due_at,
            target_quantity=nodes[-1]["target_quantity"],
        )
    ]
    try:
        validate_customer_batches(batches, payload.final_due_at, nodes[-1]["target_quantity"])
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    for i, node in enumerate(nodes):
        node["next_team_id"] = nodes[i + 1]["team_id"] if i + 1 < len(nodes) else None
        node["external_destination"] = None if i + 1 < len(nodes) else "库房成品"
    return ScheduleTaskCreate.model_construct(
        idempotency_key=payload.idempotency_key,
        serial_no=payload.serial_no,
        title=payload.serial_no,
        final_due_at=payload.final_due_at,
        notes=payload.notes,
        business_person_id=payload.business_person_ids[0] if payload.business_person_ids else None,
        business_person_ids=payload.business_person_ids,
        nodes=[ScheduleNode.model_construct(**n) for n in nodes],
    ), customer_values(batches)


class TaskLock(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1)
    locked: bool


class TaskDelete(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1)


def lock_task(db, task_id, payload, user):
    from .production_schedule_tasks import detail, require_task

    with db.begin():
        db.scalar(select(Team.id).order_by(Team.id).limit(1).with_for_update())
        task = require_task(db, task_id, lock=True)
        if task.cancelled_at or task.version != payload.expected_version:
            raise HTTPException(409, "订单已变化，请刷新后重试")
        if bool(task.locked_at) != payload.locked:
            task.locked_at = utcnow() if payload.locked else None
            task.version += 1
            task.updated_at = utcnow()
            for plan in db.scalars(
                select(Plan).where(Plan.task_id == task_id, Plan.cancelled_at.is_(None))
            ):
                before = schedules.snapshot(db, plan)
                plan.version += 1
                plan.updated_at = task.updated_at
                schedules.record_event(
                    db, plan, user, "order_locked" if payload.locked else "order_unlocked", before
                )
    return detail(db, task_id)


def delete_task(db, task_id, payload, user):
    from .production_schedule_tasks import require_task

    with db.begin():
        db.scalar(select(Team.id).order_by(Team.id).limit(1).with_for_update())
        task = require_task(db, task_id, lock=True)
        require_unlocked(task)
        if task.version != payload.expected_version:
            raise HTTPException(409, "订单已变化，请刷新后重试")
        task.cancelled_at = task.updated_at = utcnow()
        task.version += 1
        for plan in db.scalars(
            select(Plan).where(Plan.task_id == task_id, Plan.cancelled_at.is_(None))
        ):
            before = schedules.snapshot(db, plan)
            plan.cancelled_at = plan.updated_at = task.updated_at
            plan.pending_batches = None
            plan.version += 1
            schedules.record_event(db, plan, user, "cancelled", before)
