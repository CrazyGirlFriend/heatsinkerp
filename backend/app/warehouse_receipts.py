"""Warehouse-owned manual stock origins; no ERP or fabricated team handoff."""
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, OperationalError

from . import material_stock as stock
from . import material_transfer_workflow as workflow
from .auth import actor_name
from .record_filters import RecordFilters
from .batch_numbers import next_transfer_batch_number
from .models import MaterialDispatch, MaterialTransfer, Team, utcnow
from .team_constants import WAREHOUSE_TEAM_CODE


def require_warehouse(team):
    if team is None:
        raise HTTPException(404, "warehouse not found")
    if team.code != WAREHOUSE_TEAM_CODE or team.kind != "warehouse":
        raise HTTPException(403, "manual stock receipt is only available in the warehouse")
    return team


def replay(prior, user, request_hash):
    if prior.entry_kind != "warehouse_receipt":
        raise HTTPException(409, "idempotency key was used for another operation")
    stock._replay(prior, user, request_hash, "next_team_id")
    return workflow.material_transfer_dict(prior, user)


def create_receipt(db, team_id, payload, user, *, request_hash=None, source_reference=None):
    require_warehouse(stock.require_actor(user, team_id))
    request_hash = request_hash or workflow._creation_fingerprint(payload)
    try:
        with db.begin():
            # Recheck the directory under a current-read lock and serialize
            # simultaneous intakes before issuing a batch number.
            team = require_warehouse(db.scalar(select(Team).where(Team.id == team_id)
                .with_for_update().execution_options(populate_existing=True)))
            if not team.active:
                raise HTTPException(403, "warehouse must be active")
            prior = db.scalar(select(MaterialTransfer).where(
                MaterialTransfer.idempotency_key == payload.idempotency_key
            ).with_for_update().execution_options(populate_existing=True))
            if prior is not None:
                return replay(prior, user, request_hash)
            if payload.return_dispatch_no:
                original = db.scalar(select(MaterialDispatch).where(MaterialDispatch.dispatch_no == payload.return_dispatch_no))
                if original is None or original.entry_kind not in ("warehouse_outbound", "inspection_shipment"):
                    raise HTTPException(422, "关联单号须为已对外出库或发货的 CK 单号")
                matching = db.scalar(select(MaterialTransfer.id).where(MaterialTransfer.dispatch_id == original.id,
                    MaterialTransfer.serial_no == payload.serial_no, MaterialTransfer.status == "dispatched"))
                if matching is None:
                    raise HTTPException(422, "原出库单没有该流水号的已确认出库记录")
            now = utcnow()
            receipt = MaterialTransfer(
                batch_no=next_transfer_batch_number(db), entry_kind="warehouse_receipt",
                receipt_kind=payload.receipt_kind, external_source=payload.external_source,
                return_dispatch_no=payload.return_dispatch_no,
                serial_no=payload.serial_no,
                **{field: getattr(payload, field) for field in workflow.DOCUMENT_FIELDS},
                source_team_id=None, source_team_code=None, source_team_name=None,
                next_team_id=team.id, next_team_code=team.code, next_team_name=team.name,
                quantity=payload.quantity, weight=payload.weight, notes=payload.notes,
                status="received", stock_tracked=True, version=1,
                idempotency_key=payload.idempotency_key, request_hash=request_hash,
                created_by=actor_name(user), created_by_user_id=user.id,
                received_by=actor_name(user), received_by_user_id=user.id,
                created_at=now, updated_at=now, received_at=now,
            )
            db.add(receipt)
            db.flush()
            # MySQL DATETIME(0) rounds fractional seconds. Audit and the first
            # response must use persisted times, just like an idempotent replay.
            db.refresh(receipt, attribute_names=["created_at", "updated_at", "received_at"])
            workflow._record_event(db, receipt, user, "stocked")
            if source_reference:
                event = receipt.history[-1]
                event.changes = {**event.changes, **{
                    key: {"before": None, "after": value}
                    for key, value in source_reference.items()
                }}
                db.flush()
            result = workflow.material_transfer_dict(receipt, user)
        return result
    except (IntegrityError, OperationalError) as exc:
        db.rollback()
        prior = db.scalar(select(MaterialTransfer).where(
            MaterialTransfer.idempotency_key == payload.idempotency_key))
        if prior is not None:
            return replay(prior, user, request_hash)
        stock._db_conflict(exc)


def list_receipts(db, team_id, user, *, record_filters=None, query=None, material_type=None, receipt_source=None, page=1, page_size=20):
    require_warehouse(stock.require_team(db, team_id))
    filters = [MaterialTransfer.next_team_id == team_id, MaterialTransfer.status == "received"]
    if receipt_source == "internal":
        filters.append(MaterialTransfer.entry_kind == "transfer")
    elif receipt_source == "external":
        filters.append(MaterialTransfer.entry_kind == "warehouse_receipt")
    elif receipt_source == "return":
        filters.extend([MaterialTransfer.entry_kind == "warehouse_receipt", MaterialTransfer.receipt_kind == "return"])
    filters.extend((record_filters or RecordFilters()).predicates(MaterialTransfer.received_at, MaterialTransfer.serial_no))
    if material_type:
        filters.append(MaterialTransfer.material_type == material_type)
    if query and query.strip():
        filters.append(stock.literal_query(query, [MaterialTransfer.batch_no, MaterialTransfer.serial_no,
                                                   MaterialTransfer.material_name, MaterialTransfer.source_batch_no,
                                                   MaterialTransfer.external_source, MaterialTransfer.source_team_name, MaterialTransfer.return_dispatch_no]))
    total = db.scalar(select(func.count(MaterialTransfer.id)).where(*filters)) or 0
    items = db.scalars(select(MaterialTransfer).where(*filters)
        .order_by(MaterialTransfer.received_at.desc(), MaterialTransfer.id.desc())
        .offset((page-1)*page_size).limit(page_size)).all()
    return {"items": [workflow.material_transfer_dict(item, user, include_history=False) for item in items],
            "total": total, "page": page, "page_size": page_size}
