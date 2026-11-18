"""Authorized, atomic inventory entries; each submission adds independent lots."""

from datetime import datetime, timezone
from decimal import Decimal
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from . import material_stock as stock
from . import material_transfer_workflow as workflow
from .auth import actor_name
from .batch_numbers import next_transfer_batch_number
from .material_delivery import with_schedule
from .material_weight import sludge_measurement, validate_material_amounts
from .models import (
    MaterialTransfer,
    OpeningStockSubmission,
    ProcessRoute,
    ProductionSchedule,
    ProductionScheduleTask,
    Team,
    User,
    utcnow,
)
from .process_route_paths import execution_serial
from .process_routes import require_dispatch_documents
from .schedule_task_identity import task_batch_number_column
from .schemas import SCRAP_MATERIAL_TYPES, MaterialTransferDocumentFields, SludgeMeasurement
from .team_business import purpose_snapshot


class OpeningLine(MaterialTransferDocumentFields, SludgeMeasurement):
    model_config = ConfigDict(extra="forbid")
    stock_type: Literal["order", "non_order"] | None = None
    serial_no: str = Field(default="", max_length=80)
    production_schedule_id: int | None = Field(default=None, ge=1)
    process_route_id: int | None = Field(default=None, ge=1)
    process_route_version: int | None = Field(default=None, ge=1)
    process_step_index: int | None = Field(default=None, ge=0)
    process_step_complete: bool = False
    material_name: str = Field(min_length=1, max_length=160)
    purpose_id: int | None = Field(default=None, ge=1)
    quantity: int = Field(ge=0, le=2_147_483_647)
    weight: Decimal = Field(ge=0, max_digits=17, decimal_places=6)
    notes: str | None = Field(default=None, max_length=2000)

    @field_validator("serial_no")
    @classmethod
    def serial(cls, value):
        return value.strip()

    @model_validator(mode="after")
    def valid(self):
        if not self.material_name or not self.material_type:
            raise ValueError("请填写材质并选择物料类型")
        if self.quantity == 0 and self.weight == 0:
            raise ValueError("件数和重量至少一项大于零")
        if not self.serial_no and (
            self.stock_type == "order"
            or (self.stock_type is None and self.material_type not in SCRAP_MATERIAL_TYPES)
        ):
            raise ValueError("请填写流水号")
        binding = (
            self.production_schedule_id,
            self.process_route_id,
            self.process_route_version,
            self.process_step_index,
        )
        if self.stock_type == "order":
            if self.material_type in SCRAP_MATERIAL_TYPES:
                raise ValueError("废料请选非订单物料")
            if any(value is None for value in binding):
                raise ValueError("请选择排期批次和当前工序")
        elif any(value is not None for value in binding) or self.process_step_complete:
            raise ValueError("请选择订单物料后关联排期工艺")
        return self


class OpeningCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    idempotency_key: str = Field(min_length=1, max_length=100)
    lines: list[OpeningLine] = Field(min_length=1, max_length=100)

    @field_validator("idempotency_key")
    @classmethod
    def key(cls, value):
        if not value.strip():
            raise ValueError("idempotency_key cannot be blank")
        return value.strip()


class OpeningStepOption(BaseModel):
    index: int
    sequence_no: int
    name: str


class OpeningOrderOption(BaseModel):
    schedule_id: int
    task_id: int
    task_batch_number: int
    due_at: datetime
    route_id: int
    route_title: str
    route_version: int
    steps: list[OpeningStepOption]


def schedule_rows(db, team_id, serial_no, schedule_id=None):
    plan, task, route = ProductionSchedule, ProductionScheduleTask, ProcessRoute
    query = (
        select(plan, task, route, task_batch_number_column())
        .join(task, task.id == plan.task_id)
        .join(route, route.id == plan.process_route_id)
        .where(
            plan.team_id == team_id,
            plan.serial_no == serial_no,
            task.serial_no == serial_no,
            plan.cancelled_at.is_(None),
            task.cancelled_at.is_(None),
            task.final_due_at.is_not(None),
            route.route_kind == "normal",
            route.state == "published",
        )
        .order_by(task.id, plan.process_step_index)
    )
    if schedule_id is not None:
        query = query.where(plan.id == schedule_id).with_for_update()
    return db.execute(query)


def opening_steps(plan, route, serial_no):
    if plan.process_step_index is None or not 0 <= plan.process_step_index < len(route.steps):
        return []
    serial = execution_serial(route, serial_no)
    indices = []
    for index in range(plan.process_step_index, -1, -1):
        step = route.steps[index]
        if step.get("serial_nos") and serial not in step["serial_nos"]:
            continue
        if step["team_id"] != plan.team_id:
            break
        indices.append(index)
    return indices[::-1] if plan.process_step_index in indices else []


def options(*, team_id: int, serial_no: str, user: User, db: Session):
    stock.actor_team(db, user, team_id)
    serial_no = serial_no.strip()
    rows = []
    for plan, task, route, batch_number in schedule_rows(db, team_id, serial_no):
        steps = opening_steps(plan, route, serial_no)
        if steps:
            rows.append(
                {
                    "schedule_id": plan.id,
                    "task_id": task.id,
                    "task_batch_number": batch_number,
                    "due_at": task.final_due_at.replace(tzinfo=timezone.utc),
                    "route_id": route.id,
                    "route_title": route.title,
                    "route_version": route.version,
                    "steps": [
                        {
                            "index": index,
                            "sequence_no": route.steps[index]["sequence_no"],
                            "name": route.steps[index]["name"],
                        }
                        for index in steps
                    ],
                }
            )
    return rows


def bind_order(db, team, line, transfer):
    selected = schedule_rows(db, team.id, line.serial_no, line.production_schedule_id).one_or_none()
    if not selected:
        raise HTTPException(422, "排期批次与流水号或本班组不符，或已取消")
    plan, task, route, _ = selected
    index = line.process_step_index
    if (route.id, route.version) != (line.process_route_id, line.process_route_version):
        raise HTTPException(409, "工艺版本已变化，请重新选择")
    if index not in opening_steps(plan, route, line.serial_no):
        raise HTTPException(422, "请选择本排期在当前班组的工序")
    require_dispatch_documents(db, route, transfer, line.serial_no, task.id)
    transfer.process_route = route
    transfer.process_step_index = index
    transfer.process_step_complete = team.kind == "warehouse" or line.process_step_complete
    transfer.processing_schedule_id = plan.id
    step = route.steps[index]
    transfer.purpose_id = step["purpose_id"]
    transfer.purpose_name = step.get("purpose_name")


def result(db, submission, user):
    rows = db.scalars(
        select(MaterialTransfer)
        .where(MaterialTransfer.opening_stock_id == submission.id)
        .order_by(MaterialTransfer.id)
    ).all()
    return {
        "id": submission.id,
        "items": with_schedule(db, [workflow.material_transfer_dict(row, user) for row in rows]),
        "count": len(rows),
    }


def state(*, team_id: int, user: User, db: Session):
    team = stock.require_team(db, team_id)
    submission = db.scalar(
        select(OpeningStockSubmission.id).where(OpeningStockSubmission.team_id == team_id).limit(1)
    )
    has_stock_history = (
        db.scalar(
            select(MaterialTransfer.id)
            .where(
                MaterialTransfer.next_team_id == team_id,
                MaterialTransfer.status == "received",
                MaterialTransfer.stock_tracked.is_(True),
            )
            .limit(1)
        )
        is not None
    )
    return {
        "enabled": team.opening_stock_enabled,
        "completed": submission is not None,
        "has_stock_history": has_stock_history,
        "can_submit": (user.role == "ADMIN" or (user.role == "TEAM" and user.team_id == team_id))
        and team.active
        and (user.role == "ADMIN" or team.opening_stock_enabled)
        and team.kind not in ("engineering", "dispatch", "business"),
        "items": with_schedule(
            db,
            [
                workflow.material_transfer_dict(row, user)
                for row in db.scalars(
                    select(MaterialTransfer)
                    .where(
                        MaterialTransfer.next_team_id == team_id,
                        MaterialTransfer.opening_stock_id.is_not(None),
                    )
                    .order_by(MaterialTransfer.id)
                )
            ],
        )
        if submission
        else [],
    }


def create(*, payload: OpeningCreate, team_id: int, user: User, db: Session):
    stock.require_actor(user, team_id)
    request_hash = stock.fingerprint(payload)
    try:
        with db.begin():
            team = db.scalar(
                select(Team)
                .where(Team.id == team_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            prior = db.scalar(
                select(OpeningStockSubmission)
                .where(OpeningStockSubmission.idempotency_key == payload.idempotency_key)
                .with_for_update()
            )
            if prior:
                stock._replay(prior, user, request_hash, "team_id", team_id)
                return result(db, prior, user)
            if team.kind in ("engineering", "dispatch", "business"):
                raise HTTPException(403, "该班组不登记实物库存")
            if not team.active or (user.role != "ADMIN" and not team.opening_stock_enabled):
                raise HTTPException(403, "管理员尚未开启本班组的初始库存录入权限")
            submission = OpeningStockSubmission(
                team_id=team_id,
                idempotency_key=payload.idempotency_key,
                request_hash=request_hash,
                created_by=actor_name(user),
            )
            db.add(submission)
            db.flush()
            now = utcnow()
            for line in payload.lines:
                if line.stock_type == "non_order" and (
                    line.material_type not in SCRAP_MATERIAL_TYPES
                    and not (team.kind == "warehouse" and line.material_type == "raw_material")
                ):
                    raise HTTPException(422, "非订单物料仅支持废料和库房原材料")
                validate_material_amounts(line.material_type, line.quantity, line.weight)
                measured = sludge_measurement(
                    line.material_type,
                    line.weight,
                    line.sludge_gross_weight,
                    line.sludge_content_percent,
                )
                purpose = purpose_snapshot(
                    db,
                    team_id,
                    line.purpose_id if line.stock_type is None else None,
                    required=False,
                )
                transfer = MaterialTransfer(
                    batch_no=next_transfer_batch_number(db),
                    entry_kind="opening_stock",
                    opening_stock_id=submission.id,
                    serial_no="" if line.stock_type == "non_order" else line.serial_no,
                    **{field: getattr(line, field) for field in workflow.DOCUMENT_FIELDS},
                    **purpose,
                    next_team_id=team.id,
                    next_team_code=team.code,
                    next_team_name=team.name,
                    quantity=line.quantity,
                    weight=line.weight,
                    notes=line.notes,
                    status="received",
                    stock_tracked=True,
                    **measured,
                    created_by=actor_name(user),
                    created_by_user_id=user.id,
                    received_by=actor_name(user),
                    received_by_user_id=user.id,
                    created_at=now,
                    updated_at=now,
                    received_at=now,
                )
                if line.stock_type == "order":
                    bind_order(db, team, line, transfer)
                db.add(transfer)
                db.flush()
                db.refresh(transfer, attribute_names=["created_at", "updated_at", "received_at"])
                workflow._record_event(db, transfer, user, "stocked")
            response = result(db, submission, user)
        return response
    except (IntegrityError, OperationalError) as exc:
        db.rollback()
        prior = db.scalar(
            select(OpeningStockSubmission).where(
                OpeningStockSubmission.idempotency_key == payload.idempotency_key
            )
        )
        if prior:
            stock._replay(prior, user, request_hash, "team_id", team_id)
            return result(db, prior, user)
        stock._db_conflict(exc)
