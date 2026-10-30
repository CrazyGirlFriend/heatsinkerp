"""Rework is a cause of delay on the original commitment, never a second quota."""

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import aliased, defer

from . import production_schedules as schedules
from .material_lineage import relatives
from .models import MaterialQuantityAdjustment as Work
from .models import MaterialTransfer as Lot
from .models import ProcessRoute as Route
from .models import ProductionSchedule as Plan
from .models import ProductionScheduleDelivery as Delivery
from .models import ProductionScheduleSource as Source
from .models import Team, utcnow


class ReworkLink(BaseModel):
    model_config = ConfigDict(extra="forbid")
    route_id: int = Field(ge=1)
    route_version: int = Field(ge=1)
    schedule_id: int = Field(ge=1)
    expected_version: int = Field(ge=1)


def candidates(db, route):
    root = db.get(Lot, route.rework_source_transfer_id)
    ancestry = relatives([root.id], ancestors=True, name="rework_schedule_ancestry")
    ids = select(ancestry.c.id)
    explicit = select(Work.production_schedule_id).where(
        Work.source_transfer_id.in_(ids), Work.production_schedule_id.is_not(None)
    )
    sourced = select(Source.schedule_id).where(Source.source_transfer_id.in_(ids))
    delivered = select(Delivery.schedule_id).where(Delivery.transfer_id.in_(ids))
    return list(
        db.scalars(
            select(Plan)
            .where(
                Plan.serial_no == root.serial_no,
                Plan.cancelled_at.is_(None),
                (Plan.id.in_(explicit))
                | (Plan.id.in_(sourced))
                | (Plan.id.in_(delivered))
                | (Plan.id == root.processing_schedule_id),
            )
            .order_by(Plan.id)
        )
    )


def links_for_tasks(db, task_ids):
    if not task_ids:
        return {}
    successor = aliased(Route)
    rows = db.execute(
        select(Route, Plan, Lot)
        .options(defer(Route.source_file), defer(Route.source_data))
        .join(Plan, Plan.id == Route.original_schedule_id)
        .join(Lot, Lot.id == Route.rework_source_transfer_id)
        .where(
            Plan.task_id.in_(task_ids),
            Route.route_kind == "rework",
            ~select(successor.id)
            .where(successor.parent_id == Route.id, successor.state == "published")
            .exists(),
            ~((Route.parent_id.is_not(None)) & (Route.state == "draft")),
        )
    ).all()
    totals = {
        (route_id, index): quantity
        for route_id, index, quantity in db.execute(
            select(
                Work.process_route_id, Work.process_step_index, func.sum(Work.completed_quantity)
            )
            .where(
                Work.process_route_id.in_([r.id for r, _, _ in rows]), Work.work_kind == "rework"
            )
            .group_by(Work.process_route_id, Work.process_step_index)
        )
    }
    completed = {r.id: totals.get((r.id, len(r.steps) - 1), 0) or 0 for r, _, _ in rows}
    result = {}
    for route, plan, lot in rows:
        result.setdefault(plan.task_id, []).append(
            dict(
                route_id=route.id,
                route_version=route.version,
                schedule_id=plan.id,
                batch_no=lot.batch_no,
                problem=route.request_reason,
                quantity=lot.quantity,
                completed_quantity=completed.get(route.id, 0) or 0,
                state="awaiting_route"
                if route.state != "published"
                else "processed"
                if (completed.get(route.id, 0) or 0) >= lot.quantity
                else "processing",
            )
        )
    return result


def available(db, task):
    # Unlinked rework can be attached only through the actual batch ancestry.
    successor = aliased(Route)
    rows = db.scalars(
        select(Route)
        .options(defer(Route.source_file), defer(Route.source_data))
        .where(
            Route.route_kind == "rework",
            Route.original_schedule_id.is_(None),
            Route.rework_source_transfer_id.in_(
                select(Lot.id).where(Lot.serial_no == task.serial_no)
            ),
            ~select(successor.id).where(successor.parent_id == Route.id).exists(),
        )
        .order_by(Route.id.desc())
        .limit(100)
    )
    result = []
    for route in rows:
        plans = [p for p in candidates(db, route) if p.task_id == task.id]
        if plans:
            lot = db.get(Lot, route.rework_source_transfer_id)
            result.append(
                dict(
                    route_id=route.id,
                    route_version=route.version,
                    problem=route.request_reason,
                    batch_no=lot.batch_no,
                    plans=[
                        dict(
                            id=p.id,
                            team_name=db.get(Team, p.team_id).name,
                            due_at=schedules.iso(p.due_at),
                        )
                        for p in plans
                    ],
                )
            )
    return result


def link(db, task_id, payload, user):
    from .production_schedule_tasks import detail, require_task

    with db.begin():
        db.scalar(select(Team.id).order_by(Team.id).limit(1).with_for_update())
        task = require_task(db, task_id, lock=True)
        from .schedule_permissions import require_unlocked

        require_unlocked(task)
        route = db.scalar(select(Route).where(Route.id == payload.route_id).with_for_update())
        if (
            task.version != payload.expected_version
            or not route
            or route.version != payload.route_version
        ):
            raise HTTPException(409, "排期或返工工艺已变化，请刷新后核对")
        if (
            route.route_kind != "rework"
            or route.original_schedule_id
            or db.scalar(select(Route.id).where(Route.parent_id == route.id).limit(1))
        ):
            raise HTTPException(409, "该返工已关联排期或不是返工工艺")
        plan = next(
            (
                p
                for p in candidates(db, route)
                if p.id == payload.schedule_id and p.task_id == task_id
            ),
            None,
        )
        if not plan:
            raise HTTPException(422, "返工批次不属于所选排期的实际物料")
        route.original_schedule_id = plan.id
        route.version += 1
        task.version += 1
        task.updated_at = utcnow()
        schedules.record_event(db, plan, user, "rework_linked", rework_route_id=route.id)
    return detail(db, task_id)
