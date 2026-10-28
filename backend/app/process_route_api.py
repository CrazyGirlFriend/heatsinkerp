"""Word route review, publication, binding and source-document retrieval."""

import hashlib
from pathlib import PurePath
from typing import Annotated, Literal
from urllib.parse import quote

from fastapi import Depends, File, Form, HTTPException, Path, Query, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session, aliased, defer
from starlette.concurrency import run_in_threadpool

from .async_api import AsyncAPIRouter
from .auth import actor_name, get_current_user
from .database import get_db
from .models import (
    InspectionFeedbackTeam,
    InspectionProblem,
    MaterialStockBalance,
    MaterialTransfer,
    ProcessRoute,
    ProcessRouteArchive,
    ProcessRouteDrawing,
    ProcessRouteOrderFile,
    ProcessRoutePath,
    ProcessRoutePolicy,
    Team,
    TeamProcessingTask,
    TeamPurpose,
    User,
    utcnow,
)
from .process_route_drawings import MAX_DRAWINGS, copy_drawings, drawing_preview, validate_drawing
from .process_route_import import MAX_FILE_BYTES, parse_docx
from .process_route_orders import (
    apply_material_values,
    merge_materials,
    parse_order,
    review_fingerprint,
)
from .process_route_schemas import RouteDraftWrite
from .process_route_serials import reserve_serial
from .process_routes import (
    assert_route_importer,
    assign_engineering_employee,
    is_engineering_user,
    publish_route,
    require_draft_owner,
    require_route,
    require_route_reader,
    route_document,
    route_options,
)
from .rework_routes import ReworkRequest, request_document, request_documents
from .schemas import SCRAP_MATERIAL_TYPES
from .team_constants import WAREHOUSE_TEAM_CODE

router = AsyncAPIRouter(
    prefix="/api/process-routes", tags=["process routes"], dependencies=[Depends(get_current_user)]
)


class BindWrite(BaseModel):
    source_transfer_ids: list[int] = Field(min_length=1, max_length=100)


class RevisionWrite(BaseModel):
    version: int = Field(ge=1)
    confirmed_imports: bool = False


def drawing_document(row):
    return {
        "id": row.id,
        "filename": row.filename,
        "size_bytes": row.size_bytes,
        "sha256": row.sha256,
    }


def execution_labels(row, db):
    if db is None:
        return {"tasks": {}, "purposes": {}}
    return {
        key: dict(
            db.execute(
                select(model.id, model.name).where(
                    model.id.in_([step[field] for step in row.steps if step.get(field)])
                )
            ).all()
        )
        for key, model, field in (
            ("tasks", TeamProcessingTask, "processing_task_id"),
            ("purposes", TeamPurpose, "purpose_id"),
        )
    }


def document(row, *, detail=True, db=None):
    return {
        "id": row.id,
        "title": row.title,
        "route_kind": row.route_kind,
        "rework_request": request_document(db, row) if db is not None else None,
        "filename": row.filename,
        "state": row.state,
        "version": row.version,
        "parent_id": row.parent_id,
        "serial_nos": row.serial_nos,
        "created_by": row.created_by,
        "created_by_user_id": row.created_by_user_id,
        "engineering_employee_id": row.engineering_employee_id,
        "engineering_employee_name": row.engineering_employee_name,
        "modified_employee_id": row.modified_employee_id,
        "modified_employee_name": row.modified_employee_name,
        "created_at": row.created_at.isoformat() + "Z",
        "updated_at": row.updated_at.isoformat() + "Z" if row.updated_at else None,
        "published_at": row.published_at.isoformat() + "Z" if row.published_at else None,
        **(
            {
                "steps": row.steps,
                "source_data": row.source_data,
                "review_note": row.review_note,
                "source_sha256": row.source_sha256,
                "execution_labels": execution_labels(row, db),
                "drawings": [
                    drawing_document(item)
                    for item in db.scalars(
                        select(ProcessRouteDrawing)
                        .where(ProcessRouteDrawing.route_id == row.id)
                        .order_by(ProcessRouteDrawing.id)
                    )
                ]
                if db is not None
                else [],
            }
            if detail
            else {}
        ),
    }


def require_route_importer(user: User = Depends(get_current_user)) -> User:
    return assert_route_importer(user)


@router.post("/drawing-preview")
async def preview_uploaded_drawing(
    file: Annotated[UploadFile, File()],
    _: User = Depends(require_route_importer),
):
    try:
        content = await file.read(MAX_FILE_BYTES + 1)
        await run_in_threadpool(validate_drawing, PurePath(file.filename or "").name, content)
        preview = await run_in_threadpool(drawing_preview, content)
        return Response(
            preview,
            media_type="application/pdf",
            headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"},
        )
    finally:
        await file.close()


@router.post("/import", status_code=201)
async def import_word(
    file: Annotated[UploadFile, File()],
    user: User = Depends(require_route_importer),
    db: AsyncSession = Depends(get_db),
):
    try:
        filename, content, data, serials, steps = await read_word(file)

        def save(session):
            with session.begin():
                map_word_steps(session, steps)
                row = ProcessRoute(
                    title=filename[:-5][:160],
                    filename=filename,
                    source_file=content,
                    source_sha256=hashlib.sha256(content).hexdigest(),
                    source_data=merge_materials({}, word=data, filename=filename),
                    serial_nos=serials,
                    steps=steps,
                    created_by=actor_name(user),
                    created_by_user_id=user.id,
                )
                session.add(row)
                if not session.get(ProcessRoutePolicy, 1):
                    session.add(ProcessRoutePolicy(id=1, enforced_after=utcnow()))
                session.flush()
                reserve_serial(session, row)
                return document(row, db=session)

        return await db.run_sync(save)
    finally:
        await file.close()


@router.get("")
def list_routes(
    kind: Literal["normal", "rework", "all"] = "normal",
    state: Literal["draft", "published"] | None = None,
    query: str = Query(default="", max_length=160),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    sort_order: Literal["asc", "desc"] = "desc",
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from .material_stock import literal_query

    where = (
        [
            or_(
                literal_query(
                    query.strip(),
                    [
                        cast(ProcessRoute.serial_nos, String),
                        ProcessRoute.engineering_employee_name,
                        ProcessRoute.modified_employee_name,
                        ProcessRoute.title,
                        ProcessRoute.request_reason,
                        ProcessRoute.requesting_team_name,
                    ],
                ),
                select(MaterialTransfer.id)
                .where(
                    MaterialTransfer.id == ProcessRoute.rework_source_transfer_id,
                    literal_query(
                        query.strip(), [MaterialTransfer.batch_no, MaterialTransfer.next_team_name]
                    ),
                )
                .exists(),
                select(InspectionProblem.inspection_id)
                .where(
                    InspectionProblem.inspection_id == ProcessRoute.rework_inspection_id,
                    literal_query(query.strip(), [InspectionProblem.name]),
                )
                .exists(),
                select(InspectionFeedbackTeam.inspection_id)
                .join(Team, Team.id == InspectionFeedbackTeam.team_id)
                .where(
                    InspectionFeedbackTeam.inspection_id == ProcessRoute.rework_inspection_id,
                    literal_query(query.strip(), [Team.name]),
                )
                .exists(),
                select(ProcessRoutePath.route_id)
                .join(Team, Team.id == ProcessRoutePath.team_id)
                .where(
                    ProcessRoutePath.route_id == ProcessRoute.id,
                    literal_query(query.strip(), [Team.name]),
                )
                .exists(),
            )
        ]
        if query.strip()
        else []
    )
    if kind != "all":
        where.append(ProcessRoute.route_kind == kind)
    if user.role != "ADMIN" and not is_engineering_user(user):
        where.append(ProcessRoute.state == "published")
    if state:
        where.append(ProcessRoute.state == state)
    successor = aliased(ProcessRoute)
    archived = (
        select(ProcessRouteArchive.route_id)
        .where(ProcessRouteArchive.route_id == ProcessRoute.id)
        .exists()
    )
    superseded = (
        select(successor.id)
        .where(successor.parent_id == ProcessRoute.id, successor.state == "published")
        .exists()
    )
    where.extend(
        [
            ~archived,
            ~((ProcessRoute.parent_id.is_not(None)) & (ProcessRoute.state == "draft")),
            ~superseded,
        ]
    )
    effective_time = func.coalesce(ProcessRoute.updated_at, ProcessRoute.created_at)
    ordering = (
        (effective_time.asc(), ProcessRoute.id.asc())
        if sort_order == "asc"
        else (effective_time.desc(), ProcessRoute.id.desc())
    )
    rows = db.scalars(
        select(ProcessRoute)
        .options(defer(ProcessRoute.steps))
        .where(*where)
        .order_by(*ordering)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    rows = list(rows)
    requests = request_documents(db, rows)
    items = []
    for row in rows:
        item = document(row, detail=False)
        scope = requests.get(row.id)
        if scope:
            item.update(
                rework_request=scope,
                rework_batch_no=scope["batch_no"],
                rework_quantity=scope["quantity"],
                rework_weight=scope["weight"],
            )
        items.append(item)
    policy = db.get(ProcessRoutePolicy, 1)
    return {
        "items": items,
        "total": db.scalar(select(func.count()).select_from(ProcessRoute).where(*where)),
        "page": page,
        "page_size": page_size,
        "enforced_after": policy.enforced_after.isoformat() + "Z" if policy else None,
    }


@router.get("/rework-sources")
def rework_sources(
    query: str = Query("", max_length=120),
    page: int = Query(1, ge=1),
    lot_id: int | None = Query(None, ge=1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from .rework_routes import source_stock

    return source_stock(db, user, query, page, lot_id)


@router.post("/rework-requests", status_code=201)
def request_rework_route(
    payload: ReworkRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from .rework_routes import request_rework

    return request_rework(db, payload, user)


class ResumeWrite(BaseModel):
    expected_revision: int = Field(ge=0)


@router.post("/rework-lots/{lot_id}/resume")
def resume_rework_route(
    lot_id: int,
    payload: ResumeWrite,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from .material_stock import lock_lot
    from .rework_routes import resume

    with db.begin():
        return resume(db, lock_lot(db, lot_id, user.team_id), user, payload.expected_revision)


@router.get("/options/{team_id}")
def execution_options(
    team_id: int = Path(ge=1),
    _: User = Depends(require_route_importer),
    db: Session = Depends(get_db),
):
    return route_options(db, team_id)


@router.get("/lots/{lot_id}")
def lot_route(lot_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    lot = db.get(MaterialTransfer, lot_id)
    if not lot:
        raise HTTPException(404, "库存批次不存在")
    if lot.process_route_id:
        require_route_reader(lot.process_route, user)
    return {
        "current": route_document(lot),
        "route": document(lot.process_route, db=db) if lot.process_route_id else None,
    }


@router.post("", status_code=201)
def create_draft(
    payload: RouteDraftWrite,
    user: User = Depends(require_route_importer),
    db: Session = Depends(get_db),
):
    with db.begin():
        row = ProcessRoute(
            title=payload.title,
            serial_nos=payload.serial_nos,
            steps=[step.model_dump() for step in payload.steps],
            review_note=payload.review_note.strip(),
            filename="",
            source_sha256="",
            source_file=b"",
            source_data={"tables": [], "issues": []},
            created_by=actor_name(user),
            created_by_user_id=user.id,
        )
        assign_engineering_employee(db, row, payload.engineering_employee_id)
        assign_engineering_employee(db, row, payload.engineering_employee_id, modifier=True)
        db.add(row)
        if not db.get(ProcessRoutePolicy, 1):
            db.add(ProcessRoutePolicy(id=1, enforced_after=utcnow()))
        db.flush()
        reserve_serial(db, row)
        return document(row, db=db)


@router.post("/parse")
async def parse_word(
    file: Annotated[UploadFile, File()],
    _: User = Depends(require_route_importer),
    db: AsyncSession = Depends(get_db),
):
    try:
        filename, content, data, serials, steps = await read_word(file)
        await db.run_sync(lambda session: map_word_steps(session, steps))
        return {
            "title": filename[:-5][:160],
            "filename": filename,
            "serial_nos": serials,
            "steps": steps,
            "source_data": merge_materials({}, word=data, filename=filename),
        }
    finally:
        await file.close()


@router.post("/parse-order")
async def parse_order_file(
    file: Annotated[UploadFile, File()],
    _: User = Depends(require_route_importer),
):
    try:
        filename = (file.filename or "").replace("\\", "/").split("/")[-1]
        content = await file.read(MAX_FILE_BYTES + 1)
        return await run_in_threadpool(parse_order, content, filename)
    finally:
        await file.close()


@router.post("/{route_id}/order")
async def attach_order(
    route_id: int,
    file: Annotated[UploadFile, File()],
    version: Annotated[int, Form(ge=1)],
    user: User = Depends(require_route_importer),
    db: AsyncSession = Depends(get_db),
):
    try:
        filename = (file.filename or "").replace("\\", "/").split("/")[-1]
        content = await file.read(MAX_FILE_BYTES + 1)
        order = await run_in_threadpool(parse_order, content, filename)

        def save(session):
            with session.begin():
                row = editable_version(session, route_id, version, user)
                if row.route_kind == "rework" or row.serial_nos != [order["serial_no"]]:
                    raise HTTPException(422, "请选择与正常工艺流水号一致的订单表")
                row.source_data = merge_materials(row.source_data, order=order)
                original = session.get(ProcessRouteOrderFile, row.id)
                if original is None:
                    original = ProcessRouteOrderFile(route_id=row.id)
                    session.add(original)
                original.filename, original.content = filename, content
                row.version += 1
                session.flush()
                return document(row, db=session)

        return await db.run_sync(save)
    finally:
        await file.close()


@router.get("/{route_id}/order")
def download_order(
    route_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    require_route_reader(require_route(db, route_id), user)
    original = db.get(ProcessRouteOrderFile, route_id)
    if original is None:
        raise HTTPException(404, "尚未上传订单表")
    return Response(
        original.content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": "attachment; filename*=UTF-8''" + quote(original.filename),
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )


def map_word_steps(session, steps):
    warehouse = session.scalar(
        select(Team).where(Team.code == WAREHOUSE_TEAM_CODE, Team.active.is_(True))
    )
    for step in steps:
        if warehouse and step["name"].strip() in ("中转库", "库房"):
            step.update(team_id=warehouse.id, team_name=warehouse.name)


async def read_word(file):
    filename = PurePath(file.filename or "").name
    if not filename.lower().endswith(".docx") or len(filename) > 240:
        raise HTTPException(422, "请上传.docx格式的Word工艺表")
    content = await file.read(MAX_FILE_BYTES + 1)
    data, serials, steps = await run_in_threadpool(parse_docx, content)
    return filename, content, data, serials, steps


def editable_version(db, route_id, version, user):
    row = require_route(db, route_id, True)
    require_draft_owner(db, row, user)
    if row.version != version:
        raise HTTPException(409, "工艺已被修改，请刷新后重试")
    return row


@router.post("/{route_id}/source")
async def attach_word(
    route_id: int,
    file: Annotated[UploadFile, File()],
    version: Annotated[int, Form(ge=1)],
    user: User = Depends(require_route_importer),
    db: AsyncSession = Depends(get_db),
):
    try:
        filename, content, data, _, _ = await read_word(file)

        def save(session):
            with session.begin():
                row = editable_version(session, route_id, version, user)
                if row.route_kind == "rework":
                    raise HTTPException(422, "返工工艺请手工填写，不支持导入工艺单")
                row.source_data = merge_materials(row.source_data, word=data, filename=filename)
                row.filename, row.source_file = filename, content
                row.source_sha256 = hashlib.sha256(content).hexdigest()
                row.version += 1
                session.flush()
                return document(row, db=session)

        return await db.run_sync(save)
    finally:
        await file.close()


@router.post("/{route_id}/drawings", status_code=201)
async def upload_drawing(
    route_id: int,
    file: Annotated[UploadFile, File()],
    version: Annotated[int, Form(ge=1)],
    user: User = Depends(require_route_importer),
    db: AsyncSession = Depends(get_db),
):
    try:
        filename = (file.filename or "").replace("\\", "/").split("/")[-1]
        content = await file.read(MAX_FILE_BYTES + 1)
        await run_in_threadpool(validate_drawing, filename, content)
        digest = hashlib.sha256(content).hexdigest()

        def save(session):
            with session.begin():
                row = editable_version(session, route_id, version, user)
                drawings = list(
                    session.scalars(
                        select(ProcessRouteDrawing).where(ProcessRouteDrawing.route_id == row.id)
                    )
                )
                if any(item.sha256 == digest for item in drawings):
                    raise HTTPException(422, "该图纸已上传，请勿重复添加")
                if len(drawings) >= MAX_DRAWINGS:
                    raise HTTPException(422, "每个工艺最多上传10份图纸")
                session.add(
                    ProcessRouteDrawing(
                        route_id=row.id,
                        filename=filename,
                        sha256=digest,
                        size_bytes=len(content),
                        content=content,
                    )
                )
                row.version += 1
                session.flush()
                return document(row, db=session)

        return await db.run_sync(save)
    finally:
        await file.close()


@router.get("/{route_id}/drawings/{drawing_id}")
def download_drawing(
    route_id: int,
    drawing_id: int,
    preview: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_route_reader(require_route(db, route_id), user)
    drawing = db.get(ProcessRouteDrawing, drawing_id)
    if not drawing or drawing.route_id != route_id:
        raise HTTPException(404, "图纸不存在")
    return Response(
        drawing_preview(drawing.content) if preview else drawing.content,
        media_type="application/pdf",
        headers={
            "Content-Disposition": "attachment; filename*=UTF-8''" + quote(drawing.filename),
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )


@router.delete("/{route_id}/drawings/{drawing_id}")
def remove_drawing(
    route_id: int,
    drawing_id: int,
    version: int = Query(ge=1),
    user: User = Depends(require_route_importer),
    db: Session = Depends(get_db),
):
    with db.begin():
        row = editable_version(db, route_id, version, user)
        drawing = db.get(ProcessRouteDrawing, drawing_id)
        if not drawing or drawing.route_id != route_id:
            raise HTTPException(404, "图纸不存在")
        db.delete(drawing)
        row.version += 1
        db.flush()
        return document(row, db=db)


@router.get("/{route_id}")
def detail(route_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return document(require_route_reader(require_route(db, route_id), user), db=db)


@router.get("/{route_id}/source")
def source(route_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = require_route_reader(require_route(db, route_id), user)
    if not row.filename:
        raise HTTPException(404, "本工艺尚未上传Word原稿")
    return Response(
        row.source_file,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": "attachment; filename*=UTF-8''" + quote(row.filename),
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.put("/{route_id}")
def save_draft(
    route_id: int,
    payload: RouteDraftWrite,
    user: User = Depends(require_route_importer),
    db: Session = Depends(get_db),
):
    with db.begin():
        row = require_route(db, route_id, True)
        require_draft_owner(db, row, user)
        if row.state != "draft" or row.version != payload.version:
            raise HTTPException(409, "工艺已被他人修改，请刷新后重试")
        if row.route_kind == "rework" and payload.serial_nos != row.serial_nos:
            raise HTTPException(422, "返工流水号随原批次保留，不能修改")
        order_serial = row.source_data.get("order_document", {}).get("serial_no")
        if order_serial and payload.serial_nos != [order_serial]:
            raise HTTPException(422, "流水号与已导入的订单表不一致")
        row.title, row.serial_nos, row.steps = (
            payload.title.strip(),
            payload.serial_nos,
            [step.model_dump() for step in payload.steps],
        )
        row.review_note = payload.review_note.strip()
        apply_material_values(row, payload.material_values)
        confirmation = row.source_data.get("material_confirmation")
        if confirmation and confirmation.get("fingerprint") != review_fingerprint(row):
            row.source_data = {
                key: value
                for key, value in row.source_data.items()
                if key != "material_confirmation"
            }
        if row.route_kind == "rework" and payload.resume_step_index not in (
            None,
            row.resume_step_index,
        ):
            raise HTTPException(
                422, "返工后须接回原正常工序；需重做的工序请列入返工工艺，不能跳过原路线"
            )
        if "engineering_employee_id" in payload.model_fields_set:
            if row.parent_id and payload.engineering_employee_id != row.engineering_employee_id:
                raise HTTPException(422, "修订时保留原工艺人员，请选择本次修改人员")
            if not row.parent_id:
                assign_engineering_employee(db, row, payload.engineering_employee_id)
        modifier_id = (
            payload.modified_employee_id
            if "modified_employee_id" in payload.model_fields_set
            else row.engineering_employee_id
        )
        assign_engineering_employee(db, row, modifier_id, modifier=True)
        row.version += 1
        db.flush()
        reserve_serial(db, row)
        return document(row, db=db)


@router.post("/{route_id}/publish")
def publish(
    route_id: int,
    payload: RevisionWrite,
    user: User = Depends(require_route_importer),
    db: Session = Depends(get_db),
):
    with db.begin():
        row = require_route(db, route_id, True)
        if row.state != "published":
            require_draft_owner(db, row, user)
        if row.version != payload.version:
            raise HTTPException(409, "工艺内容已变化，请刷新后核对")
        if row.state == "published":
            return document(row, db=db)
        if (
            is_engineering_user(user)
            and (row.modified_employee_id if row.parent_id else row.engineering_employee_id) is None
        ):
            raise HTTPException(422, "请选择修改人员" if row.parent_id else "请选择工艺人员")
        if row.modified_employee_id is not None:
            assign_engineering_employee(db, row, row.modified_employee_id, modifier=True)
        elif row.engineering_employee_id is not None and not row.parent_id:
            assign_engineering_employee(db, row, row.engineering_employee_id)
        if row.parent_id:
            require_route(db, row.parent_id, True)
            if db.scalar(
                select(ProcessRoute.id)
                .where(
                    ProcessRoute.parent_id == row.parent_id,
                    ProcessRoute.state == "published",
                    ProcessRoute.id != row.id,
                )
                .limit(1)
            ):
                raise HTTPException(409, "工艺已由他人修改，请刷新后重试")
        if row.source_data.get("review_required"):
            fingerprint = review_fingerprint(row)
            if (
                not payload.confirmed_imports
                and row.source_data.get("material_confirmation", {}).get("fingerprint")
                != fingerprint
            ):
                raise HTTPException(422, "请确认自动填入的资料和工序")
            row.source_data = {
                **row.source_data,
                "material_confirmation": {
                    "fingerprint": fingerprint,
                    "by": actor_name(user),
                    "at": utcnow().isoformat() + "Z",
                },
            }
        publish_route(db, row)
        from .rework_notices import notify_ready

        notify_ready(db, row)
        db.flush()
        return document(row, db=db)


@router.post("/{route_id}/revise", status_code=201)
def revise(
    route_id: int, user: User = Depends(require_route_importer), db: Session = Depends(get_db)
):
    with db.begin():
        previous = require_route(db, route_id, True)
        if db.get(ProcessRouteArchive, previous.id):
            raise HTTPException(409, "该工艺已归入历史，请打开当前工艺")
        if previous.route_kind == "rework":
            from .rework_routes import require_unstarted

            require_unstarted(db, previous)
        if previous.state != "published":
            raise HTTPException(409, "请重新打开已保存的工艺后修改")
        if db.scalar(
            select(ProcessRoute.id)
            .where(
                ProcessRoute.parent_id == previous.id,
                ProcessRoute.state == "published",
            )
            .limit(1)
        ):
            raise HTTPException(409, "工艺已由他人修改，请刷新后重试")
        row = ProcessRoute(
            **{
                key: getattr(previous, key)
                for key in (
                    "route_kind",
                    "rework_source_transfer_id",
                    "rework_of_id",
                    "original_schedule_id",
                    "rework_inspection_id",
                    "resume_route_id",
                    "resume_step_index",
                    "resume_step_complete",
                    "resume_team_id",
                    "rework_round",
                    "request_reason",
                    "requesting_team_id",
                    "requesting_team_name",
                    "requested_by",
                )
            },
            title=previous.title,
            filename=previous.filename,
            source_file=previous.source_file,
            source_sha256=previous.source_sha256,
            source_data=previous.source_data,
            serial_nos=previous.serial_nos,
            steps=previous.steps,
            parent_id=previous.id,
            created_at=previous.created_at,
            engineering_employee_id=previous.engineering_employee_id,
            engineering_employee_name=previous.engineering_employee_name,
            created_by=actor_name(user),
            created_by_user_id=user.id,
        )
        db.add(row)
        db.flush()
        copy_drawings(db, previous.id, row.id)
        order_file = db.get(ProcessRouteOrderFile, previous.id)
        if order_file:
            db.add(
                ProcessRouteOrderFile(
                    route_id=row.id, filename=order_file.filename, content=order_file.content
                )
            )
        db.flush()
        return document(row, db=db)


@router.post("/{route_id}/bind")
def bind(
    route_id: int,
    payload: BindWrite,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):

    with db.begin():
        row = require_route(db, route_id, True)
        if row.route_kind != "normal" or row.state != "published":
            raise HTTPException(422, "请选择工艺班组已保存的正常产品工艺")
        for lot_id in sorted(set(payload.source_transfer_ids)):
            lot = db.scalar(
                select(MaterialTransfer).where(MaterialTransfer.id == lot_id).with_for_update()
            )
            bind_lot(db, row, lot, user)
        db.flush()
        return {"bound": len(set(payload.source_transfer_ids)), "route_id": row.id}


def bind_lot(db, row, lot, user):
    from .models import MaterialTransferEvent

    if row.route_kind != "normal" or row.state != "published":
        raise HTTPException(422, "请选择工艺班组已保存的正常产品工艺")
    if (
        not lot
        or lot.next_team_code != WAREHOUSE_TEAM_CODE
        or lot.status != "received"
        or (lot.source_transfer_id and lot.entry_kind != "serial_reallocation")
    ):
        raise HTTPException(422, "只能关联库房的首次入库批次；在途工序不能重绑")
    if lot.source_transfer_id:
        from .material_lineage import relatives

        ancestors = relatives([lot.id], ancestors=True, name="route_binding_ancestors")
        if db.scalar(
            select(MaterialTransfer.id)
            .where(
                MaterialTransfer.id.in_(select(ancestors.c.id)),
                MaterialTransfer.next_team_code != WAREHOUSE_TEAM_CODE,
            )
            .limit(1)
        ):
            raise HTTPException(422, "本批已进入过生产工序，不能重绑工艺")
    if user.role != "ADMIN":
        from .material_stock import require_actor

        require_actor(user, lot.next_team_id)
    if lot.material_type in SCRAP_MATERIAL_TYPES:
        raise HTTPException(422, "废料不绑定正常产品工艺路线")
    if lot.process_route_id:
        if lot.process_route_id == row.id:
            return
        raise HTTPException(409, "本批已有工艺路线，不能覆盖")
    balance = db.scalar(
        select(MaterialStockBalance)
        .where(MaterialStockBalance.transfer_id == lot.id)
        .with_for_update()
    )
    if (
        not balance
        or balance.reserved_weight
        or balance.reserved_quantity
        or balance.on_hand_quantity != lot.quantity
        or balance.on_hand_weight != lot.weight
    ):
        raise HTTPException(409, "批次已发生流转或加工，不能重新绑定路线")
    serials = (
        {member.serial_no for member in lot.shared_group.members}
        if lot.shared_unallocated
        else {lot.serial_no}
    )
    if serials != set(row.serial_nos) or row.steps[0]["team_id"] != lot.next_team_id:
        raise HTTPException(422, "派工流水号名单或起始库房与实物批次不一致")
    lot.process_route = row
    lot.process_route_id = row.id
    lot.process_step_index, lot.process_step_complete = 0, True
    lot.version += 1
    lot.updated_at = utcnow()
    db.add(
        MaterialTransferEvent(
            transfer_id=lot.id,
            action="route_bound",
            actor=actor_name(user),
            actor_user_id=user.id,
            occurred_at=lot.updated_at,
            changes={"process_route": {"before": None, "after": route_document(lot)}},
        )
    )
