"""Warehouse supplemental originals, confirmed with the stock receipt transaction."""

import hashlib
from pathlib import PurePath

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from . import material_stock
from .models import MaterialTransfer, User, WarehouseReceiptDocument, utcnow
from .order_document_preview import order_document_preview
from .process_route_drawings import MAX_DRAWINGS, drawing_preview, validate_drawing
from .process_route_import import parse_docx
from .process_route_orders import merge_materials, parse_order

MEDIA_TYPES = {
    "process": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "drawing": "application/pdf",
    "order": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


def document(row):
    return {
        "id": row.id,
        "kind": row.kind,
        "filename": row.filename,
        "size_bytes": row.size_bytes,
        "sha256": row.sha256,
        "parsed": row.parsed,
        "transfer_id": row.transfer_id,
        "created_at": row.created_at.isoformat() + "Z",
        "confirmed_at": row.confirmed_at.isoformat() + "Z" if row.confirmed_at else None,
    }


def require_reader(db, document_id, user):
    row = db.get(WarehouseReceiptDocument, document_id)
    # Attached stock documents have the same read scope as their material record.
    # An unfinished upload remains private to the person preparing that receipt.
    if row is None or (row.transfer_id is None and row.uploaded_by_user_id != user.id):
        raise HTTPException(404, "入库资料不存在")
    return row


def parsed_document(kind, filename, content):
    if kind == "drawing":
        validate_drawing(filename, content)
        return {}
    if kind == "order":
        return parse_order(content, filename)
    if not filename.lower().endswith(".docx") or len(filename) > 240:
        raise HTTPException(422, "请上传.docx格式的Word工艺表")
    parsed, serials, steps = parse_docx(content)
    return {
        **merge_materials({}, word=parsed, filename=filename),
        "serial_nos": serials,
        "steps": steps,
    }


def save_upload(db, team_id, user, kind, filename, content, parsed):
    digest = hashlib.sha256(content).hexdigest()
    pending_key = hashlib.sha256(f"{user.id}:{team_id}:{kind}:{digest}".encode()).hexdigest()
    try:
        with db.begin():
            prior = db.scalar(
                select(WarehouseReceiptDocument).where(
                    WarehouseReceiptDocument.pending_key == pending_key
                )
            )
            if prior is not None:
                return document(prior)
            row = WarehouseReceiptDocument(
                team_id=team_id,
                kind=kind,
                filename=filename,
                content=content,
                sha256=digest,
                size_bytes=len(content),
                parsed=parsed,
                pending_key=pending_key,
                uploaded_by_user_id=user.id,
            )
            db.add(row)
            db.flush()
            db.refresh(row, attribute_names=["created_at"])
            return document(row)
    except IntegrityError:
        db.rollback()
        prior = db.scalar(
            select(WarehouseReceiptDocument).where(
                WarehouseReceiptDocument.pending_key == pending_key
            )
        )
        if prior is not None:
            return document(prior)
        raise


def delete_upload(document_id: int, user: User, db: Session):
    with db.begin():
        row = db.scalar(
            select(WarehouseReceiptDocument)
            .where(WarehouseReceiptDocument.id == document_id)
            .with_for_update()
        )
        if row is None or row.uploaded_by_user_id != user.id:
            raise HTTPException(404, "入库资料不存在")
        material_stock.require_actor(user, row.team_id)
        if row.transfer_id is not None:
            raise HTTPException(409, "已入库资料须保留，不能删除")
        db.delete(row)


def receipt_origin(db, lot):
    """Transfer and processing children retain the originals of their physical source."""
    visited = set()
    while lot.source_transfer_id is not None and lot.id not in visited:
        visited.add(lot.id)
        lot = db.get(MaterialTransfer, lot.source_transfer_id)
        if lot is None:
            raise HTTPException(409, "入库来源记录不完整")
    return lot


def has_confirmed_order(db, lot, serial_no):
    origin = receipt_origin(db, lot)
    return any(
        row.parsed.get("serial_no") == serial_no
        for row in db.scalars(
            select(WarehouseReceiptDocument).where(
                WarehouseReceiptDocument.transfer_id == origin.id,
                WarehouseReceiptDocument.kind == "order",
                WarehouseReceiptDocument.confirmed_at.is_not(None),
                WarehouseReceiptDocument.size_bytes > 0,
            )
        )
    )


def receipt_documents(batch_no: str, db: Session):
    lot = db.scalar(select(MaterialTransfer).where(MaterialTransfer.batch_no == batch_no))
    if lot is None:
        raise HTTPException(404, "物料批次不存在")
    serial_no = None if lot.shared_unallocated else lot.serial_no
    origin = receipt_origin(db, lot)
    return {
        "items": [
            document(row)
            for row in db.scalars(
                select(WarehouseReceiptDocument)
                .where(WarehouseReceiptDocument.transfer_id == origin.id)
                .order_by(WarehouseReceiptDocument.id)
            )
            if row.kind != "order" or not serial_no or row.parsed.get("serial_no") == serial_no
        ]
    }


def validate_documents(db, team, payload, user):
    """Validate and lock attachments before making any stock changes."""
    if (
        payload.process_route is not None or payload.document_ids
    ) and not payload.confirmed_imports:
        raise HTTPException(422, "请核对导入资料及自动填入的字段，并确认后入库")
    ids = payload.document_ids
    if len(ids) != len(set(ids)) or any(document_id < 1 for document_id in ids):
        raise HTTPException(422, "入库资料不能重复或无效")
    if not ids:
        return []
    rows = db.scalars(
        select(WarehouseReceiptDocument)
        .where(WarehouseReceiptDocument.id.in_(ids))
        .order_by(WarehouseReceiptDocument.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).all()
    if len(rows) != len(ids) or any(
        row.uploaded_by_user_id != user.id or row.team_id != team.id for row in rows
    ):
        raise HTTPException(422, "入库资料不存在或不属于当前录入人")
    if any(row.transfer_id is not None for row in rows):
        raise HTTPException(409, "资料已用于其他入库，请重新导入")
    for kind, maximum in (("process", 1), ("order", 1), ("drawing", MAX_DRAWINGS)):
        if sum(row.kind == kind for row in rows) > maximum:
            raise HTTPException(
                422,
                f"每次入库最多上传 {maximum} 份"
                + {"process": "工艺原件", "order": "订单表", "drawing": "图纸"}[kind],
            )
    serials = (
        {member.serial_no for member in payload.shared_serials}
        if payload.shared_serials
        else {payload.serial_no}
        if payload.serial_no
        else set()
    )
    for row in rows:
        if row.kind == "order" and serials and row.parsed.get("serial_no") not in serials:
            raise HTTPException(422, "订单表流水号与本次入库不一致，请重新核对")
    return rows


def attach_documents(db, receipt, documents):
    for row in documents:
        row.transfer_id = receipt.id
        row.pending_key = None
        row.confirmed_at = utcnow()
    db.flush()


async def download_payload(db: AsyncSession, document_id: int, user: User, preview: bool):
    def original(session):
        row = require_reader(session, document_id, user)
        return row.kind, row.filename, row.content

    kind, filename, content = await db.run_sync(original)
    media_type = MEDIA_TYPES[kind]
    if preview and kind == "order":
        content = await run_in_threadpool(order_document_preview, content, filename)
        media_type = "application/pdf"
        filename = str(PurePath(filename).with_suffix(".pdf"))
    elif preview and kind == "drawing":
        content = await run_in_threadpool(drawing_preview, content)
    return content, filename, media_type
