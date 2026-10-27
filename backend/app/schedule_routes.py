"""Explicit route reconciliation for existing delivery commitments."""

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import aliased, load_only

from . import production_schedules as schedules
from .models import (
    MaterialQuantityAdjustment as Work,
)
from .models import (
    MaterialTransfer as Lot,
)
from .models import (
    ProcessRoute as Route,
)
from .models import (
    ProcessRouteArchive,
    ProcessRoutePath,
    Team,
    utcnow,
)
from .models import (
    ProductionSchedule as Plan,
)
from .models import (
    ProductionScheduleDelivery as Delivery,
)
from .models import (
    ProductionScheduleSource as Source,
)
from .production_schedule_schemas import ScheduleCreate, ScheduleSource


class RouteMapping(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schedule_id: int = Field(ge=1)
    expected_version: int = Field(ge=1)
    step_index: int = Field(ge=0)


class RouteLink(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1)
    route_id: int = Field(ge=1)
    route_version: int = Field(ge=1)
    mappings: list[RouteMapping] = Field(min_length=1, max_length=50)


def latest_routes(db, route_ids):
    if not route_ids:
        return {}
    chain = (
        select(Route.id.label("origin"), Route.id)
        .where(Route.id.in_(route_ids))
        .cte("schedule_route_revisions", recursive=True)
    )
    chain = chain.union_all(
        select(chain.c.origin, Route.id)
        .join(chain, Route.parent_id == chain.c.id)
        .where(Route.state == "published")
    )
    result = {}
    for origin, route in db.execute(select(chain.c.origin, chain.c.id).order_by(chain.c.id)):
        result[origin] = route
    return result


def route_states(db, plans):
    current = latest_routes(db, {p.process_route_id for p in plans if p.process_route_id})
    return {
        p.id: {
            "state": "unlinked"
            if not p.process_route_id
            else "changed"
            if current[p.process_route_id] != p.process_route_id
            else "linked",
            "latest_route_id": current[p.process_route_id] if p.process_route_id else None,
        }
        for p in plans
    }


def options(db, task):
    successor = aliased(Route)
    return list(
        db.scalars(
            select(Route)
            .options(
                load_only(Route.id, Route.title, Route.version, Route.steps, Route.published_at)
            )
            .where(
                Route.id.in_(
                    select(ProcessRoutePath.route_id).where(
                        ProcessRoutePath.serial_no == task.serial_no
                    )
                ),
                Route.route_kind == "normal",
                Route.state == "published",
                ~select(successor.id)
                .where(successor.parent_id == Route.id, successor.state == "published")
                .exists(),
                ~select(ProcessRouteArchive.route_id)
                .where(ProcessRouteArchive.route_id == Route.id)
                .exists(),
            )
            .order_by(Route.id.desc())
        )
    )


def option_documents(db, task):
    return [
        dict(
            id=r.id,
            title=r.title,
            version=r.version,
            steps=r.steps,
            published_at=schedules.iso(r.published_at),
        )
        for r in options(db, task)
    ]


def link(db, task_id, payload, user):
    from .production_schedule_tasks import detail, require_task

    with db.begin():
        db.scalar(select(Team.id).order_by(Team.id).limit(1).with_for_update())
        task = require_task(db, task_id, lock=True)
        if task.version != payload.expected_version:
            raise HTTPException(409, "排期任务已变化，请刷新后核对")
        route = db.scalar(select(Route).where(Route.id == payload.route_id).with_for_update())
        if (
            not route
            or route.version != payload.route_version
            or route.id not in {r.id for r in options(db, task)}
        ):
            raise HTTPException(409, "工艺已变化，请重新选择当前工艺")
        plans = {
            p.id: p
            for p in db.scalars(select(Plan).where(Plan.task_id == task_id).with_for_update())
        }
        if len({m.schedule_id for m in payload.mappings}) != len(payload.mappings):
            raise HTTPException(422, "排期节点不能重复关联")
        indices = []
        for mapping in payload.mappings:
            plan = plans.get(mapping.schedule_id)
            if not plan or plan.cancelled_at or plan.version != mapping.expected_version:
                raise HTTPException(409, "排期节点已变化，请刷新后核对")
            if (plan.process_route_id, plan.process_step_index) == (route.id, mapping.step_index):
                continue
            if (
                db.scalar(
                    select(Delivery.transfer_id).where(Delivery.schedule_id == plan.id).limit(1)
                )
                or db.scalar(select(Work.id).where(Work.production_schedule_id == plan.id).limit(1))
                or db.scalar(select(Lot.id).where(Lot.processing_schedule_id == plan.id).limit(1))
            ):
                raise HTTPException(409, "已有加工或转出记录的节点须保留原工艺")
            data = {field: getattr(plan, field) for field in schedules.FIELDS}
            data.update(process_route_id=route.id, process_step_index=mapping.step_index)
            data["sources"] = [
                ScheduleSource.model_validate(
                    {
                        "source_transfer_id": s.source_transfer_id,
                        "quantity": s.quantity,
                        "weight": s.weight,
                    }
                )
                for s in db.scalars(select(Source).where(Source.schedule_id == plan.id))
            ]
            candidate = ScheduleCreate.model_construct(**data)
            # Identity and physical source scope must still agree with the selected route.
            schedules.validate_plan(db, candidate)
            before = schedules.snapshot(db, plan)
            plan.process_route_id, plan.process_step_index = route.id, mapping.step_index
            plan.version += 1
            plan.updated_at = utcnow()
            schedules.record_event(db, plan, user, "route_linked", before)
        for plan in sorted(plans.values(), key=lambda p: (p.sequence_no, p.id)):
            if not plan.cancelled_at and plan.process_route_id == route.id:
                indices.append(plan.process_step_index)
        if indices != sorted(set(indices)):
            raise HTTPException(422, "关联工序须按工艺顺序排列，不能重复")
        task.version += 1
        task.updated_at = utcnow()
    return detail(db, task_id)
