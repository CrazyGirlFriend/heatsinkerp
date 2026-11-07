"""Word route review, publication, binding and source-document retrieval."""

import hashlib
from pathlib import PurePath
from typing import Annotated, Literal
from urllib.parse import quote

from fastapi import Depends, File, Form, HTTPException, Path, Query, Response, UploadFile
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from . import process_route_queries as queries
from . import process_route_service as service
from .async_api import AsyncAPIRouter
from .auth import get_current_user
from .database import get_db
from .models import (
    MaterialTransfer,
    ProcessRouteDrawing,
    ProcessRouteOrderFile,
    User,
)
from .order_document_preview import order_document_preview
from .process_route_documents import document
from .process_route_drawings import MAX_DRAWINGS, drawing_preview, validate_drawing
from .process_route_import import MAX_FILE_BYTES, parse_docx
from .process_route_orders import (
    merge_materials,
    parse_order,
)
from .process_route_queries import map_word_steps
from .process_route_read_schemas import (
    BoundRouteResponse,
    LotRouteResponse,
    ProcessRouteDetailResponse,
    ProcessRoutePageResponse,
    ProcessRouteParseResponse,
    ReworkRoundResponse,
    RouteDispatchOrderResponse,
    RouteExecutionOptionsResponse,
    RouteOrderDocumentResponse,
)
from .process_route_schemas import BindWrite, ResumeWrite, RevisionWrite, RouteDraftWrite
from .process_routes import (
    assert_route_importer,
    require_route,
    require_route_reader,
    route_document,
    route_options,
)
from .processing_read_schemas import QuantityAdjustmentContextResponse
from .read_schemas import PageResponse
from .rework_read_schemas import ReworkResumeResponse, ReworkSourceResponse
from .rework_routes import ReworkRequest

router = AsyncAPIRouter(
    prefix="/api/process-routes", tags=["process routes"], dependencies=[Depends(get_current_user)]
)


def require_route_importer(user: User = Depends(get_current_user)) -> User:
    return assert_route_importer(user)


@router.post("/drawing-preview", response_class=Response)
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


@router.post(
    "/import",
    status_code=201,
    response_model=ProcessRouteDetailResponse,
    response_model_exclude_unset=True,
)
async def import_word(
    file: Annotated[UploadFile, File()],
    user: User = Depends(require_route_importer),
    db: AsyncSession = Depends(get_db),
):
    try:
        filename, content, data, serials, steps = await read_word(file)

        return await db.run_sync(
            lambda session: service.import_word(
                session, user, filename, content, data, serials, steps
            )
        )
    finally:
        await file.close()


@router.get("", response_model=ProcessRoutePageResponse, response_model_exclude_unset=True)
def list_routes(
    kind: Literal["normal", "rework", "all"] = "normal",
    rework_scope: Literal["open", "ended", "all"] = "all",
    state: Literal["draft", "published"] | None = None,
    query: str = Query(default="", max_length=160),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    sort_order: Literal["asc", "desc"] = "desc",
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return queries.list_routes(
        db,
        user,
        kind=kind,
        rework_scope=rework_scope,
        state=state,
        query=query,
        page=page,
        page_size=page_size,
        sort_order=sort_order,
    )


@router.get(
    "/resolve", response_model=ProcessRouteDetailResponse, response_model_exclude_unset=True
)
def resolve_route(
    serial_no: str = Query(min_length=1, max_length=80),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from .process_routes import resolve_normal_route

    return document(resolve_normal_route(db, serial_no.strip()), db=db)


@router.get(
    "/rework-sources",
    response_model=PageResponse[ReworkSourceResponse] | QuantityAdjustmentContextResponse,
    response_model_exclude_unset=True,
)
def rework_sources(
    query: str = Query("", max_length=120),
    page: int = Query(1, ge=1),
    lot_id: int | None = Query(None, ge=1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from .rework_routes import source_stock

    return source_stock(db, user, query, page, lot_id)


@router.post(
    "/rework-requests",
    status_code=201,
    response_model=ProcessRouteDetailResponse,
    response_model_exclude_unset=True,
)
def request_rework_route(
    payload: ReworkRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from .rework_routes import request_rework

    return request_rework(db, payload, user)


@router.post(
    "/rework-lots/{lot_id}/resume",
    response_model=ReworkResumeResponse,
    response_model_exclude_unset=True,
)
def resume_rework_route(
    lot_id: int,
    payload: ResumeWrite,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return service.resume_rework_route(db, lot_id, user, payload.expected_revision)


@router.get(
    "/options/{team_id}",
    response_model=RouteExecutionOptionsResponse,
    response_model_exclude_unset=True,
)
def execution_options(
    team_id: int = Path(ge=1),
    _: User = Depends(require_route_importer),
    db: Session = Depends(get_db),
):
    return route_options(db, team_id)


@router.get("/lots/{lot_id}", response_model=LotRouteResponse, response_model_exclude_unset=True)
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


@router.post(
    "",
    status_code=201,
    response_model=ProcessRouteDetailResponse,
    response_model_exclude_unset=True,
)
async def create_draft(
    payload: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
    drawings: Annotated[list[UploadFile], File()],
    user: User = Depends(require_route_importer),
    db: AsyncSession = Depends(get_db),
):
    try:
        try:
            write = RouteDraftWrite.model_validate_json(payload)
        except ValidationError as error:
            raise HTTPException(422, error.errors()[0]["msg"]) from None
        if not 1 <= len(drawings) <= MAX_DRAWINGS:
            raise HTTPException(422, "请上传1至10份图纸")
        filename, content, parsed, _, _ = await read_word(file)
        documents, hashes = [], set()
        for drawing in drawings:
            name = PurePath(drawing.filename or "").name
            data = await drawing.read(MAX_FILE_BYTES + 1)
            await run_in_threadpool(validate_drawing, name, data)
            digest = hashlib.sha256(data).hexdigest()
            if digest in hashes:
                raise HTTPException(422, "请勿重复上传同一图纸")
            hashes.add(digest)
            documents.append(dict(filename=name, content=data, sha256=digest, size_bytes=len(data)))

        return await db.run_sync(
            lambda session: service.create_draft(
                session, user, write, filename, content, parsed, documents
            )
        )
    finally:
        await file.close()
        for drawing in drawings:
            await drawing.close()


@router.post("/parse", response_model=ProcessRouteParseResponse, response_model_exclude_unset=True)
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


@router.post(
    "/parse-order", response_model=RouteOrderDocumentResponse, response_model_exclude_unset=True
)
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


@router.post(
    "/{route_id}/order",
    response_model=ProcessRouteDetailResponse,
    response_model_exclude_unset=True,
)
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

        return await db.run_sync(
            lambda session: service.attach_order(
                session, route_id, version, user, order, filename, content
            )
        )
    finally:
        await file.close()


@router.get("/{route_id}/order", response_class=Response)
async def download_order(
    route_id: int,
    preview: bool = False,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    def original(session):
        require_route_reader(require_route(session, route_id), user)
        order = session.get(ProcessRouteOrderFile, route_id)
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


@router.get(
    "/{route_id}/dispatch-order",
    response_model=RouteDispatchOrderResponse | None,
    response_model_exclude_unset=True,
)
def dispatch_order(
    route_id: int,
    serial_no: str = Query(min_length=1, max_length=80),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from .schedule_order_documents import route_order

    require_route_reader(require_route(db, route_id), user)
    order = route_order(db, route_id, serial_no.strip())
    return {"task_id": order.task_id, "document": order.document} if order else None


async def read_word(file):
    filename = PurePath(file.filename or "").name
    if not filename.lower().endswith(".docx") or len(filename) > 240:
        raise HTTPException(422, "请上传.docx格式的Word工艺表")
    content = await file.read(MAX_FILE_BYTES + 1)
    data, serials, steps = await run_in_threadpool(parse_docx, content)
    return filename, content, data, serials, steps


@router.post(
    "/{route_id}/source",
    response_model=ProcessRouteDetailResponse,
    response_model_exclude_unset=True,
)
async def attach_word(
    route_id: int,
    file: Annotated[UploadFile, File()],
    version: Annotated[int, Form(ge=1)],
    user: User = Depends(require_route_importer),
    db: AsyncSession = Depends(get_db),
):
    try:
        filename, content, data, _, _ = await read_word(file)

        return await db.run_sync(
            lambda session: service.attach_word(
                session, route_id, version, user, filename, content, data
            )
        )
    finally:
        await file.close()


@router.post(
    "/{route_id}/drawings",
    status_code=201,
    response_model=ProcessRouteDetailResponse,
    response_model_exclude_unset=True,
)
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

        return await db.run_sync(
            lambda session: service.upload_drawing(
                session, route_id, version, user, filename, content, digest
            )
        )
    finally:
        await file.close()


@router.get("/{route_id}/drawings/{drawing_id}", response_class=Response)
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


@router.delete(
    "/{route_id}/drawings/{drawing_id}",
    response_model=ProcessRouteDetailResponse,
    response_model_exclude_unset=True,
)
def remove_drawing(
    route_id: int,
    drawing_id: int,
    version: int = Query(ge=1),
    user: User = Depends(require_route_importer),
    db: Session = Depends(get_db),
):
    return service.remove_drawing(db, route_id, drawing_id, version, user)


@router.get(
    "/{route_id}/rework-rounds",
    response_model=list[ReworkRoundResponse],
    response_model_exclude_unset=True,
)
def rework_rounds(
    route_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    from .rework_rounds import round_documents

    row = require_route_reader(require_route(db, route_id), user)
    if row.route_kind != "rework":
        raise HTTPException(422, "请选择返工工艺")
    return round_documents(db, row, user)


@router.get(
    "/{route_id}", response_model=ProcessRouteDetailResponse, response_model_exclude_unset=True
)
def detail(route_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return document(require_route_reader(require_route(db, route_id), user), db=db)


@router.get("/{route_id}/source", response_class=Response)
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


@router.put(
    "/{route_id}", response_model=ProcessRouteDetailResponse, response_model_exclude_unset=True
)
def save_draft(
    route_id: int,
    payload: RouteDraftWrite,
    user: User = Depends(require_route_importer),
    db: Session = Depends(get_db),
):
    return service.save_draft(db, route_id, payload, user)


@router.post(
    "/{route_id}/publish",
    response_model=ProcessRouteDetailResponse,
    response_model_exclude_unset=True,
)
def publish(
    route_id: int,
    payload: RevisionWrite,
    user: User = Depends(require_route_importer),
    db: Session = Depends(get_db),
):
    return service.publish(db, route_id, payload, user)


@router.post(
    "/{route_id}/revise",
    status_code=201,
    response_model=ProcessRouteDetailResponse,
    response_model_exclude_unset=True,
)
def revise(
    route_id: int, user: User = Depends(require_route_importer), db: Session = Depends(get_db)
):
    return service.revise(db, route_id, user)


@router.post(
    "/{route_id}/bind", response_model=BoundRouteResponse, response_model_exclude_unset=True
)
def bind(
    route_id: int,
    payload: BindWrite,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):

    return service.bind(db, route_id, payload, user)
