"""Explicit team batch plans. Upstream dates inform, never rewrite, their periods."""

from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import select

from .models import (
    ProductionSchedule as Plan,
)
from .models import (
    ProductionScheduleBatch as Batch,
)
from .models import (
    ProductionScheduleDelivery as Delivery,
)
from .models import (
    ProductionScheduleSource as Source,
)
from .models import (
    ProductionScheduleTask as Task,
)
from .models import (
    Team,
    utcnow,
)
from .production_schedule_schemas import ScheduleNode
from .team_constants import WAREHOUSE_TEAM_CODE


class BatchWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: int | None = Field(default=None, ge=1)
    batch_number: int = Field(ge=1, le=9999)
    planned_start_at: datetime
    due_at: datetime
    target_quantity: int | None = Field(default=None, gt=0, le=2_147_483_647)
    target_weight: Decimal | None = Field(default=None, gt=0, max_digits=17, decimal_places=6)
    upstream_batch_ids: list[int] = Field(default_factory=list, max_length=100)

    @field_validator("planned_start_at", "due_at")
    @classmethod
    def hour(cls, value):
        return ScheduleNode.hour(value)

    @model_validator(mode="after")
    def period(self):
        if self.planned_start_at >= self.due_at:
            raise ValueError("计划开始时间须早于计划转出时间")
        if self.target_quantity is None and self.target_weight is None:
            raise ValueError("请填写每批数量或重量")
        if len(set(self.upstream_batch_ids)) != len(self.upstream_batch_ids):
            raise ValueError("上游批次不能重复")
        return self


class BatchPlanWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1)
    batches: list[BatchWrite] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def unique(self):
        for values in (
            [b.batch_number for b in self.batches],
            [b.id for b in self.batches if b.id],
        ):
            if len(values) != len(set(values)):
                raise ValueError("批次不能重复")
        if sum(b.target_quantity or 0 for b in self.batches) > 2_147_483_647:
            raise ValueError("计划总件数超出范围")
        if sum(b.target_weight or 0 for b in self.batches) >= Decimal("100000000000"):
            raise ValueError("计划总重量超出范围")
        return self


def batch_values(batch):
    from .production_schedules import iso

    return {
        "id": batch.id,
        "batch_number": batch.batch_number,
        "planned_start_at": iso(batch.planned_start_at),
        "due_at": iso(batch.due_at),
        "target_quantity": batch.target_quantity,
        "target_weight": float(batch.target_weight) if batch.target_weight is not None else None,
        "upstream_batch_ids": batch.upstream_batch_ids,
    }


def snapshots(db, plan_id):
    return [
        batch_values(b)
        for b in db.scalars(
            select(Batch).where(Batch.schedule_id == plan_id).order_by(Batch.batch_number)
        )
    ]


def summaries(db, plans, *, now=None):
    from .production_schedules import LOCAL_ZONE, iso, progress_table

    if not plans:
        return {}
    now = now or utcnow()
    parents = {p.id: p for p in plans}
    batches = list(
        db.scalars(select(Batch).where(Batch.schedule_id.in_(parents)).order_by(Batch.batch_number))
    )
    if not batches:
        return {}
    upstream_ids = {bid for b in batches for bid in b.upstream_batch_ids}
    upstream = (
        {b.id: b for b in db.scalars(select(Batch).where(Batch.id.in_(upstream_ids)))}
        if upstream_ids
        else {}
    )
    tasks = {
        t.id: t for t in db.scalars(select(Task).where(Task.id.in_({p.task_id for p in plans})))
    }
    warehouse_ids = set(db.scalars(select(Team.id).where(Team.code == WAREHOUSE_TEAM_CODE)))
    progress = progress_table(plan_ids=list(parents), batches=True)
    totals = {row._mapping["schedule_id"]: row._mapping for row in db.execute(select(progress))}
    result = {}
    for b in batches:
        p = parents[b.schedule_id]
        assessed = p.team_id not in warehouse_ids
        actual = totals.get(b.id, {})
        q, w = actual.get("dispatched_quantity", 0), actual.get("dispatched_weight", 0)
        rq, rw = actual.get("received_quantity", 0), actual.get("received_weight", 0)
        end = actual.get("completed_at")
        state = (
            "cancelled"
            if p.cancelled_at
            else "not_assessed"
            if not assessed
            else ("completed_late" if end > b.due_at else "completed")
            if end
            else "overdue"
            if b.due_at < now
            else "today"
            if b.due_at.replace(tzinfo=timezone.utc).astimezone(LOCAL_ZONE).date()
            == now.replace(tzinfo=timezone.utc).astimezone(LOCAL_ZONE).date()
            else "pending"
        )
        warnings = []
        for uid in b.upstream_batch_ids:
            source = upstream.get(uid)
            if source and source.due_at > b.planned_start_at:
                warnings.append(f"上游第 {source.batch_number} 批计划转出晚于本批开始")
        final = tasks[p.task_id].final_due_at
        if final and b.due_at > final:
            warnings.append("计划转出晚于最终交期")
        result.setdefault(p.id, []).append(
            {
                **batch_values(b),
                "status": state,
                "warnings": warnings,
                "dispatched_quantity": q,
                "dispatched_weight": float(w),
                "received_quantity": rq,
                "received_weight": float(rw),
                "completed_at": iso(end),
            }
        )
    return result


def save(db, plan_id, payload, user):
    from .production_schedules import detail, record_event, require_plan, snapshot

    with db.begin():
        db.scalar(select(Team.id).order_by(Team.id).limit(1).with_for_update())
        plan = require_plan(db, plan_id, lock=True)
        if user.role != "ADMIN" and not (
            user.role == "TEAM"
            and user.team_id == plan.team_id
            and user.team.active
            and user.team.kind != "engineering"
        ):
            raise HTTPException(403, "仅本班组账号或管理员可以安排批次")
        if plan.cancelled_at or plan.version != payload.expected_version:
            raise HTTPException(409, "排期已变更，请刷新后重试")
        task = db.scalar(select(Task).where(Task.id == plan.task_id).with_for_update())
        existing = {
            b.id: b
            for b in db.scalars(select(Batch).where(Batch.schedule_id == plan_id).with_for_update())
        }
        before = snapshot(db, plan)
        requested = {b.id for b in payload.batches if b.id}
        if requested - existing.keys():
            raise HTTPException(422, "批次不属于本班组排期")
        allowed_upstream = set(
            db.scalars(select(Batch.id).where(Batch.schedule_id == plan.predecessor_id))
        )
        for b in payload.batches:
            if set(b.upstream_batch_ids) - allowed_upstream:
                raise HTTPException(422, "请选择上道工序的供料批次")
            if (plan.completion_basis != "weight" and b.target_quantity is None) or (
                plan.completion_basis != "quantity" and b.target_weight is None
            ):
                raise HTTPException(422, "请按本计划计量方式填写每批数量")
        removed = existing.keys() - requested
        downstream = db.scalars(
            select(Batch)
            .join(Plan, Plan.id == Batch.schedule_id)
            .where(Plan.predecessor_id == plan_id)
        ).all()
        if removed and (
            db.scalar(
                select(Delivery.transfer_id).where(Delivery.schedule_batch_id.in_(removed)).limit(1)
            )
            or any(removed.intersection(b.upstream_batch_ids) for b in downstream)
        ):
            raise HTTPException(409, "已有交货或下游引用的批次不能删除")
        quantity = sum(b.target_quantity or 0 for b in payload.batches) or plan.target_quantity
        weight = (
            sum((b.target_weight or Decimal(0) for b in payload.batches), Decimal(0))
            or plan.target_weight
        )
        sources = db.scalars(select(Source).where(Source.schedule_id == plan.id)).all()
        for field, target in (("quantity", quantity), ("weight", weight)):
            allocated = sum(getattr(source, field) or 0 for source in sources)
            if allocated and (target is None or allocated > target):
                raise HTTPException(422, "计划总量不能小于已关联物料的分配量")
        for bid in removed:
            db.delete(existing[bid])
        for entry in payload.batches:
            data = entry.model_dump(exclude={"id"})
            if entry.id:
                for key, value in data.items():
                    setattr(existing[entry.id], key, value)
            else:
                db.add(Batch(schedule_id=plan.id, **data))
        plan.target_quantity = quantity
        plan.target_weight = weight
        plan.due_at = max(b.due_at for b in payload.batches)
        plan.version += 1
        plan.updated_at = utcnow()
        task.version += 1
        task.updated_at = utcnow()
        db.flush()
        record_event(db, plan, user, "batches_updated", before)
    return detail(db, plan_id)


def select_dispatch_batch(batches, requested):
    if requested:
        if requested not in {b.id for b in batches}:
            raise HTTPException(422, "所选交货批次不属于本排期")
        return requested
    if len(batches) > 1:
        raise HTTPException(422, "请选择本次转出对应的交货批次；不同批次请拆分明细")
    return batches[0].id if batches else None
