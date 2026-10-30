"""Task-level routes; every node remains an independently fulfilled commitment."""

from hashlib import sha256
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import aliased

from . import production_schedules as schedules
from .auth import actor_name
from .business_people import require_assignable
from .material_stock import fingerprint, literal_query
from .models import BusinessPerson, ProductionScheduleTaskPerson, Team, utcnow
from .models import ProductionSchedule as Plan
from .models import ProductionScheduleEvent as Event
from .models import ProductionScheduleSource as Source
from .models import ProductionScheduleTask as Task
from .production_schedule_schemas import ScheduleCreate


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
                schedules.Transfer.shared_unallocated.is_(True),
            )
            .distinct()
        )
    )
    grouped = {}
    for row in nodes:
        values[row.id]["route_link"] = route_links[row.id]
        grouped.setdefault(row.task_id, []).append(values[row.id])
    result = {}
    now = utcnow()
    for task, person_name in tasks:
        route = grouped.get(task.id, [])
        active = [node for node in route if node["status"] != "cancelled"]
        assessed = [node for node in active if node.get("assessment_enabled", True)]
        unfinished = [
            node for node in assessed if node["status"] not in ("completed", "completed_late")
        ]
        if not active:
            state = "cancelled"
        elif not assessed:
            state = "not_assessed"
        elif not unfinished:
            state = (
                "completed_late"
                if any(node["status"] == "completed_late" for node in active)
                else "completed"
            )
        else:
            state = (
                "overdue"
                if any(node["status"] == "overdue" for node in unfinished)
                else "today"
                if any(node["status"] == "today" for node in unfinished)
                else "pending"
            )
        if task.final_due_at and assessed:
            if unfinished and task.final_due_at < now:
                state = "overdue"
            elif not unfinished and any(
                node["completed_at"] > schedules.iso(task.final_due_at) for node in assessed
            ):
                state = "completed_late"
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
            "nodes": route,
            "locations": locations.get(task.id, []),
            "shared_source": task.id in shared_tasks,
            "reworks": reworks.get(task.id, []),
            "route_changed": any(n["route_link"]["state"] == "changed" for n in active),
        }
    return result


def detail(db, task_id):
    require_task(db, task_id)
    return task_values(db, [task_id])[task_id]


def list_tasks(
    db,
    *,
    query=None,
    status=None,
    scope=None,
    serial_nos=None,
    business_person_ids=None,
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
        task_match = literal_query(query, [Task.title, Task.serial_no])
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
        matched = task_status_filter(candidates, status, scope)
    total = db.scalar(select(func.count()).select_from(matched)) or 0
    ids = list(
        db.scalars(
            select(matched.c.task_id)
            .order_by(matched.c.first_due, matched.c.task_id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )
    values = task_values(db, ids)
    return {
        "items": [values[item] for item in ids],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


def task_status_filter(candidates, status, scope=None):
    all_nodes = select(Plan.id).where(Plan.task_id.in_(candidates))
    progress = schedules.progress_table(plan_ids=all_nodes)
    node_state = schedules.status_expression(progress, utcnow())
    assessed = and_(Plan.cancelled_at.is_(None), node_state != "not_assessed")
    totals = (
        select(
            Plan.task_id,
            func.min(Plan.due_at).label("first_due"),
            func.max(Task.final_due_at).label("final_due"),
            func.max(case((assessed, progress.c.completed_at), else_=None)).label("completed_at"),
            func.sum(case((Plan.cancelled_at.is_(None), 1), else_=0)).label("active"),
            func.sum(case((assessed, 1), else_=0)).label("assessed"),
            func.sum(
                case(
                    (and_(assessed, progress.c.completed_at.is_(None)), 1),
                    else_=0,
                )
            ).label("unfinished"),
            *(
                func.max(case((node_state == value, 1), else_=0)).label(value)
                for value in ("overdue", "today", "completed_late")
            ),
        )
        .outerjoin(progress, progress.c.schedule_id == Plan.id)
        .join(Task, Task.id == Plan.task_id)
        .where(Plan.task_id.in_(candidates))
        .group_by(Plan.task_id)
        .subquery()
    )
    task_state = case(
        (totals.c.active == 0, "cancelled"),
        (totals.c.assessed == 0, "not_assessed"),
        (
            and_(
                totals.c.unfinished == 0,
                or_(totals.c.completed_late == 1, totals.c.completed_at > totals.c.final_due),
            ),
            "completed_late",
        ),
        (totals.c.unfinished == 0, "completed"),
        (or_(totals.c.overdue == 1, totals.c.final_due < utcnow()), "overdue"),
        (totals.c.today == 1, "today"),
        else_="pending",
    )
    statement = select(totals.c.task_id, totals.c.first_due)
    if status:
        statement = statement.where(task_state == status)
    if scope == "completed":
        statement = statement.where(task_state.in_(("completed", "completed_late")))
    if scope == "attention":
        from .inspections import hold_column

        lots = schedules.execution_lots(all_nodes)
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
            or_(task_state == "overdue", totals.c.task_id.in_(held)),
        )
    return statement.subquery()


def create_task(db, payload, user):
    from .dispatch_planning import DispatchTaskCreate, build_task

    pending = isinstance(payload, DispatchTaskCreate)
    key = request_key("task", payload.idempotency_key)
    digest = fingerprint(payload)
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
                expected_quantity = (
                    sum(b["target_quantity"] for b in task.delivery_batches or []) or None
                )
                validate_customer_batches(
                    payload.delivery_batches, task.final_due_at, expected_quantity
                )
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from None
            before["delivery_batches"] = task.delivery_batches
            task.delivery_batches = customer_values(payload.delivery_batches)
        elif task.delivery_batches and before["final_due_at"] != schedules.iso(task.final_due_at):
            raise HTTPException(422, "请同时调整最后一批交期")
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
