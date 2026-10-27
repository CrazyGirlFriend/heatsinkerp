"""Administrators arrange routes; teams maintain their own delivery commitments."""

from datetime import datetime, timezone
from typing import Literal

from fastapi import Depends, HTTPException, Query
from sqlalchemy.orm import Session

from . import business_people, schedule_reworks, schedule_routes
from . import production_schedule_tasks as tasks
from . import production_schedules as schedules
from .async_api import AsyncAPIRouter as APIRouter
from .auth import get_current_user, require_admin
from .database import get_db
from .models import User
from .production_schedule_schemas import (
    BusinessPersonWrite,
    ScheduleCancel,
    ScheduleCommitmentUpdate,
    ScheduleCreate,
    ScheduleInventoryQuery,
    ScheduleTaskCreate,
    ScheduleTaskUpdate,
    ScheduleUpdate,
)

router = APIRouter(
    prefix="/api/production-schedules",
    tags=["production schedules"],
    dependencies=[Depends(get_current_user)],
)


def utc_bound(value):
    if value is None:
        return None
    if value.tzinfo is None or value.utcoffset() is None:
        raise HTTPException(422, "筛选时间须包含时区")
    return value.astimezone(timezone.utc).replace(tzinfo=None)


@router.get("")
def list_schedules(
    team_id: int | None = Query(default=None, ge=1),
    task_id: int | None = Query(default=None, ge=1),
    serial_no: str | None = Query(default=None, max_length=80),
    query: str | None = Query(default=None, max_length=160),
    status: Literal[
        "pending", "today", "overdue", "completed", "completed_late", "cancelled", "not_assessed"
    ]
    | None = None,
    due_from: datetime | None = None,
    due_to: datetime | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    return schedules.list_plans(
        db,
        team_id=team_id,
        task_id=task_id,
        serial_no=serial_no,
        query=query,
        status=status,
        due_from=utc_bound(due_from),
        due_to=utc_bound(due_to),
        page=page,
        page_size=page_size,
    )


@router.post("", status_code=201)
def create_schedule(
    payload: ScheduleCreate, user: User = Depends(require_admin), db: Session = Depends(get_db)
):
    return schedules.save_plan(db, payload, user)


@router.get("/source-options")
def source_options(
    team_id: int = Query(ge=1),
    serial_no: str = Query(min_length=1, max_length=80),
    query: str | None = Query(default=None, max_length=160),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    schedule_id: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
):
    return schedules.source_options(
        db, team_id, serial_no.strip(), query, page, page_size, schedule_id
    )


@router.get("/candidates")
def candidates(
    team_id: int = Query(ge=1),
    source_transfer_ids: str = Query(min_length=1, max_length=1200),
    next_team_id: int | None = Query(default=None, ge=1),
    external_destination: str | None = Query(default=None, max_length=240),
    db: Session = Depends(get_db),
):
    try:
        ids = list(dict.fromkeys(int(value) for value in source_transfer_ids.split(",")))
    except ValueError as exc:
        raise HTTPException(422, "来源批次编号无效") from exc
    if len(ids) > 100 or any(value <= 0 for value in ids):
        raise HTTPException(422, "每次最多查询100个有效批次")
    return schedules.candidates(db, team_id, ids, next_team_id, external_destination)


@router.post("/inventory")
def inventory(payload: ScheduleInventoryQuery, db: Session = Depends(get_db)):
    return schedules.inventory_summaries(db, payload)


@router.get("/tasks")
def list_tasks(
    team_id: int | None = Query(default=None, ge=1),
    serial_no: str | None = Query(default=None, max_length=80),
    query: str | None = Query(default=None, max_length=160),
    status: Literal[
        "pending", "today", "overdue", "completed", "completed_late", "cancelled", "not_assessed"
    ]
    | None = None,
    scope: Literal["attention", "completed"] | None = None,
    serial_nos: list[str] | None = Query(default=None, max_length=100),
    business_person_ids: list[int] | None = Query(default=None, max_length=100),
    due_from: datetime | None = None,
    due_to: datetime | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    if serial_nos and any(not value.strip() or len(value) > 80 for value in serial_nos):
        raise HTTPException(422, "请选择有效流水号")
    if business_person_ids and any(value <= 0 for value in business_person_ids):
        raise HTTPException(422, "请选择有效业务人员")
    return tasks.list_tasks(
        db,
        team_id=team_id,
        serial_no=serial_no,
        query=query,
        status=status,
        scope=scope,
        serial_nos=serial_nos,
        business_person_ids=business_person_ids,
        due_from=utc_bound(due_from),
        due_to=utc_bound(due_to),
        page=page,
        page_size=page_size,
    )


@router.get("/business-people")
def list_business_people(
    query: str | None = Query(default=None, max_length=80),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=100),
    db: Session = Depends(get_db),
):
    return business_people.list_people(db, query=query, page=page, page_size=page_size)


@router.post("/business-people", status_code=201)
def create_business_person(
    payload: BusinessPersonWrite, user: User = Depends(require_admin), db: Session = Depends(get_db)
):
    return business_people.save_person(db, payload)


@router.patch("/business-people/{person_id}")
def update_business_person(
    person_id: int,
    payload: BusinessPersonWrite,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return business_people.save_person(db, payload, person_id)


@router.get("/serial-options")
def serial_options(
    query: str | None = Query(default=None, max_length=80),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    from sqlalchemy import func, select

    from .material_stock import literal_query
    from .models import ProductionScheduleTask

    grouped = select(ProductionScheduleTask.serial_no, func.count().label("task_count")).group_by(
        ProductionScheduleTask.serial_no
    )
    if query:
        grouped = grouped.where(literal_query(query, [ProductionScheduleTask.serial_no]))
    total = db.scalar(select(func.count()).select_from(grouped.subquery())) or 0
    rows = db.execute(
        grouped.order_by(ProductionScheduleTask.serial_no)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).mappings()
    return {
        "items": [dict(row) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.post("/tasks", status_code=201)
def create_task(
    payload: ScheduleTaskCreate, user: User = Depends(require_admin), db: Session = Depends(get_db)
):
    return tasks.create_task(db, payload, user)


@router.get("/tasks/{task_id}/rework-options")
def task_rework_options(task_id: int, db: Session = Depends(get_db)):
    return schedule_reworks.available(db, tasks.require_task(db, task_id))


@router.post("/tasks/{task_id}/rework")
def link_task_rework(
    task_id: int,
    payload: schedule_reworks.ReworkLink,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return schedule_reworks.link(db, task_id, payload, user)


@router.get("/tasks/{task_id}/route-options")
def task_route_options(task_id: int, db: Session = Depends(get_db)):
    return schedule_routes.option_documents(db, tasks.require_task(db, task_id))


@router.post("/tasks/{task_id}/route")
def link_task_route(
    task_id: int,
    payload: schedule_routes.RouteLink,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return schedule_routes.link(db, task_id, payload, user)


@router.get("/tasks/{task_id}")
def task_detail(task_id: int, db: Session = Depends(get_db)):
    return tasks.detail(db, task_id)


@router.patch("/tasks/{task_id}")
def update_task(
    task_id: int,
    payload: ScheduleTaskUpdate,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return tasks.update_task(db, task_id, payload, user)


@router.get("/{schedule_id}")
def detail(schedule_id: int, db: Session = Depends(get_db)):
    return schedules.detail(db, schedule_id)


@router.patch("/{schedule_id}")
def update(
    schedule_id: int,
    payload: ScheduleUpdate,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return schedules.save_plan(db, payload, user, schedule_id)


@router.patch("/{schedule_id}/commitment")
def update_commitment(
    schedule_id: int,
    payload: ScheduleCommitmentUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return schedules.update_commitment(db, schedule_id, payload, user)


@router.post("/{schedule_id}/cancel")
def cancel(
    schedule_id: int,
    payload: ScheduleCancel,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return schedules.cancel_plan(db, schedule_id, payload, user)
