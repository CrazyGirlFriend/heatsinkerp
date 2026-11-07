"""Transactional process-route review, attachment and publication use cases.

Each public write owns its SQLAlchemy transaction. Attachment bytes are read and
validated at the HTTP/file boundary before entering these database transactions.
"""

import hashlib

from fastapi import HTTPException
from sqlalchemy import select

from .auth import actor_name
from .material_stock import lock_lot
from .models import (
    MaterialTransfer,
    ProcessRoute,
    ProcessRouteArchive,
    ProcessRouteDrawing,
    ProcessRouteOrderFile,
    ProcessRoutePolicy,
    utcnow,
)
from .process_route_binding import bind_lot
from .process_route_documents import document
from .process_route_drawings import MAX_DRAWINGS, copy_drawings
from .process_route_orders import apply_material_values, merge_materials, review_fingerprint
from .process_route_queries import map_word_steps
from .process_route_schemas import BindWrite, RevisionWrite, RouteDraftWrite
from .process_route_serials import reserve_serial
from .process_routes import (
    assign_engineering_employee,
    is_engineering_user,
    publish_route,
    require_draft_owner,
    require_route,
    require_route_documents,
)
from .rework_routes import resume


def editable_version(db, route_id, version, user):
    row = require_route(db, route_id, True)
    require_draft_owner(db, row, user)
    if row.version != version:
        raise HTTPException(409, "工艺已被修改，请刷新后重试")
    return row


def save_draft(db, route_id, payload: RouteDraftWrite, user):
    with db.begin():
        row = require_route(db, route_id, True)
        require_draft_owner(db, row, user)
        if row.state != "draft" or row.version != payload.version:
            raise HTTPException(409, "工艺已被他人修改，请刷新后重试")
        if row.route_kind == "rework" and payload.serial_nos != row.serial_nos:
            raise HTTPException(422, "返工流水号随原批次保留，不能修改")
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


def publish(db, route_id, payload: RevisionWrite, user):
    with db.begin():
        row = require_route(db, route_id, True)
        if row.state != "published":
            require_draft_owner(db, row, user)
        if row.version != payload.version:
            raise HTTPException(409, "工艺内容已变化，请刷新后核对")
        if row.state == "published":
            require_route_documents(db, row)
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


def revise(db, route_id, user):
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


def bind(db, route_id, payload: BindWrite, user):
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


def remove_drawing(db, route_id, drawing_id, version, user):
    with db.begin():
        row = editable_version(db, route_id, version, user)
        drawing = db.get(ProcessRouteDrawing, drawing_id)
        if not drawing or drawing.route_id != route_id:
            raise HTTPException(404, "图纸不存在")
        db.delete(drawing)
        row.version += 1
        db.flush()
        return document(row, db=db)


def resume_rework_route(db, lot_id, user, expected_revision):
    with db.begin():
        return resume(db, lock_lot(db, lot_id, user.team_id), user, expected_revision)


def import_word(session, user, filename, content, data, serials, steps):
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


def create_draft(session, user, write, filename, content, parsed, documents):
    with session.begin():
        row = ProcessRoute(
            title=write.title,
            serial_nos=write.serial_nos,
            steps=[step.model_dump() for step in write.steps],
            review_note=write.review_note.strip(),
            filename=filename,
            source_sha256=hashlib.sha256(content).hexdigest(),
            source_file=content,
            source_data=merge_materials({}, word=parsed, filename=filename),
            created_by=actor_name(user),
            created_by_user_id=user.id,
        )
        apply_material_values(row, write.material_values)
        assign_engineering_employee(session, row, write.engineering_employee_id)
        assign_engineering_employee(session, row, write.engineering_employee_id, modifier=True)
        session.add(row)
        if not session.get(ProcessRoutePolicy, 1):
            session.add(ProcessRoutePolicy(id=1, enforced_after=utcnow()))
        session.flush()
        reserve_serial(session, row)
        session.add_all(ProcessRouteDrawing(route_id=row.id, **data) for data in documents)
        session.flush()
        return document(row, db=session)


def attach_order(session, route_id, version, user, order, filename, content):
    with session.begin():
        row = editable_version(session, route_id, version, user)
        if row.route_kind == "rework":
            raise HTTPException(422, "返工工艺不上传订单表")
        row.source_data = merge_materials(row.source_data, order=order)
        original = session.get(ProcessRouteOrderFile, row.id)
        if original is None:
            original = ProcessRouteOrderFile(route_id=row.id)
            session.add(original)
        original.filename, original.content = filename, content
        row.version += 1
        session.flush()
        return document(row, db=session)


def attach_word(session, route_id, version, user, filename, content, data):
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


def upload_drawing(session, route_id, version, user, filename, content, digest):
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
