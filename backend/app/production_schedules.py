"""Explicit delivery commitments, physical-lot matching and real outbound progress."""

from fastapi import HTTPException
from sqlalchemy import and_, delete, func, or_, select, union
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import aliased, lazyload

from .auth import actor_name
from .models import (
    MaterialStockBalance as Balance,
)
from .models import (
    MaterialTransfer as Transfer,
)
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
    ProductionScheduleEvent as Event,
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

# Preserve public helpers used by batch plans, reports and notifications.
from .production_schedule_queries import (
    EXCLUDED_MATERIAL_TYPES as EXCLUDED_MATERIAL_TYPES,
)
from .production_schedule_queries import (
    LOCAL_ZONE as LOCAL_ZONE,
)
from .production_schedule_queries import (
    execution_availability as execution_availability,
)
from .production_schedule_queries import (
    execution_lots as execution_lots,
)
from .production_schedule_queries import (
    iso as iso,
)
from .production_schedule_queries import (
    linked_batches as linked_batches,
)
from .production_schedule_queries import (
    linked_lots as linked_lots,
)
from .production_schedule_queries import (
    progress_table as progress_table,
)
from .production_schedule_queries import (
    shared_order_lot as shared_order_lot,
)
from .production_schedule_queries import (
    status_expression as status_expression,
)
from .production_schedule_queries import (
    stock_availability as stock_availability,
)
from .production_schedule_queries import (
    task_locations as task_locations,
)
from .production_schedule_queries import (
    usable_material as usable_material,
)
from .team_constants import EXTERNAL_DESTINATIONS, INSPECTION_TEAM_CODE, WAREHOUSE_TEAM_CODE

FIELDS = (
    "process_route_id",
    "process_step_index",
    "serial_no",
    "team_id",
    "next_team_id",
    "external_destination",
    "predecessor_id",
    "sequence_no",
    "due_at",
    "target_quantity",
    "target_weight",
    "completion_basis",
    "notes",
)


def require_plan(db, plan_id, *, lock=False):
    query = select(Plan).where(Plan.id == plan_id)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    plan = db.scalar(query)
    if plan is None:
        raise HTTPException(404, "未找到交货排期")
    return plan


def summaries(db, ids, *, now=None):
    if not ids:
        return {}
    progress = progress_table(plan_ids=ids)
    target = aliased(Team)
    rows = db.execute(
        select(
            Plan,
            Team.name.label("team_name"),
            Team.code.label("team_code"),
            target.name.label("next_team_name"),
            Task.title.label("task_title"),
            Task.locked_at.label("order_locked_at"),
            Task.delivery_batches.label("customer_batches"),
            Task.final_due_at.label("customer_due_at"),
            progress,
            status_expression(progress, now or utcnow()).label("schedule_status"),
        )
        .join(Team, Team.id == Plan.team_id)
        .join(Task, Task.id == Plan.task_id)
        .outerjoin(target, target.id == Plan.next_team_id)
        .outerjoin(progress, progress.c.schedule_id == Plan.id)
        .where(Plan.id.in_(ids))
        .order_by(Plan.due_at, Plan.id)
    ).all()
    sources = {}
    for source, batch_no, material_name in db.execute(
        select(Source, Transfer.batch_no, Transfer.material_name)
        .join(Transfer, Transfer.id == Source.source_transfer_id)
        .where(Source.schedule_id.in_(ids))
        .order_by(Source.source_transfer_id)
    ):
        sources.setdefault(source.schedule_id, []).append(
            {
                "source_transfer_id": source.source_transfer_id,
                "batch_no": batch_no,
                "material_name": material_name,
                "quantity": source.quantity,
                "weight": float(source.weight) if source.weight is not None else None,
            }
        )
    from .models import MaterialQuantityAdjustment as Work

    processed = dict(
        db.execute(
            select(Work.production_schedule_id, func.sum(Work.completed_quantity))
            .join(Plan, Plan.id == Work.production_schedule_id)
            .where(
                Plan.id.in_(ids),
                Work.work_kind == "initial",
                or_(
                    Plan.process_route_id.is_(None),
                    and_(
                        Work.process_route_id == Plan.process_route_id,
                        Work.process_step_index == Plan.process_step_index,
                    ),
                ),
            )
            .group_by(Work.production_schedule_id)
        ).all()
    )
    from . import schedule_batches

    predecessors = schedule_batches.predecessor_plans(db, [row[0] for row in rows])
    batch_plans = schedule_batches.summaries(
        db, [row[0] for row in rows], now=now, predecessors=predecessors
    )
    linked = linked_batches(db, ids)
    availability = execution_availability(db, ids)
    result = {}
    for row in rows:
        plan = row[0]
        values = row._mapping
        sent_q = values["dispatched_quantity"] or 0
        sent_w = values["dispatched_weight"] or 0
        result[plan.id] = {
            "id": plan.id,
            "task_id": plan.task_id,
            "task_no": f"PQ{plan.task_id:08d}",
            "task_title": values["task_title"],
            **{field: getattr(plan, field) for field in FIELDS},
            "due_at": iso(plan.due_at),
            "planned_start_at": iso(schedule_batches.handover_start(plan, predecessors)),
            "team_name": values["team_name"],
            "assessment_enabled": values["team_code"] != WAREHOUSE_TEAM_CODE,
            "initial_due_at": iso(plan.initial_due_at),
            "batches": batch_plans.get(plan.id, []),
            "planning_state": plan.planning_state,
            "pending_batches": plan.pending_batches,
            "order_locked": bool(values["order_locked_at"]),
            "delivery_batches": values["customer_batches"] or [],
            "final_due_at": iso(values["customer_due_at"]),
            "next_team_name": values["next_team_name"],
            "version": plan.version,
            "target_weight": float(plan.target_weight) if plan.target_weight is not None else None,
            "cancelled_at": iso(plan.cancelled_at),
            "created_at": iso(plan.created_at),
            "updated_at": iso(plan.updated_at),
            "completed_at": iso(values["completed_at"]),
            "status": values["schedule_status"],
            "processed_quantity": processed.get(plan.id) or 0,
            "dispatched_quantity": sent_q,
            "dispatched_weight": float(sent_w),
            "received_quantity": values["received_quantity"] or 0,
            "received_weight": float(values["received_weight"] or 0),
            "remaining_quantity": max(plan.target_quantity - sent_q, 0)
            if plan.target_quantity is not None
            else None,
            "remaining_weight": float(max(plan.target_weight - sent_w, 0))
            if plan.target_weight is not None
            else None,
            "sources": sources.get(plan.id, []),
            "linked_batches": linked.get(plan.id, {}).get("items", []),
            "linked_batch_count": linked.get(plan.id, {}).get("total", 0),
        }
        if batch_plans.get(plan.id):
            for field in ("quantity", "weight"):
                if any(b[f"target_{field}"] is not None for b in batch_plans[plan.id]):
                    result[plan.id][f"remaining_{field}"] = sum(
                        max((b[f"target_{field}"] or 0) - b[f"dispatched_{field}"], 0)
                        for b in batch_plans[plan.id]
                    )
        names = {
            item["material_name"] for item in sources.get(plan.id, []) if item["material_name"]
        }
        names.update(
            item["material_name"]
            for item in linked.get(plan.id, {}).get("items", [])
            if item["material_name"]
        )
        result[plan.id]["material_name"] = "、".join(sorted(names)) or None
        stock = availability.get(plan.id, {})
        result[plan.id]["stock"] = {
            field: float(stock.get(field) or 0) if "weight" in field else int(stock.get(field) or 0)
            for field in (
                "on_hand_quantity",
                "on_hand_weight",
                "pending_quantity",
                "pending_weight",
                "batch_count",
                "rework_quantity",
            )
        }
        result[plan.id]["quality_held"] = bool(stock.get("quality_held"))
        result[plan.id]["execution_state"] = (
            "cancelled"
            if plan.cancelled_at
            else "completed"
            if values["completed_at"]
            else "stock_dispatched"
            if values["team_code"] == WAREHOUSE_TEAM_CODE and (sent_q or sent_w)
            else "partial"
            if sent_q or sent_w
            else "ready"
            if stock.get("available")
            else "pending_receipt"
            if stock.get("pending_receipt")
            else "waiting_material"
        )
    return result


def detail(db, plan_id):
    plan = require_plan(db, plan_id)
    result = summaries(db, [plan_id])[plan_id]
    delivery_batches = dict(
        db.execute(
            select(Delivery.transfer_id, Delivery.schedule_batch_id).where(
                Delivery.schedule_id == plan_id
            )
        ).all()
    )
    result["deliveries"] = [
        {
            "id": item.id,
            "schedule_batch_id": delivery_batches.get(item.id),
            "batch_no": item.batch_no,
            "source_transfer_id": item.source_transfer_id,
            "quantity": item.quantity,
            "weight": float(item.weight),
            "status": item.status,
            "counts_toward_delivery": result["assessment_enabled"]
            and valid_delivery(plan, item, assessed=True),
            "transferred_at": iso(
                item.created_at if item.entry_kind == "transfer" else item.dispatched_at
            ),
            "received_at": iso(item.received_at),
        }
        for item in db.scalars(
            select(Transfer)
            .options(lazyload("*"))
            .join(Delivery, Delivery.transfer_id == Transfer.id)
            .where(Delivery.schedule_id == plan_id)
            .order_by(Transfer.created_at, Transfer.id)
        )
    ]
    result["history"] = [
        {
            "id": item.id,
            "action": item.action,
            "actor": item.actor,
            "occurred_at": iso(item.occurred_at),
            "before": item.before,
            "after": item.after,
        }
        for item in db.scalars(
            select(Event).where(Event.schedule_id == plan_id).order_by(Event.id.desc())
        )
    ]
    return result


def list_plans(
    db,
    *,
    team_id=None,
    task_id=None,
    serial_no=None,
    query=None,
    status=None,
    due_from=None,
    due_to=None,
    page=1,
    page_size=20,
):
    statement = filtered_nodes(
        team_id=team_id,
        task_id=task_id,
        serial_no=serial_no,
        query=query,
        status=status,
        due_from=due_from,
        due_to=due_to,
    )
    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    ids = list(
        db.scalars(
            statement.order_by(Plan.due_at, Plan.id).offset((page - 1) * page_size).limit(page_size)
        )
    )
    values = summaries(db, ids)
    return {
        "items": [values[value] for value in ids],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


def filtered_nodes(
    *,
    team_id=None,
    task_id=None,
    serial_no=None,
    query=None,
    status=None,
    due_from=None,
    due_to=None,
):
    statement = select(Plan.id)
    if team_id is not None:
        statement = statement.where(Plan.team_id == team_id)
    if task_id is not None:
        statement = statement.where(Plan.task_id == task_id)
    if serial_no is not None:
        statement = statement.where(Plan.serial_no == serial_no.strip())
    if query and query.strip():
        from .material_stock import literal_query

        source_matches = (
            select(Source.schedule_id)
            .join(Transfer, Transfer.id == Source.source_transfer_id)
            .where(literal_query(query, [Transfer.batch_no, Transfer.material_name]))
        )
        delivery_matches = (
            select(Delivery.schedule_id)
            .join(Transfer, Transfer.id == Delivery.transfer_id)
            .where(literal_query(query, [Transfer.batch_no, Transfer.material_name]))
        )
        statement = statement.where(
            or_(
                literal_query(query, [Plan.serial_no, Plan.notes]),
                Plan.id.in_(source_matches),
                Plan.id.in_(delivery_matches),
            )
        )
    if due_from and due_to and due_from > due_to:
        raise HTTPException(422, "开始时间不能晚于结束时间")
    if due_from or due_to:
        has_batches = select(Batch.id).where(Batch.schedule_id == Plan.id).exists()
        batch_due = select(Batch.id).where(Batch.schedule_id == Plan.id)
        legacy_due = []
        if due_from:
            batch_due = batch_due.where(Batch.due_at >= due_from)
            legacy_due.append(Plan.due_at >= due_from)
        if due_to:
            batch_due = batch_due.where(Batch.due_at <= due_to)
            legacy_due.append(Plan.due_at <= due_to)
        statement = statement.where(or_(batch_due.exists(), and_(~has_batches, *legacy_due)))
    if status:
        progress = progress_table(plan_ids=statement)
        statement = statement.outerjoin(progress, progress.c.schedule_id == Plan.id).where(
            status_expression(progress, utcnow()) == status
        )
    return statement


def snapshot(db, plan):
    from .schedule_batches import snapshots

    value = {field: getattr(plan, field) for field in FIELDS}
    value.update(
        due_at=iso(plan.due_at),
        initial_due_at=iso(plan.initial_due_at),
        version=plan.version,
        cancelled_at=iso(plan.cancelled_at),
        task_id=plan.task_id,
        batches=snapshots(db, plan.id),
        planning_state=plan.planning_state,
        pending_batches=plan.pending_batches,
    )
    value["target_weight"] = str(plan.target_weight) if plan.target_weight is not None else None
    value["sources"] = [
        {
            "source_transfer_id": source.source_transfer_id,
            "batch_no": batch_no,
            "quantity": source.quantity,
            "weight": str(source.weight) if source.weight is not None else None,
        }
        for source, batch_no in db.execute(
            select(Source, Transfer.batch_no)
            .join(Transfer, Transfer.id == Source.source_transfer_id)
            .where(Source.schedule_id == plan.id)
            .order_by(Source.source_transfer_id)
        )
    ]
    return value


def record_event(db, plan, user, action, before=None, **extra):
    from .schedule_notices import notify_change

    after = {**snapshot(db, plan), **extra}
    db.add(
        Event(
            schedule_id=plan.id,
            action=action,
            actor=actor_name(user),
            actor_id=user.id,
            before=before,
            after=after,
        )
    )
    notify_change(db, plan, action, before, after)


def validate_plan(db, payload, plan=None):
    from .process_routes import validate_schedule

    validate_schedule(db, payload, plan)
    if plan and payload.serial_no != db.get(Task, plan.task_id).serial_no:
        raise HTTPException(409, "流水号属于主任务，不能在节点中更换")
    if plan and plan.predecessor_id and payload.predecessor_id is None:
        raise HTTPException(409, "不能移除任务中已有节点的前序关联")
    team = db.get(Team, payload.team_id)
    if team is None or not team.active or team.kind in ("engineering", "dispatch", "business"):
        raise HTTPException(422, "请选择启用的交货班组")
    if payload.next_team_id:
        target = db.get(Team, payload.next_team_id)
        if (
            target is None
            or not target.active
            or target.kind in ("engineering", "dispatch", "business")
        ):
            raise HTTPException(422, "请选择启用的接收班组")
    elif payload.external_destination not in EXTERNAL_DESTINATIONS or team.code not in (
        WAREHOUSE_TEAM_CODE,
        INSPECTION_TEAM_CODE,
    ):
        raise HTTPException(422, "仅库房和检验可安排对外去向，请选择有效去向")
    if payload.predecessor_id:
        predecessor = require_plan(db, payload.predecessor_id)
        if (
            predecessor.cancelled_at is not None
            or predecessor.serial_no != payload.serial_no
            or predecessor.next_team_id != payload.team_id
        ):
            raise HTTPException(422, "上序排期须为同流水号，且交货至当前班组")
        if plan and predecessor.task_id != plan.task_id:
            raise HTTPException(409, "前序节点必须属于同一个排期任务")
        seen = {plan.id} if plan else set()
        current = predecessor
        while current:
            if current.id in seen:
                raise HTTPException(422, "排期前后序不能形成循环")
            seen.add(current.id)
            current = db.get(Plan, current.predecessor_id) if current.predecessor_id else None
    for source in payload.sources:
        lot = db.scalar(
            select(Transfer).options(lazyload("*")).where(Transfer.id == source.source_transfer_id)
        )
        if (
            lot is None
            or lot.next_team_id != payload.team_id
            or lot.serial_no != payload.serial_no
            or lot.status != "received"
            or not lot.stock_tracked
            or lot.shared_unallocated
        ):
            raise HTTPException(422, "关联批次须是本班组已接收、已明确流水号的实际物料")
        if lot.material_type in EXCLUDED_MATERIAL_TYPES:
            raise HTTPException(422, "废料、废渣、废屑、废泥不纳入交货排期")


def update_commitment(db, plan_id, payload, user):
    raise HTTPException(422, "请通过分批排期提交交期，由调度确认")


def save_plan(db, payload, user, plan_id=None):
    from .material_stock import fingerprint

    request_hash = fingerprint(payload)
    if plan_id is None:
        if not payload.idempotency_key or not payload.idempotency_key.strip():
            raise HTTPException(422, "创建排期须提供请求编号")
        with db.begin():
            prior = db.scalar(select(Plan).where(Plan.idempotency_key == payload.idempotency_key))
            if prior:
                if prior.request_hash != request_hash:
                    raise HTTPException(409, "请求编号已用于不同的排期内容")
                return detail(db, prior.id)
    try:
        return _save_plan(db, payload, user, plan_id, request_hash)
    except IntegrityError:
        db.rollback()
        prior = db.scalar(select(Plan).where(Plan.idempotency_key == payload.idempotency_key))
        if prior and prior.request_hash == request_hash:
            return detail(db, prior.id)
        raise HTTPException(409, "排期发生并发修改，请刷新后使用同一请求重试") from None


def _save_plan(db, payload, user, plan_id, request_hash):
    with db.begin():
        # This also serializes predecessor edits/cycle checks for concurrent administrators.
        db.scalar(select(Team.id).order_by(Team.id).limit(1).with_for_update())
        plan = require_plan(db, plan_id, lock=True) if plan_id else None
        before = snapshot(db, plan) if plan else None
        if plan:
            if "completion_basis" not in payload.model_fields_set:
                payload.completion_basis = plan.completion_basis
            if (
                payload.completion_basis in ("quantity", "both") and payload.target_quantity is None
            ) or (payload.completion_basis in ("weight", "both") and payload.target_weight is None):
                raise HTTPException(422, "完成口径对应的计划数量不能为空")
            from .models import ProductionScheduleBatch

            if db.scalar(
                select(ProductionScheduleBatch.id)
                .where(ProductionScheduleBatch.schedule_id == plan.id)
                .limit(1)
            ) and any(
                getattr(plan, field) != getattr(payload, field)
                for field in (
                    "due_at",
                    "target_quantity",
                    "target_weight",
                    "completion_basis",
                    "team_id",
                    "predecessor_id",
                )
            ):
                raise HTTPException(409, "本排期已分批，请在分批排期中调整时间和数量")
            if plan.version != payload.expected_version:
                raise HTTPException(409, "排期已被修改，请刷新后重试")
            if plan.cancelled_at is not None:
                raise HTTPException(409, "已取消排期不能修改")
            has_deliveries = db.scalar(
                select(Delivery.transfer_id).where(Delivery.schedule_id == plan.id).limit(1)
            )
            immutable = (
                "serial_no",
                "team_id",
                "next_team_id",
                "external_destination",
                "predecessor_id",
                "sequence_no",
            )
            if has_deliveries and any(
                getattr(plan, field) != getattr(payload, field) for field in immutable
            ):
                raise HTTPException(409, "已有实际交货，不能更换流水号、班组、去向或工序归属")
            if any(
                getattr(plan, field) != getattr(payload, field)
                for field in ("serial_no", "next_team_id")
            ):
                if db.scalar(select(Plan.id).where(Plan.predecessor_id == plan.id).limit(1)):
                    raise HTTPException(409, "已有下序排期，请先调整下序关联")
        validate_plan(db, payload, plan)
        values = {field: getattr(payload, field) for field in FIELDS}
        if plan is None:
            from .production_schedule_tasks import legacy_task

            task = legacy_task(db, payload, request_hash)
            from .schedule_permissions import require_unlocked

            require_unlocked(task)
            if payload.predecessor_id and payload.sequence_no == 1:
                values["sequence_no"] = require_plan(db, payload.predecessor_id).sequence_no + 1
            plan = Plan(
                **values,
                task_id=task.id,
                initial_due_at=payload.due_at,
                idempotency_key=payload.idempotency_key,
                request_hash=request_hash,
            )
            db.add(plan)
        else:
            task = db.scalar(
                select(Task)
                .where(Task.id == plan.task_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            from .schedule_permissions import require_unlocked

            require_unlocked(task)
            for field, value in values.items():
                setattr(plan, field, value)
            plan.version += 1
            plan.updated_at = utcnow()
            db.execute(delete(Source).where(Source.schedule_id == plan.id))
        if plan_id or payload.predecessor_id:
            task.version += 1
            task.updated_at = utcnow()
        db.flush()
        db.add_all(Source(schedule_id=plan.id, **source.model_dump()) for source in payload.sources)
        db.flush()
        record_event(db, plan, user, "updated" if before else "created", before)
        plan_id = plan.id
    return detail(db, plan_id)


def cancel_plan(db, plan_id, payload, user):
    with db.begin():
        # Keep the same route/task/node lock order as administrative edits.
        db.scalar(select(Team.id).order_by(Team.id).limit(1).with_for_update())
        plan = require_plan(db, plan_id, lock=True)
        if plan.version != payload.expected_version:
            raise HTTPException(409, "排期已被修改，请刷新后重试")
        if plan.cancelled_at:
            raise HTTPException(409, "排期已取消")
        before = snapshot(db, plan)
        plan.cancelled_at = plan.updated_at = utcnow()
        plan.version += 1
        task = db.scalar(
            select(Task)
            .where(Task.id == plan.task_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        from .schedule_permissions import require_unlocked

        require_unlocked(task)
        task.version += 1
        task.updated_at = utcnow()
        record_event(db, plan, user, "cancelled", before, reason=payload.reason.strip())
    return detail(db, plan_id)


def local_ancestors(lot_ids, team_id):
    """Stop at team receipts, serial reassignment and shared-material allocation."""
    tree = (
        select(
            Transfer.id.label("lot_id"),
            Transfer.id.label("ancestor_id"),
            Transfer.source_transfer_id,
            Transfer.serial_no,
            Transfer.entry_kind,
            Transfer.source_team_id,
            Transfer.next_team_id,
        )
        .where(Transfer.id.in_(lot_ids), Transfer.next_team_id == team_id)
        .cte("schedule_local_ancestors", recursive=True)
    )
    return tree.union(
        select(
            tree.c.lot_id,
            Transfer.id,
            Transfer.source_transfer_id,
            Transfer.serial_no,
            Transfer.entry_kind,
            Transfer.source_team_id,
            Transfer.next_team_id,
        )
        .join(tree, Transfer.id == tree.c.source_transfer_id)
        .where(
            tree.c.entry_kind.in_(("processing_output", "serial_reallocation")),
            tree.c.source_team_id == team_id,
            Transfer.next_team_id == team_id,
            Transfer.serial_no == tree.c.serial_no,
        )
    )


def matching_statement(
    team_id,
    lot_ids,
    *,
    next_team_id=None,
    external_destination=None,
    match_destination=False,
    include_completed=False,
):
    tree = local_ancestors(lot_ids, team_id)
    direct = select(tree.c.lot_id, Source.schedule_id).join(
        Source, Source.source_transfer_id == tree.c.ancestor_id
    )
    inherited = (
        select(tree.c.lot_id, Plan.id.label("schedule_id"))
        .join(Delivery, Delivery.transfer_id == tree.c.ancestor_id)
        .join(Plan, Plan.predecessor_id == Delivery.schedule_id)
    )
    matches = union(direct, inherited).subquery("schedule_matches")
    statement = (
        select(matches.c.lot_id, Plan.id)
        .join(Plan, Plan.id == matches.c.schedule_id)
        .join(Transfer, Transfer.id == matches.c.lot_id)
        .where(
            Plan.team_id == team_id,
            Plan.serial_no == Transfer.serial_no,
            Plan.cancelled_at.is_(None),
            Transfer.shared_unallocated.is_(False),
            or_(
                Transfer.material_type.is_(None),
                Transfer.material_type.not_in(EXCLUDED_MATERIAL_TYPES),
            ),
        )
    )
    if not include_completed:
        progress = progress_table(plan_ids=select(matches.c.schedule_id))
        statement = statement.outerjoin(progress, progress.c.schedule_id == Plan.id).where(
            progress.c.completed_at.is_(None)
        )
    if match_destination:
        statement = statement.where(
            Plan.next_team_id.is_not_distinct_from(next_team_id),
            Plan.external_destination.is_not_distinct_from(external_destination),
        )
    return statement.distinct()


def matching_pairs(db, team_id, lot_ids, **options):
    if not lot_ids:
        return []
    return list(db.execute(matching_statement(team_id, lot_ids, **options)))


def candidates(db, team_id, lot_ids, next_team_id=None, external_destination=None):
    pairs = matching_pairs(
        db,
        team_id,
        lot_ids,
        next_team_id=next_team_id,
        external_destination=external_destination,
        match_destination=True,
    )
    # Processing has already chosen the commitment. Offer that one on dispatch,
    # including over-delivery of an already completed commitment, never another batch.
    lots = list(
        db.scalars(
            select(Transfer)
            .options(lazyload("*"))
            .where(Transfer.id.in_(lot_ids), Transfer.next_team_id == team_id)
        )
    )
    for lot in lots:
        bound = db.get(Plan, lot.processing_schedule_id) if lot.processing_schedule_id else None
        if bound and bound.process_route_id == lot.process_route_id and bound.team_id == team_id:
            pairs = [(source, plan_id) for source, plan_id in pairs if source != lot.id]
            if (
                bound.cancelled_at is None
                and bound.next_team_id == next_team_id
                and bound.external_destination == external_destination
                and (
                    bound.process_step_index is None
                    or bound.process_step_index == lot.process_step_index
                )
            ):
                pairs.append((lot.id, bound.id))
    values = summaries(db, {plan_id for _, plan_id in pairs})
    return {
        "items": [
            {
                "source_transfer_id": lot_id,
                "schedules": [values[plan_id] for source, plan_id in pairs if source == lot_id],
            }
            for lot_id in dict.fromkeys(lot_ids)
        ]
    }


def valid_delivery(plan, delivered, *, assessed):
    return (
        (
            plan.process_route_id is None
            or (
                plan.process_route_id == delivered.process_route_id
                and plan.process_step_index == delivered.sent_process_step_index
            )
        )
        and delivered.serial_no == plan.serial_no
        and delivered.source_team_id == plan.team_id
        and delivered.next_team_id == plan.next_team_id
        and delivered.external_destination == plan.external_destination
        and delivered.material_type not in EXCLUDED_MATERIAL_TYPES
        and (not assessed or delivered.sent_processing_status == "complete")
        and (
            (delivered.entry_kind == "transfer" and delivered.status in ("pending", "received"))
            or (
                delivered.entry_kind in ("warehouse_outbound", "inspection_shipment")
                and delivered.status == "dispatched"
                and delivered.dispatched_at is not None
            )
        )
    )


def associate_dispatch(db, team_id, payload, transfers):
    """Runs in the stock transaction, with source locks already acquired."""
    # Current locking reads are required: an earlier stock lookup may have opened
    # a REPEATABLE READ snapshot before an administrator changed the assignments.
    # The indexed team range also prevents a new competing plan appearing midway.
    locked = {
        plan.id: plan
        for plan in db.scalars(
            select(Plan)
            .where(
                Plan.team_id == team_id, Plan.serial_no.in_({item.serial_no for item in transfers})
            )
            .order_by(Plan.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    }
    if not locked:
        if any(
            line.production_schedule_id or line.production_schedule_batch_id
            for line in payload.lines
        ):
            raise HTTPException(422, "所选排期不属于本批物料或班组")
        return
    tree = local_ancestors([item.source_transfer_id for item in transfers], team_id)
    ancestry = {}
    for lot_id, ancestor_id in db.execute(select(tree.c.lot_id, tree.c.ancestor_id)):
        ancestry.setdefault(lot_id, set()).add(ancestor_id)
    bindings = {}
    for binding in db.scalars(
        select(Source)
        .where(Source.schedule_id.in_(locked))
        .with_for_update()
        .execution_options(populate_existing=True)
    ):
        bindings.setdefault(binding.schedule_id, set()).add(binding.source_transfer_id)
    predecessors = {plan.predecessor_id for plan in locked.values() if plan.predecessor_id}
    inherited = {}
    for link in db.scalars(
        select(Delivery).where(Delivery.schedule_id.in_(predecessors)).with_for_update()
    ):
        inherited.setdefault(link.schedule_id, set()).add(link.transfer_id)
    planned_batches = {}
    for batch in db.scalars(
        select(Batch)
        .where(Batch.schedule_id.in_(locked))
        .with_for_update()
        .execution_options(populate_existing=True)
    ):
        planned_batches.setdefault(batch.schedule_id, []).append(batch)
    totals, batch_totals = {}, {}
    assessed = db.get(Team, team_id).code != WAREHOUSE_TEAM_CODE
    for plan_id, batch_id, delivered in db.execute(
        select(Delivery.schedule_id, Delivery.schedule_batch_id, Transfer)
        .join(Transfer, Transfer.id == Delivery.transfer_id)
        .options(lazyload("*"))
        .where(Delivery.schedule_id.in_(locked))
        .with_for_update()
        .execution_options(populate_existing=True)
    ):
        plan = locked[plan_id]
        if valid_delivery(plan, delivered, assessed=assessed):
            quantity, weight = totals.get(plan_id, (0, 0))
            totals[plan_id] = (quantity + delivered.quantity, weight + delivered.weight)
            if batch_id:
                quantity, weight = batch_totals.get(batch_id, (0, 0))
                batch_totals[batch_id] = (quantity + delivered.quantity, weight + delivered.weight)
    for line, transfer in zip(payload.lines, transfers, strict=True):
        source = db.get(Transfer, transfer.source_transfer_id)
        inherited_plan = source.processing_schedule_id if source else None
        bound = locked.get(inherited_plan)
        if inherited_plan and (
            not bound
            or bound.process_route_id != transfer.process_route_id
            or (
                bound.process_step_index is not None
                and bound.process_step_index != transfer.sent_process_step_index
            )
        ):
            inherited_plan = None
        if (
            inherited_plan
            and line.production_schedule_id
            and inherited_plan != line.production_schedule_id
        ):
            raise HTTPException(422, "本批加工已关联交货排期，转出时不能改为其他排期")
        selected_plan = inherited_plan or line.production_schedule_id
        if transfer.material_type in EXCLUDED_MATERIAL_TYPES:
            if line.production_schedule_id or line.production_schedule_batch_id:
                raise HTTPException(422, "废料不能抵扣正常交货排期")
            continue
        choices = set()
        for plan_id, plan in locked.items():
            quantity, weight = totals.get(plan_id, (0, 0))
            complete = (
                assessed
                and (plan.completion_basis == "weight" or quantity >= plan.target_quantity)
                and (plan.completion_basis == "quantity" or weight >= plan.target_weight)
            )
            if planned_batches.get(plan_id):
                complete = assessed and all(
                    (
                        plan.completion_basis == "weight"
                        or batch_totals.get(b.id, (0, 0))[0] >= b.target_quantity
                    )
                    and (
                        plan.completion_basis == "quantity"
                        or batch_totals.get(b.id, (0, 0))[1] >= b.target_weight
                    )
                    for b in planned_batches[plan_id]
                )
            roots = bindings.get(plan_id, set()) | inherited.get(plan.predecessor_id, set())
            if (
                plan.cancelled_at is None
                and (
                    plan.process_route_id is None
                    or (
                        plan.process_route_id == transfer.process_route_id
                        and plan.process_step_index == transfer.sent_process_step_index
                    )
                )
                and (not complete or plan_id == inherited_plan)
                and plan.serial_no == transfer.serial_no
                and not transfer.shared_unallocated
                and plan.next_team_id == payload.next_team_id
                and plan.external_destination == payload.external_destination
                and (
                    plan.process_route_id is not None
                    or roots.intersection(ancestry.get(transfer.source_transfer_id, set()))
                )
            ):
                choices.add(plan_id)
        if selected_plan:
            if selected_plan not in choices:
                raise HTTPException(422, "所选排期不属于本批物料、班组或交货去向，请刷新排期")
            selected = selected_plan
        elif len(choices) > 1:
            raise HTTPException(
                422, "本批物料有多项交货排期，请明确本次对应的排期；分属不同排期请拆分明细"
            )
        else:
            selected = next(iter(choices), None)
        if selected:
            from .schedule_batches import select_dispatch_batch

            batch_id = select_dispatch_batch(
                planned_batches.get(selected, []), line.production_schedule_batch_id
            )
            db.add(
                Delivery(schedule_id=selected, transfer_id=transfer.id, schedule_batch_id=batch_id)
            )
        elif line.production_schedule_batch_id:
            raise HTTPException(422, "所选交货批次没有对应的排期")


def source_options(db, team_id, serial_no, query=None, page=1, page_size=20, schedule_id=None):
    from .inspections import hold_column

    conditions = [
        Transfer.next_team_id == team_id,
        Transfer.serial_no == serial_no,
        Transfer.status == "received",
        Transfer.stock_tracked.is_(True),
        Transfer.shared_unallocated.is_(False),
        or_(
            Transfer.material_type.is_(None), Transfer.material_type.not_in(EXCLUDED_MATERIAL_TYPES)
        ),
        or_(Balance.on_hand_quantity > 0, Balance.on_hand_weight > 0),
    ]
    if query:
        from .material_stock import literal_query

        conditions.append(literal_query(query, [Transfer.batch_no, Transfer.material_name]))
    if schedule_id is not None:
        plan = require_plan(db, schedule_id)
        if plan.team_id != team_id or plan.serial_no != serial_no:
            raise HTTPException(422, "排期与班组或流水号不一致")
        candidate_ids = (
            select(Transfer.id).join(Balance, Balance.transfer_id == Transfer.id).where(*conditions)
        )
        pairs = matching_statement(team_id, candidate_ids).subquery()
        conditions.append(Transfer.id.in_(select(pairs.c.lot_id).where(pairs.c.id == schedule_id)))
        conditions.append(hold_column(Transfer.id).is_(None))
    query_base = (
        select(Transfer.id).join(Balance, Balance.transfer_id == Transfer.id).where(*conditions)
    )
    total = db.scalar(select(func.count()).select_from(query_base.subquery())) or 0
    rows = db.execute(
        select(Transfer, Balance)
        .join(Balance, Balance.transfer_id == Transfer.id)
        .options(lazyload("*"))
        .where(*conditions)
        .order_by(Transfer.received_at.desc(), Transfer.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return {
        "items": [
            {
                "source_transfer_id": lot.id,
                "batch_no": lot.batch_no,
                "serial_no": lot.serial_no,
                "material_name": lot.material_name,
                "material_type": lot.material_type,
                "quantity": lot.quantity,
                "weight": float(lot.weight),
                "on_hand_quantity": balance.on_hand_quantity,
                "on_hand_weight": float(balance.on_hand_weight),
                "received_at": iso(lot.received_at),
            }
            for lot, balance in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


def inventory_summaries(db, payload):
    from .warehouse_inventory import origin_columns

    group_plans = {}
    source_plans = {}
    types = dict(
        db.execute(
            select(Transfer.id, Transfer.material_type).where(
                Transfer.id.in_(payload.group_ids + payload.source_transfer_ids),
                Transfer.next_team_id == payload.team_id,
            )
        ).all()
    )
    if payload.group_ids:
        origins = origin_columns()
        scope = (
            select(Transfer.id, *(column.label(name) for name, column in origins.items()))
            .where(
                Transfer.next_team_id == payload.team_id,
                Transfer.status == "received",
                Transfer.stock_tracked.is_(True),
            )
            .subquery("schedule_inventory_groups")
        )
        anchors = (
            select(scope)
            .where(scope.c.id.in_(payload.group_ids))
            .subquery("schedule_inventory_anchors")
        )
        grouped_lots = (
            select(anchors.c.id.label("group_id"), scope.c.id.label("lot_id"))
            .select_from(anchors)
            .join(
                scope,
                and_(*(scope.c[name].is_not_distinct_from(anchors.c[name]) for name in origins)),
            )
            .subquery("schedule_group_lots")
        )
        matches = matching_statement(
            payload.team_id, select(grouped_lots.c.lot_id), include_completed=True
        ).subquery("schedule_group_matches")
        for group_id, plan_id in db.execute(
            select(grouped_lots.c.group_id, matches.c.id)
            .join(matches, matches.c.lot_id == grouped_lots.c.lot_id)
            .distinct()
        ):
            group_plans.setdefault(group_id, set()).add(plan_id)
    for lot_id, plan_id in matching_pairs(
        db, payload.team_id, payload.source_transfer_ids, include_completed=True
    ):
        source_plans.setdefault(lot_id, set()).add(plan_id)
    plan_ids = set().union(*group_plans.values(), *source_plans.values())
    values = summaries(db, plan_ids)

    def summarize(plan_ids, material_type):
        relevant = sorted(
            plan_ids,
            key=lambda plan_id: (
                values[plan_id]["status"] in ("completed", "completed_late"),
                values[plan_id]["due_at"],
                plan_id,
            ),
        )
        items = [values[plan_id] for plan_id in relevant]
        applicable = material_type not in EXCLUDED_MATERIAL_TYPES
        overdue = sum(item["status"] == "overdue" for item in items)
        state = (
            "overdue"
            if overdue
            else "today"
            if any(item["status"] == "today" for item in items)
            else "pending"
            if any(item["status"] == "pending" for item in items)
            else "completed_late"
            if any(item["status"] == "completed_late" for item in items)
            else "not_assessed"
            if any(item["status"] == "not_assessed" for item in items)
            else "completed"
            if items
            else "unplanned"
            if applicable
            else "not_applicable"
        )
        return {
            "applicable": applicable,
            "count": len(items),
            "due_at": items[0]["due_at"] if len(items) == 1 else None,
            "status": state,
            "overdue_count": overdue,
            "items": items[:100],
            "items_truncated": len(items) > 100,
        }

    return {
        "groups": [
            {
                "group_id": group_id,
                **summarize(group_plans.get(group_id, set()), types.get(group_id)),
            }
            for group_id in dict.fromkeys(payload.group_ids)
        ],
        "sources": [
            {
                "source_transfer_id": lot_id,
                **summarize(source_plans.get(lot_id, set()), types.get(lot_id)),
            }
            for lot_id in dict.fromkeys(payload.source_transfer_ids)
        ],
    }
