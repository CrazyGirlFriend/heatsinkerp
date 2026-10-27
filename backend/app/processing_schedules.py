"""Keep a delivery commitment attached to the material actually processed for it."""

from fastapi import HTTPException
from sqlalchemy import select

from .models import ProductionSchedule as Plan
from .models import ProductionScheduleSource as Source
from .process_routes import next_index, processing_context
from .production_schedules import EXCLUDED_MATERIAL_TYPES, matching_pairs, progress_table, summaries


def choices(db, lot, *, lock=False):
    if lot.shared_unallocated or lot.material_type in EXCLUDED_MATERIAL_TYPES:
        return []
    if lot.process_route_id and lot.process_route.route_kind == "rework":
        # Rework belongs to the original commitment but is not additional initial output.
        query = select(Plan).where(Plan.id == lot.process_route.original_schedule_id)
        if lock:
            query = query.with_for_update().execution_options(populate_existing=True)
        plan = db.scalar(query)
        return [plan] if plan and plan.cancelled_at is None else []
    context = processing_context(lot)
    indices = []
    if context:
        if not context.get("available"):
            return []
        index = context["step_index"]
        # A team hands over after its last consecutive operation. Repeated visits
        # to that team later in the route are separate delivery commitments.
        while index is not None and lot.process_route.steps[index]["team_id"] == lot.next_team_id:
            indices.append(index)
            index = next_index(lot.process_route, index, lot.serial_no, lot.shared_unallocated)
    matched = {plan_id for _, plan_id in matching_pairs(db, lot.next_team_id, [lot.id])}
    query = (
        select(Plan)
        .where(
            Plan.team_id == lot.next_team_id,
            Plan.serial_no == lot.serial_no,
            Plan.cancelled_at.is_(None),
        )
        .order_by(Plan.id)
    )
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    plans = db.scalars(query).all()
    progress = progress_table(plan_ids=[p.id for p in plans])
    completed = (
        set(db.scalars(select(progress.c.schedule_id).where(progress.c.completed_at.is_not(None))))
        if plans
        else set()
    )
    plans = [p for p in plans if p.id not in completed or p.id == lot.processing_schedule_id]
    allocated = set(
        db.scalars(select(Source.schedule_id).where(Source.schedule_id.in_([p.id for p in plans])))
    )
    return [
        p
        for p in plans
        if (
            (
                p.process_route_id == lot.process_route_id
                and p.process_step_index in indices
                and (p.id not in allocated or p.id in matched)
            )
            if context
            else p.process_route_id is None and p.id in matched
        )
    ]


def context(db, lot):
    plans = choices(db, lot)
    values = summaries(db, [p.id for p in plans])
    selected = lot.processing_schedule_id if lot.processing_schedule_id in values else None
    if selected is None and len(values) == 1:
        selected = next(iter(values))
    return {
        "processing_schedules": list(values.values()),
        "production_schedule_id": selected,
        "production_schedule_locked": lot.processing_schedule_id in values,
    }


def select_plan(db, lot, payload):
    if payload.processing_status is None:
        if payload.production_schedule_id:
            raise HTTPException(422, "仅加工登记可以关联交货排期")
        return None
    plans = {p.id: p for p in choices(db, lot, lock=True)}
    selected = payload.production_schedule_id
    inherited = lot.processing_schedule_id if lot.processing_schedule_id in plans else None
    if inherited and selected and inherited != selected:
        raise HTTPException(422, "本批已关联交货排期，后续工序须沿用同一排期")
    selected = selected or inherited
    if selected is None and len(plans) == 1:
        selected = next(iter(plans))
    if selected is not None and selected not in plans:
        raise HTTPException(422, "交货排期与本批物料、工艺或当前工序不符")
    if selected is None and len(plans) > 1:
        raise HTTPException(422, "请选择本次加工对应的交货排期")
    return selected


def bind_outputs(lot, items, selected):
    if items:
        for item in items:
            item.processing_schedule_id = (
                selected
                if item.processing_role == "produced"
                else lot.processing_schedule_id
                if item.processing_role == "remaining"
                else None
            )
    elif selected is not None:
        lot.processing_schedule_id = selected
