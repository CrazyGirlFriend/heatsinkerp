"""Dispatch owns orders; teams save their delivery plans directly."""

from datetime import datetime, timezone
from pathlib import PurePath
from typing import Annotated, Literal
from urllib.parse import quote

from fastapi import Depends, File, Form, HTTPException, Query, Response, UploadFile
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from . import (
    business_people,
    dispatch_planning,
    schedule_batches,
    schedule_reworks,
    schedule_routes,
)
from . import production_schedule_tasks as tasks
from . import production_schedules as schedules
from .async_api import AsyncAPIRouter as APIRouter
from .auth import get_current_user, require_admin
from .database import get_db
from .models import ProductionScheduleOrderFile, User
from .order_document_preview import order_document_preview
from .process_route_import import MAX_FILE_BYTES
from .process_route_orders import parse_order
from .process_route_read_schemas import RouteOrderDocumentResponse
from .production_schedule_schemas import (
    BusinessPersonWrite,
    ScheduleCancel,
    ScheduleCommitmentUpdate,
    ScheduleCreate,
    ScheduleInventoryQuery,
    ScheduleTaskUpdate,
    ScheduleUpdate,
)
from .schedule_permissions import require_dispatch
from .schedule_read_schemas import (
    BusinessPersonPageResponse,
    BusinessPersonResponse,
    InventorySchedulesResponse,
    ScheduleCandidatesResponse,
    ScheduleDetailResponse,
    ScheduleOverviewResponse,
    SchedulePageResponse,
    ScheduleReworkOptionResponse,
    ScheduleRouteOptionResponse,
    ScheduleSerialPageResponse,
    ScheduleSerialProgressResponse,
    ScheduleSourcePageResponse,
    ScheduleTaskDetailResponse,
    ScheduleTaskPageResponse,
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


@router.get("/overview", response_model=ScheduleOverviewResponse, response_model_exclude_unset=True)
def get_overview(days: int = Query(7, ge=1, le=365), db: Session = Depends(get_db)):
    from .factory_schedule_overview import overview

    return overview(db, days)


@router.get("", response_model=SchedulePageResponse, response_model_exclude_unset=True)
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
    payload: ScheduleCreate, user: User = Depends(require_dispatch), db: Session = Depends(get_db)
):
    raise HTTPException(422, "请在调度工作台按流水号工艺新建排期")


@router.get(
    "/source-options", response_model=ScheduleSourcePageResponse, response_model_exclude_unset=True
)
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


@router.get(
    "/candidates", response_model=ScheduleCandidatesResponse, response_model_exclude_unset=True
)
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


@router.post(
    "/inventory", response_model=InventorySchedulesResponse, response_model_exclude_unset=True
)
def inventory(payload: ScheduleInventoryQuery, db: Session = Depends(get_db)):
    return schedules.inventory_summaries(db, payload)


@router.get("/tasks", response_model=ScheduleTaskPageResponse, response_model_exclude_unset=True)
def list_tasks(
    team_id: int | None = Query(default=None, ge=1),
    serial_no: str | None = Query(default=None, max_length=80),
    query: str | None = Query(default=None, max_length=4096),
    status: Literal[
        "pending", "today", "overdue", "completed", "completed_late", "cancelled", "not_assessed"
    ]
    | None = None,
    scope: Literal["attention", "completed"] | None = None,
    serial_nos: list[str] | None = Query(default=None, max_length=100),
    business_person_ids: list[int] | None = Query(default=None, max_length=100),
    due_from: datetime | None = None,
    due_to: datetime | None = None,
    sort_by: Literal["final_due_at", "created_at"] = "created_at",
    sort_order: Literal["asc", "desc"] = "desc",
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
        sort_by=sort_by,
        sort_order=sort_order,
        page=page,
        page_size=page_size,
    )


@router.get(
    "/business-people", response_model=BusinessPersonPageResponse, response_model_exclude_unset=True
)
def list_business_people(
    query: str | None = Query(default=None, max_length=80),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=100),
    db: Session = Depends(get_db),
):
    return business_people.list_people(db, query=query, page=page, page_size=page_size)


@router.post(
    "/business-people",
    response_model=BusinessPersonResponse,
    response_model_exclude_unset=True,
    status_code=201,
)
def create_business_person(
    payload: BusinessPersonWrite, user: User = Depends(require_admin), db: Session = Depends(get_db)
):
    return business_people.save_person(db, payload)


@router.patch(
    "/business-people/{person_id}",
    response_model=BusinessPersonResponse,
    response_model_exclude_unset=True,
)
def update_business_person(
    person_id: int,
    payload: BusinessPersonWrite,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return business_people.save_person(db, payload, person_id)


@router.get(
    "/serial-options", response_model=ScheduleSerialPageResponse, response_model_exclude_unset=True
)
def serial_options(
    query: str | None = Query(default=None, max_length=80),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    from .production_schedule_queries import serial_options as query_serials

    return query_serials(db, query, page, page_size)


@router.get(
    "/route-options",
    response_model=list[ScheduleRouteOptionResponse],
    response_model_exclude_unset=True,
)
def new_task_route_options(
    serial_no: str = Query(default="", max_length=80), db: Session = Depends(get_db)
):
    return dispatch_planning.route_options(db, serial_no.strip())


@router.put(
    "/tasks/{task_id}/lock",
    response_model=ScheduleTaskDetailResponse,
    response_model_exclude_unset=True,
)
def lock_task(
    task_id: int,
    payload: dispatch_planning.TaskLock,
    user: User = Depends(require_dispatch),
    db: Session = Depends(get_db),
):
    return dispatch_planning.lock_task(db, task_id, payload, user)


@router.delete("/tasks/{task_id}", status_code=204)
def delete_task(
    task_id: int,
    payload: dispatch_planning.TaskDelete,
    user: User = Depends(require_dispatch),
    db: Session = Depends(get_db),
):
    dispatch_planning.delete_task(db, task_id, payload, user)


@router.post(
    "/tasks",
    response_model=ScheduleTaskDetailResponse,
    response_model_exclude_unset=True,
    status_code=201,
)
async def create_task(
    payload: Annotated[str, Form()],
    file: Annotated[UploadFile | None, File()] = None,
    user: User = Depends(require_dispatch),
    db: AsyncSession = Depends(get_db),
):
    try:
        try:
            data = dispatch_planning.DispatchTaskCreate.model_validate_json(payload)
        except ValidationError as exc:
            raise HTTPException(422, exc.errors()[0]["msg"]) from None
        if file is None:
            raise HTTPException(422, "请上传订单表")
        order = await read_order(file)
        return await db.run_sync(
            lambda session: tasks.create_task(session, data, user, order=order)
        )
    finally:
        if file:
            await file.close()


async def read_order(file):
    filename = PurePath((file.filename or "").replace("\\", "/")).name
    content = await file.read(MAX_FILE_BYTES + 1)
    document = await run_in_threadpool(parse_order, content, filename)
    return filename, content, document


@router.post(
    "/parse-order", response_model=RouteOrderDocumentResponse, response_model_exclude_unset=True
)
async def preview_order(
    file: Annotated[UploadFile, File()], user: User = Depends(require_dispatch)
):
    try:
        return (await read_order(file))[2]
    finally:
        await file.close()


@router.get("/tasks/{task_id}/order", response_class=Response)
async def download_order(task_id: int, preview: bool = False, db: AsyncSession = Depends(get_db)):
    def original(session):
        tasks.require_task(session, task_id)
        order = session.get(ProductionScheduleOrderFile, task_id)
        if order is None:
            raise HTTPException(404, "尚未上传订单表")
        return order.filename, order.content

    filename, content = await db.run_sync(original)
    if preview:
        content = await run_in_threadpool(order_document_preview, content, filename)
        filename = str(PurePath(filename).with_suffix(".pdf"))
    return Response(
        content,
        media_type="application/pdf"
        if preview
        else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": ("inline" if preview else "attachment")
            + "; filename*=UTF-8''"
            + quote(filename),
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )


@router.post("/order-preview", response_class=Response)
async def preview_order_original(
    file: Annotated[UploadFile, File()], user: User = Depends(require_dispatch)
):
    try:
        filename, content, _ = await read_order(file)
        pdf = await run_in_threadpool(order_document_preview, content, filename)
        return Response(
            pdf,
            media_type="application/pdf",
            headers={
                "Content-Disposition": "inline; filename*=UTF-8''"
                + quote(str(PurePath(filename).with_suffix(".pdf"))),
                "X-Content-Type-Options": "nosniff",
                "Cache-Control": "private, no-store",
            },
        )
    finally:
        await file.close()


@router.get(
    "/tasks/{task_id}/rework-options",
    response_model=list[ScheduleReworkOptionResponse],
    response_model_exclude_unset=True,
)
def task_rework_options(task_id: int, db: Session = Depends(get_db)):
    return schedule_reworks.available(db, tasks.require_task(db, task_id))


@router.post(
    "/tasks/{task_id}/rework",
    response_model=ScheduleTaskDetailResponse,
    response_model_exclude_unset=True,
)
def link_task_rework(
    task_id: int,
    payload: schedule_reworks.ReworkLink,
    user: User = Depends(require_dispatch),
    db: Session = Depends(get_db),
):
    return schedule_reworks.link(db, task_id, payload, user)


@router.get(
    "/tasks/{task_id}/route-options",
    response_model=list[ScheduleRouteOptionResponse],
    response_model_exclude_unset=True,
)
def task_route_options(task_id: int, db: Session = Depends(get_db)):
    return schedule_routes.option_documents(db, tasks.require_task(db, task_id))


@router.post(
    "/tasks/{task_id}/route",
    response_model=ScheduleTaskDetailResponse,
    response_model_exclude_unset=True,
)
def link_task_route(
    task_id: int,
    payload: schedule_routes.RouteLink,
    user: User = Depends(require_dispatch),
    db: Session = Depends(get_db),
):
    return schedule_routes.link(db, task_id, payload, user)


@router.get("/tasks/{task_id}/progress", response_model=ScheduleSerialProgressResponse)
def serial_progress(task_id: int, db: Session = Depends(get_db)):
    from .schedule_serial_progress import progress

    return progress(db, task_id)


@router.get(
    "/tasks/{task_id}", response_model=ScheduleTaskDetailResponse, response_model_exclude_unset=True
)
def task_detail(task_id: int, db: Session = Depends(get_db)):
    return tasks.detail(db, task_id)


@router.patch(
    "/tasks/{task_id}", response_model=ScheduleTaskDetailResponse, response_model_exclude_unset=True
)
def update_task(
    task_id: int,
    payload: ScheduleTaskUpdate,
    user: User = Depends(require_dispatch),
    db: Session = Depends(get_db),
):
    return tasks.update_task(db, task_id, payload, user)


@router.get(
    "/{schedule_id}", response_model=ScheduleDetailResponse, response_model_exclude_unset=True
)
def detail(schedule_id: int, db: Session = Depends(get_db)):
    return schedules.detail(db, schedule_id)


@router.patch(
    "/{schedule_id}", response_model=ScheduleDetailResponse, response_model_exclude_unset=True
)
def update(
    schedule_id: int,
    payload: ScheduleUpdate,
    user: User = Depends(require_dispatch),
    db: Session = Depends(get_db),
):
    return schedules.save_plan(db, payload, user, schedule_id)


@router.put(
    "/{schedule_id}/batches",
    response_model=ScheduleDetailResponse,
    response_model_exclude_unset=True,
)
def update_batches(
    schedule_id: int,
    payload: schedule_batches.BatchPlanWrite,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return schedule_batches.save(db, schedule_id, payload, user)


@router.patch(
    "/{schedule_id}/commitment",
    response_model=ScheduleDetailResponse,
    response_model_exclude_unset=True,
)
def update_commitment(
    schedule_id: int,
    payload: ScheduleCommitmentUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return schedules.update_commitment(db, schedule_id, payload, user)


@router.post(
    "/{schedule_id}/cancel",
    response_model=ScheduleDetailResponse,
    response_model_exclude_unset=True,
)
def cancel(
    schedule_id: int,
    payload: ScheduleCancel,
    user: User = Depends(require_dispatch),
    db: Session = Depends(get_db),
):
    return schedules.cancel_plan(db, schedule_id, payload, user)
