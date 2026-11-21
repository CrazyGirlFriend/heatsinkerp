"""Warehouse feedings are reviewed by dispatch, destination serial and schedule."""

from collections import defaultdict
from hashlib import sha256

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, PositiveInt
from sqlalchemy import and_, case, func, select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import lazyload

from . import material_transfer_workflow as workflow
from .material_delivery import with_schedule
from .models import MaterialTransfer as Transfer
from .models import ProductionScheduleDelivery
from .schemas import MaterialReceiptConfirm, PendingReceiptLine
from .table_query import table_order
from .team_constants import WAREHOUSE_TEAM_CODE
from .transfer_record_filters import apply_record_headers


def receipt_keys():
    # Positive ids are individual lots. Negative ids identify a warehouse submission.
    warehouse = and_(
        Transfer.source_team_code == WAREHOUSE_TEAM_CODE,
        Transfer.next_team_code != WAREHOUSE_TEAM_CODE,
        Transfer.dispatch_id.is_not(None),
        Transfer.entry_kind == "transfer",
        Transfer.shared_unallocated.is_(False),
    )
    schedule = func.coalesce(
        Transfer.processing_schedule_id,
        select(ProductionScheduleDelivery.schedule_id)
        .where(ProductionScheduleDelivery.transfer_id == Transfer.id)
        .correlate(Transfer)
        .scalar_subquery(),
        0,
    )
    return (
        case((warehouse, -Transfer.dispatch_id), else_=Transfer.id),
        Transfer.serial_no,
        schedule,
    )


def receipt_index(team_id, *, dispatch_id=None):
    keys = receipt_keys()
    statement = select(
        Transfer.id,
        func.min(Transfer.id).over(partition_by=keys).label("anchor"),
        func.sum(Transfer.quantity).over(partition_by=keys).label("quantity"),
        func.sum(Transfer.weight).over(partition_by=keys).label("weight"),
    ).where(Transfer.next_team_id == team_id)
    if dispatch_id is None:
        statement = statement.where(Transfer.status == "pending")
    else:
        statement = statement.where(Transfer.dispatch_id == dispatch_id)
    return statement.subquery()


def list_pending_documents(db, team_id, columns, filters, column_filters, page, page_size, user):
    index = receipt_index(team_id)
    columns.update(quantity=index.c.quantity, weight=index.c.weight)
    filters.extend(column_filters.predicates(amounts=columns, include_source_serial=True))
    base = select(Transfer).join(index, index.c.id == Transfer.id)
    apply_record_headers(db, columns, filters, "pending", base=base)
    order = table_order(columns, Transfer.created_at.desc(), Transfer.id.desc())
    # A match on any constituent batch selects the full receipt, even across page boundaries.
    ranked = (
        base.with_only_columns(
            index.c.anchor, func.row_number().over(order_by=order).label("position")
        )
        .where(*filters)
        .subquery()
    )
    docs = (
        select(ranked.c.anchor, func.min(ranked.c.position).label("position"))
        .group_by(ranked.c.anchor)
        .subquery()
    )
    total = db.scalar(select(func.count()).select_from(docs))
    anchors = db.scalars(
        select(docs.c.anchor)
        .order_by(docs.c.position)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    groups = defaultdict(list)
    if anchors:
        rows = db.execute(
            select(Transfer, index.c.anchor)
            .join(index, index.c.id == Transfer.id)
            .options(*workflow.material_transfer_list_options())
            .where(index.c.anchor.in_(anchors))
            .order_by(Transfer.id)
        ).all()
        documents = with_schedule(
            db,
            [workflow.material_transfer_dict(row, user, include_history=False) for row, _ in rows],
        )
        for (_, anchor), item in zip(rows, documents, strict=True):
            groups[anchor].append(item)
    result = []
    for anchor in anchors:
        lines = groups[anchor]
        if not lines:
            continue
        row = lines[0].copy()
        if len(lines) > 1:
            row.update(
                pending_receipt_lines=[
                    {key: line[key] for key in PendingReceiptLine.model_fields} for line in lines
                ],
                quantity=sum(line["quantity"] for line in lines),
                weight=round(sum(line["weight"] for line in lines), 6),
            )
        result.append(row)
    return {"items": result, "total": total, "page": page, "page_size": page_size, "summary": None}


class GroupReceiptConfirm(BaseModel):
    model_config = ConfigDict(extra="forbid")
    received_employee_id: int = Field(ge=1)
    idempotency_key: str = Field(min_length=1, max_length=100)
    versions: dict[str, PositiveInt] = Field(min_length=1, max_length=100)


def confirm_document(db, batch_no, payload, user):
    from .material_stock import _db_conflict, lock_lot

    try:
        with db.begin():
            first = db.scalar(
                select(Transfer).options(lazyload("*")).where(Transfer.batch_no == batch_no)
            )
            if first is None:
                raise HTTPException(404, "来料单不存在")
            workflow._assert_receiver(user, first)
            if (
                first.source_team_code != WAREHOUSE_TEAM_CODE
                or not first.dispatch_id
                or first.next_team_code == WAREHOUSE_TEAM_CODE
                or first.entry_kind != "transfer"
            ):
                raise HTTPException(422, "此批次不属于库房投料单")
            index = receipt_index(first.next_team_id, dispatch_id=first.dispatch_id)
            anchor = db.scalar(select(index.c.anchor).where(index.c.id == first.id))
            members = select(index.c.id).where(index.c.anchor == anchor)
            from .material_lineage import source_ids_for

            source_ids = db.scalars(source_ids_for(members)).all()
            for source_id in sorted(set(source_ids)):
                lock_lot(db, source_id, first.source_team_id)
            lines = db.scalars(
                select(Transfer)
                .options(lazyload("*"))
                .where(Transfer.id.in_(members))
                .order_by(Transfer.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            ).all()

            def receipt_key(line):
                return (
                    "document:"
                    + sha256(
                        f"{payload.idempotency_key}:{line.id}:{payload.versions.get(line.batch_no)}".encode()
                    ).hexdigest()
                )

            reviewed = [
                line
                for line in lines
                if line.status == "pending"
                or (line.status == "received" and line.receipt_idempotency_key == receipt_key(line))
            ]
            if {line.batch_no for line in reviewed} != payload.versions.keys():
                raise HTTPException(409, "待签收批次已变化，请刷新后核对")
            for line in reviewed:
                workflow.confirm_locked_receipt(
                    db,
                    line,
                    MaterialReceiptConfirm(
                        expected_version=payload.versions[line.batch_no],
                        received_employee_id=payload.received_employee_id,
                        idempotency_key=receipt_key(line),
                    ),
                    user,
                )
    except (IntegrityError, OperationalError) as exc:
        _db_conflict(exc)
