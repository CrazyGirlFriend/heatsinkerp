"""Task-level routes; every node remains an independently fulfilled commitment."""

import re
from hashlib import sha256
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import case, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import aliased

from . import production_schedules as schedules
from .auth import actor_name
from .business_people import require_assignable
from .material_stock import fingerprint, literal_query
from .models import (
    BusinessPerson,
    ProductionScheduleOrderFile,
    ProductionScheduleTaskPerson,
    Team,
    utcnow,
)
from .models import ProductionSchedule as Plan
from .models import ProductionScheduleEvent as Event
from .models import ProductionScheduleSource as Source
from .models import ProductionScheduleTask as Task
from .production_schedule_schemas import CustomerBatch, ScheduleCreate
from .schedule_fulfillment import (
    fulfillment_table,
    fulfillment_values,
    order_status,
    target_columns,
)


def request_key(namespace, key):
    return namespace + ":" + sha256(key.encode()).hexdigest()


def require_task(db, task_id, *, lock=False):
    statement = select(Task).where(Task.id == task_id)
    if lock:
        statement = statement.with_for_update().execution_options(populate_existing=True)
    task = db.scalar(statement)
    if task is None:
        raise HTTPException(404, "未找到排期任务")
    return task


def legacy_task(db, payload, request_hash):
    if payload.predecessor_id:
        parent = schedules.require_plan(db, payload.predecessor_id)
        return require_task(db, parent.task_id, lock=True)
    task = Task(
        title=payload.serial_no + " 交货排期",
        serial_no=payload.serial_no,
        idempotency_key=request_key("node", payload.idempotency_key),
        request_hash=request_hash,
    )
    db.add(task)
    db.flush()
    return task


def task_values(db, ids):
    if not ids:
        return {}
    tasks = list(
        db.execute(
            select(Task, BusinessPerson.name)
            .outerjoin(BusinessPerson, BusinessPerson.id == Task.business_person_id)
            .where(Task.id.in_(ids))
        )
    )
    people = {}
    for task_id, person in db.execute(
        select(ProductionScheduleTaskPerson.task_id, BusinessPerson)
        .join(BusinessPerson, BusinessPerson.id == ProductionScheduleTaskPerson.person_id)
        .where(ProductionScheduleTaskPerson.task_id.in_(ids))
        .order_by(BusinessPerson.id)
    ):
        people.setdefault(task_id, []).append({"id": person.id, "name": person.name})
    nodes = list(
        db.execute(select(Plan).where(Plan.task_id.in_(ids)).order_by(Plan.sequence_no, Plan.id))
    )
    from .schedule_routes import route_states

    nodes = [row[0] for row in nodes]
    route_links = route_states(db, nodes)
    from .schedule_reworks import links_for_tasks

    reworks = links_for_tasks(db, ids)
    values = schedules.summaries(db, [row.id for row in nodes])
    locations = schedules.task_locations(db, ids, [row.id for row in nodes])
    other_source, other_plan = aliased(Source), aliased(Plan)
    shared = (
        select(other_source.schedule_id)
        .join(other_plan, other_plan.id == other_source.schedule_id)
        .where(
            other_source.source_transfer_id == Source.source_transfer_id,
            other_plan.task_id != Plan.task_id,
            other_plan.cancelled_at.is_(None),
        )
        .exists()
    )
    shared_tasks = set(
        db.scalars(
            select(Plan.task_id)
            .join(Source, Source.schedule_id == Plan.id)
            .join(schedules.Transfer, schedules.Transfer.id == Source.source_transfer_id)
            .where(
                Plan.task_id.in_(ids),
                Plan.cancelled_at.is_(None),
                or_(
                    shared,
                    Source.quantity < schedules.Transfer.quantity,
                    Source.weight < schedules.Transfer.weight,
                ),
            )
            .distinct()
        )
    )
    shared_tasks.update(
        db.scalars(
            select(Plan.task_id)
            .join(schedules.Transfer, schedules.Transfer.process_route_id == Plan.process_route_id)
            .where(
                Plan.task_id.in_(ids),
                Plan.cancelled_at.is_(None),
                schedules.shared_order_lot(),
            )
            .distinct()
        )
    )
    grouped = {}
    for row in nodes:
        values[row.id]["route_link"] = route_links[row.id]
        grouped.setdefault(row.task_id, []).append(values[row.id])
    result = {}
    fulfillment = fulfillment_values(db, ids)
    for task, person_name in tasks:
        route = grouped.get(task.id, [])
        active = [node for node in route if node["status"] != "cancelled"]
        delivery = fulfillment[task.id]
        fulfillment_status = delivery.pop("fulfillment_status")
        state = "cancelled" if task.cancelled_at or (route and not active) else fulfillment_status
        result[task.id] = {
            "id": task.id,
            "task_no": task.task_no,
            "title": task.title,
            "serial_no": task.serial_no,
            "business_person_id": task.business_person_id,
            "business_person_name": person_name,
            "business_people": people.get(
                task.id,
                (
                    [{"id": task.business_person_id, "name": person_name}]
                    if task.business_person_id
                    else []
                ),
            ),
            "notes": task.notes,
            "delivery_batches": task.delivery_batches or [],
            "locked_at": schedules.iso(task.locked_at),
            "cancelled_at": schedules.iso(task.cancelled_at),
            "version": task.version,
            "created_at": schedules.iso(task.created_at),
            "updated_at": schedules.iso(task.updated_at),
            "final_due_at": schedules.iso(task.final_due_at)
            or ((active or route)[-1]["due_at"] if route else None),
            "status": state,
            **delivery,
            "nodes": route,
            "locations": locations.get(task.id, []),
            "shared_source": task.id in shared_tasks,
            "reworks": reworks.get(task.id, []),
            "route_changed": any(n["route_link"]["state"] == "changed" for n in active),
        }
    return result


def detail(db, task_id):
    require_task(db, task_id)
    result = task_values(db, [task_id])[task_id]
    order = db.get(ProductionScheduleOrderFile, task_id)
    result["order_document"] = order.document if order else None
    return result


def list_tasks(
    db,
    *,
    query=None,
    status=None,
    scope=None,
    serial_nos=None,
    business_person_ids=None,
    sort_by="created_at",
    sort_order="desc",
    page=1,
    page_size=20,
    **filters,
):
    nodes = schedules.filtered_nodes(**filters).where(
        Plan.task_id.in_(select(Task.id).where(Task.cancelled_at.is_(None)))
    )
    if serial_nos:
        nodes = nodes.where(Plan.serial_no.in_(serial_nos))
    if business_person_ids:
        nodes = nodes.where(
            Plan.task_id.in_(
                select(Task.id).where(
                    or_(
                        Task.business_person_id.in_(business_person_ids),
                        Task.id.in_(
                            select(ProductionScheduleTaskPerson.task_id).where(
                                ProductionScheduleTaskPerson.person_id.in_(business_person_ids)
                            )
                        ),
                    )
                )
            )
        )
    if query and query.strip():
        serials = list(dict.fromkeys(filter(None, re.split(r"[\s,，;；、]+", query.strip()))))
        if len(serials) > 100:
            raise HTTPException(422, "一次最多搜索 100 个流水号")
        task_match = literal_query(query, [Task.title, Task.serial_no])
        if serials and serials != [query.strip()]:
            task_match = or_(task_match, Task.serial_no.in_(serials))
        token = query.strip().upper()
        if token.startswith("PQ") and token[2:].isdigit() and len(token) <= 16:
            task_match = or_(task_match, Task.id == int(token[2:]))
        node_matches = schedules.filtered_nodes(query=query)
        nodes = nodes.where(
            or_(Plan.task_id.in_(select(Task.id).where(task_match)), Plan.id.in_(node_matches))
        )
    matched = (
        select(Plan.task_id, func.min(Plan.due_at).label("first_due"))
        .where(Plan.id.in_(nodes))
        .group_by(Plan.task_id)
        .subquery()
    )
    if status or scope:
        candidates = select(Plan.task_id).where(Plan.id.in_(nodes)).distinct()
        matched = task_status_filter(db, candidates, status, scope)
    quantity, final_due, batch_count = target_columns(db)
    fulfillment = fulfillment_table(db)
    sort_column = Task.created_at if sort_by == "created_at" else final_due
    from .table_query import query_statement

    people = (
        select(func.group_concat(BusinessPerson.name))
        .join(
            ProductionScheduleTaskPerson,
            ProductionScheduleTaskPerson.person_id == BusinessPerson.id,
        )
        .where(ProductionScheduleTaskPerson.task_id == Task.id)
        .scalar_subquery()
    )
    columns = {
        **dict(Task.__table__.columns.items()),
        **dict(fulfillment.c.items()),
        "final_due_at": final_due,
        "quantity": quantity,
        "delivery_batches": batch_count,
        "team_planning": case(
            (
                select(Plan.id)
                .where(
                    Plan.task_id == Task.id,
                    Plan.cancelled_at.is_(None),
                    Plan.planning_state != "confirmed",
                )
                .exists(),
                "pending",
            ),
            else_="filled",
        ),
        "business_people": func.coalesce(
            people,
            select(BusinessPerson.name)
            .where(BusinessPerson.id == Task.business_person_id)
            .scalar_subquery(),
        ),
        "locked": case((Task.locked_at.is_not(None), "已锁定"), else_="未锁定"),
    }
    statement = query_statement(
        select(matched.c.task_id)
        .join(Task, Task.id == matched.c.task_id)
        .join(fulfillment, fulfillment.c.task_id == Task.id),
        sort_column.is_(None),
        sort_column.desc() if sort_order == "desc" else sort_column.asc(),
        Task.id.desc() if sort_by == "created_at" and sort_order == "desc" else Task.id.asc(),
        columns=columns,
    )
    total = db.scalar(select(func.count()).select_from(statement.order_by(None).subquery())) or 0
    ids = list(db.scalars(statement.offset((page - 1) * page_size).limit(page_size)))
    values = task_values(db, ids)
    return {
        "items": [values[item] for item in ids],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


def task_status_filter(db, candidates, status, scope=None):
    all_nodes = select(Plan.id).where(Plan.task_id.in_(candidates))
    totals = fulfillment_table(db)
    task_state = order_status(totals)
    statement = select(totals.c.task_id).where(totals.c.task_id.in_(candidates))
    if status:
        statement = statement.where(task_state == status)
    if scope == "completed":
        statement = statement.where(task_state.in_(("completed", "completed_late")))
    if scope == "attention":
        from .inspections import hold_column
        from .production_schedule_queries import progress_table, status_expression

        lots = schedules.execution_lots(all_nodes)
        progress = progress_table(plan_ids=all_nodes, include_warehouse=True)
        late_handoffs = (
            select(Plan.task_id)
            .outerjoin(progress, progress.c.schedule_id == Plan.id)
            .where(
                Plan.id.in_(all_nodes),
                status_expression(progress, utcnow(), include_warehouse=True) == "overdue",
            )
        )
        held = (
            select(Plan.task_id)
            .join(lots, lots.c.schedule_id == Plan.id)
            .join(schedules.Transfer, schedules.Transfer.id == lots.c.lot_id)
            .join(schedules.Balance, schedules.Balance.transfer_id == schedules.Transfer.id)
            .where(
                Plan.cancelled_at.is_(None),
                schedules.stock_availability(),
                schedules.usable_material(),
                hold_column(schedules.Transfer.id).is_not(None),
            )
        )
        statement = statement.where(
            task_state.not_in(("completed", "completed_late", "cancelled", "not_assessed")),
            or_(
                task_state == "overdue",
                totals.c.task_id.in_(late_handoffs),
                totals.c.task_id.in_(held),
            ),
        )
    return statement.subquery()


def create_task(db, payload, user, *, order=None):
    from .dispatch_planning import DispatchTaskCreate, build_task

    pending = isinstance(payload, DispatchTaskCreate)
    if pending and order is None:
        raise HTTPException(422, "请上传订单表")
    key = request_key("task", payload.idempotency_key)
    digest = fingerprint(payload)
    if order:
        filename, content, document = order
        if document["serial_no"] != payload.serial_no:
            raise HTTPException(422, "订单表与排期流水号不一致")
        digest = sha256((digest + filename + sha256(content).hexdigest()).encode()).hexdigest()
    try:
        with db.begin():
            # Match the node editor's lock order, including route/cycle validation.
            db.scalar(select(Team.id).order_by(Team.id).limit(1).with_for_update())
            prior = db.scalar(select(Task).where(Task.idempotency_key == key).with_for_update())
            if prior:
                if prior.request_hash != digest:
                    raise HTTPException(409, "请求编号已用于不同的排期任务")
                task_id = prior.id
            else:
                delivery_batches = None
                if pending:
                    payload, delivery_batches = build_task(db, payload)
                require_assignable(db, payload.business_person_id)
                task = Task(
                    final_due_at=payload.final_due_at or payload.nodes[-1].due_at,
                    delivery_batches=delivery_batches,
                    title=payload.title,
                    serial_no=payload.serial_no,
                    notes=payload.notes,
                    business_person_id=payload.business_person_id,
                    idempotency_key=key,
                    request_hash=digest,
                )
                db.add(task)
                db.flush()
                if order:
                    db.add(
                        ProductionScheduleOrderFile(
                            task_id=task.id, filename=filename, content=content, document=document
                        )
                    )
                from .business_people import assign_task_people

                assign_task_people(
                    db,
                    task,
                    payload.business_person_ids
                    or ([payload.business_person_id] if payload.business_person_id else []),
                )
                predecessor_id = None
                for index, node in enumerate(payload.nodes, 1):
                    # Fields have already been validated; datetimes are normalized UTC.
                    data = ScheduleCreate.model_construct(
                        **node.model_dump(exclude={"sources"}),
                        sources=node.sources,
                        serial_no=payload.serial_no,
                        predecessor_id=predecessor_id,
                        sequence_no=index,
                        idempotency_key="task-node:" + uuid4().hex,
                    )
                    schedules.validate_plan(db, data)
                    plan = Plan(
                        **{field: getattr(data, field) for field in schedules.FIELDS},
                        task_id=task.id,
                        initial_due_at=data.due_at,
                        planning_state="pending" if pending else "confirmed",
                        idempotency_key=data.idempotency_key,
                        request_hash=fingerprint(data),
                    )
                    db.add(plan)
                    db.flush()
                    db.add_all(
                        Source(schedule_id=plan.id, **source.model_dump())
                        for source in node.sources
                    )
                    db.flush()
                    schedules.record_event(db, plan, user, "created")
                    predecessor_id = plan.id
                task_id = task.id
    except IntegrityError:
        db.rollback()
        prior = db.scalar(select(Task).where(Task.idempotency_key == key))
        if prior and prior.request_hash == digest:
            return detail(db, prior.id)
        raise HTTPException(409, "排期任务发生并发修改，请使用同一请求重试") from None
    return detail(db, task_id)


def update_task(db, task_id, payload, user):
    with db.begin():
        db.scalar(select(Team.id).order_by(Team.id).limit(1).with_for_update())
        task = require_task(db, task_id, lock=True)
        from .schedule_permissions import require_unlocked

        require_unlocked(task)
        if task.version != payload.expected_version:
            raise HTTPException(409, "排期任务已被修改，请刷新后重试")
        before = {"task_title": task.title, "task_notes": task.notes, "task_version": task.version}
        if {"business_person_id", "business_person_ids"} & payload.model_fields_set:
            from .business_people import assign_task_people

            before["business_person_ids"] = list(
                db.scalars(
                    select(ProductionScheduleTaskPerson.person_id).where(
                        ProductionScheduleTaskPerson.task_id == task.id
                    )
                )
            )
            ids = (
                payload.business_person_ids
                if "business_person_ids" in payload.model_fields_set
                else ([payload.business_person_id] if payload.business_person_id else [])
            )
            if not ids:
                raise HTTPException(422, "请至少选择一位业务人员")
            assign_task_people(db, task, ids)
        before["final_due_at"] = schedules.iso(task.final_due_at)
        if "final_due_at" in payload.model_fields_set:
            if payload.final_due_at is None:
                raise HTTPException(422, "请选择最终交期")
            task.final_due_at = payload.final_due_at
        if "delivery_batches" in payload.model_fields_set:
            from .dispatch_planning import customer_values, validate_customer_batches

            try:
                if not payload.delivery_batches:
                    raise ValueError("请至少安排一批交货")
                if (
                    "planned_quantity" in payload.model_fields_set
                    and payload.planned_quantity is None
                ):
                    raise ValueError("请填写计划数量")
                expected_quantity = payload.planned_quantity or (
                    sum(b["target_quantity"] for b in task.delivery_batches or []) or None
                )
                validate_customer_batches(
                    payload.delivery_batches, task.final_due_at, expected_quantity
                )
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from None
            before["delivery_batches"] = task.delivery_batches
            task.delivery_batches = customer_values(payload.delivery_batches)
        elif "planned_quantity" in payload.model_fields_set:
            raise HTTPException(422, "修改计划数量时请同时调整分批交货数量")
        elif task.delivery_batches and before["final_due_at"] != schedules.iso(task.final_due_at):
            from .dispatch_planning import validate_customer_batches

            try:
                validate_customer_batches(
                    [CustomerBatch.model_validate(batch) for batch in task.delivery_batches],
                    task.final_due_at,
                )
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from None
        task.title, task.notes = payload.title, payload.notes
        task.version += 1
        task.updated_at = utcnow()
        # The route's first node retains the task metadata audit; no duplicate business journal.
        first = db.scalar(
            select(Plan).where(Plan.task_id == task_id).order_by(Plan.sequence_no, Plan.id).limit(1)
        )
        db.add(
            Event(
                schedule_id=first.id,
                action="task_updated",
                actor=actor_name(user),
                actor_id=user.id,
                before=before,
                after={
                    "final_due_at": schedules.iso(task.final_due_at),
                    "delivery_batches": task.delivery_batches,
                    "task_title": task.title,
                    "task_notes": task.notes,
                    "task_version": task.version,
                    "business_person_id": task.business_person_id,
                    "business_person_ids": list(
                        db.scalars(
                            select(ProductionScheduleTaskPerson.person_id).where(
                                ProductionScheduleTaskPerson.task_id == task.id
                            )
                        )
                    ),
                },
            )
        )
        from .schedule_notices import notify_final_due

        if before["final_due_at"] != schedules.iso(task.final_due_at) or (
            "delivery_batches" in before and before["delivery_batches"] != task.delivery_batches
        ):
            notify_final_due(db, task)
        # Reuse existing team-scoped refresh, without changing node revisions or actual dates.
        for node in db.scalars(select(Plan).where(Plan.task_id == task_id)):
            node.updated_at = task.updated_at
    return detail(db, task_id)
