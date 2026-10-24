"""Word route review, publication, binding and source-document retrieval."""

import hashlib
from pathlib import PurePath
from typing import Annotated, Literal
from urllib.parse import quote

from fastapi import Depends, File, HTTPException, Path, Query, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session, defer
from starlette.concurrency import run_in_threadpool

from .async_api import AsyncAPIRouter
from .auth import actor_name, get_current_user, require_admin
from .database import get_db
from .models import (
    MaterialStockBalance,
    MaterialTransfer,
    ProcessRoute,
    ProcessRoutePolicy,
    Team,
    User,
    utcnow,
)
from .process_route_import import MAX_FILE_BYTES, parse_docx
from .process_route_schemas import RouteWrite
from .process_routes import (
    assert_route_importer,
    publish_route,
    require_draft_owner,
    require_route,
    require_route_reader,
    route_document,
    route_options,
)
from .schemas import SCRAP_MATERIAL_TYPES
from .team_constants import WAREHOUSE_TEAM_CODE

router = AsyncAPIRouter(
    prefix="/api/process-routes", tags=["process routes"], dependencies=[Depends(get_current_user)]
)


class BindWrite(BaseModel):
    source_transfer_ids: list[int] = Field(min_length=1, max_length=100)


class RevisionWrite(BaseModel):
    version: int = Field(ge=1)


def document(row, *, detail=True):
    return {
        "id": row.id,
        "title": row.title,
        "filename": row.filename,
        "state": row.state,
        "version": row.version,
        "parent_id": row.parent_id,
        "serial_nos": row.serial_nos,
        "created_by": row.created_by,
        "created_by_user_id": row.created_by_user_id,
        "created_at": row.created_at.isoformat() + "Z",
        "published_at": row.published_at.isoformat() + "Z" if row.published_at else None,
        **(
            {
                "steps": row.steps,
                "source_data": row.source_data,
                "review_note": row.review_note,
                "source_sha256": row.source_sha256,
            }
            if detail
            else {}
        ),
    }


def require_route_importer(user: User = Depends(get_current_user)) -> User:
    return assert_route_importer(user)


@router.post("/import", status_code=201)
async def import_word(
    file: Annotated[UploadFile, File()],
    user: User = Depends(require_route_importer),
    db: AsyncSession = Depends(get_db),
):
    try:
        filename = PurePath(file.filename or "").name
        if not filename.lower().endswith(".docx") or len(filename) > 240:
            raise HTTPException(422, "请上传.docx格式的Word工艺表")
        content = await file.read(MAX_FILE_BYTES + 1)
        data, serials, steps = await run_in_threadpool(parse_docx, content)

        def save(session):
            with session.begin():
                warehouse = session.scalar(
                    select(Team).where(Team.code == WAREHOUSE_TEAM_CODE, Team.active.is_(True))
                )
                for step in steps:
                    if warehouse and step["name"].strip() in ("中转库", "库房"):
                        step.update(team_id=warehouse.id, team_name=warehouse.name)
                row = ProcessRoute(
                    title=filename[:-5][:160],
                    filename=filename,
                    source_file=content,
                    source_sha256=hashlib.sha256(content).hexdigest(),
                    source_data=data,
                    serial_nos=serials,
                    steps=steps,
                    created_by=actor_name(user),
                    created_by_user_id=user.id,
                )
                session.add(row)
                if not session.get(ProcessRoutePolicy, 1):
                    session.add(ProcessRoutePolicy(id=1, enforced_after=utcnow()))
                session.flush()
                return document(row)

        return await db.run_sync(save)
    finally:
        await file.close()


@router.get("")
def list_routes(
    state: Literal["draft", "published"] | None = None,
    query: str = Query(default="", max_length=160),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from .material_stock import literal_query

    where = [literal_query(query, [ProcessRoute.title])] if query else []
    if user.role != "ADMIN":
        where.append(
            or_(ProcessRoute.state == "published", ProcessRoute.created_by_user_id == user.id)
        )
    if state:
        where.append(ProcessRoute.state == state)
    rows = db.scalars(
        select(ProcessRoute)
        .options(defer(ProcessRoute.steps))
        .where(*where)
        .order_by(ProcessRoute.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    policy = db.get(ProcessRoutePolicy, 1)
    return {
        "items": [document(row, detail=False) for row in rows],
        "total": db.scalar(select(func.count()).select_from(ProcessRoute).where(*where)),
        "page": page,
        "page_size": page_size,
        "enforced_after": policy.enforced_after.isoformat() + "Z" if policy else None,
    }


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
        "route": document(lot.process_route) if lot.process_route_id else None,
    }


@router.get("/{route_id}")
def detail(route_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return document(require_route_reader(require_route(db, route_id), user))


@router.get("/{route_id}/source")
def source(route_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = require_route_reader(require_route(db, route_id), user)
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
    payload: RouteWrite,
    user: User = Depends(require_route_importer),
    db: Session = Depends(get_db),
):
    with db.begin():
        row = require_route(db, route_id, True)
        require_draft_owner(db, row, user)
        if row.state != "draft" or row.version != payload.version:
            raise HTTPException(409, "路线已发布或被他人修改，请刷新后核对")
        row.title, row.serial_nos, row.steps = (
            payload.title.strip(),
            payload.serial_nos,
            [step.model_dump() for step in payload.steps],
        )
        row.review_note = payload.review_note.strip()
        row.version += 1
        db.flush()
        return document(row)


@router.post("/{route_id}/publish")
def publish(
    route_id: int,
    payload: RevisionWrite,
    user: User = Depends(require_route_importer),
    db: Session = Depends(get_db),
):
    with db.begin():
        row = require_route(db, route_id, True)
        require_draft_owner(db, row, user)
        if row.version != payload.version:
            raise HTTPException(409, "工艺草稿已变化，请刷新后核对")
        if row.state == "published":
            return document(row)
        publish_route(db, row)
        db.flush()
        return document(row)


@router.post("/{route_id}/revise", status_code=201)
def revise(route_id: int, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    with db.begin():
        previous = require_route(db, route_id, True)
        row = ProcessRoute(
            title=previous.title,
            filename=previous.filename,
            source_file=previous.source_file,
            source_sha256=previous.source_sha256,
            source_data=previous.source_data,
            serial_nos=previous.serial_nos,
            steps=previous.steps,
            parent_id=previous.id,
            created_by=actor_name(user),
            created_by_user_id=user.id,
        )
        db.add(row)
        db.flush()
        return document(row)


@router.post("/{route_id}/bind")
def bind(
    route_id: int,
    payload: BindWrite,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from .models import MaterialTransferEvent

    with db.begin():
        row = require_route(db, route_id, True)
        if row.state != "published":
            raise HTTPException(422, "只有已发布的工艺路线可以绑定批次")
        for lot_id in sorted(set(payload.source_transfer_ids)):
            lot = db.scalar(
                select(MaterialTransfer).where(MaterialTransfer.id == lot_id).with_for_update()
            )
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
                    continue
                raise HTTPException(409, "本批已有工艺路线，不能覆盖")
            balance = db.scalar(
                select(MaterialStockBalance)
                .where(MaterialStockBalance.transfer_id == lot_id)
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
        db.flush()
        return {"bound": len(set(payload.source_transfer_ids)), "route_id": row.id}
