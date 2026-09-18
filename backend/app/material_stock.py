"""Received-lot balances, atomic outbound reservations, and append-only loss records.

Every mutation locks its source lot and uses locking/current reads for deductions.
This is important under MySQL REPEATABLE READ: a prior idempotency lookup must
not make an old snapshot usable for a second reservation after waiting on a lock.
"""
from __future__ import annotations

from decimal import Decimal
import hashlib
import json
from uuid import uuid4

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import case, func, or_, select, union_all, literal
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import lazyload

from .auth import actor_name
from .batch_numbers import next_transfer_batch_number
from .models import MaterialDispatch, MaterialLoss, MaterialTransfer, Team
from .schemas import DIRECT_MATERIAL_TYPE_PATTERN, SCRAP_MATERIAL_TYPES
from .team_constants import EXTERNAL_ENTRY_KINDS, WAREHOUSE_TEAM_CODE, INSPECTION_TEAM_CODE
from . import material_transfer_workflow as workflow


class StockAmounts(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_transfer_id: int = Field(ge=1)
    quantity: int = Field(ge=0, le=2_147_483_647)
    weight: Decimal = Field(ge=0, max_digits=14, decimal_places=3)

    @model_validator(mode="after")
    def nonempty(self):
        if self.quantity == 0 and self.weight == 0:
            raise ValueError("quantity or weight must be positive")
        return self


class LossCreate(StockAmounts):
    reason: str = Field(min_length=1, max_length=2000)
    idempotency_key: str = Field(min_length=1, max_length=100)

    @field_validator("reason")
    @classmethod
    def reason_required(cls, value):
        if not value.strip():
            raise ValueError("reason cannot be blank")
        return value.strip()


class DispatchLine(StockAmounts):
    material_type: str | None = Field(default=None, pattern=DIRECT_MATERIAL_TYPE_PATTERN)


class DispatchCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    next_team_id: int | None = Field(default=None, ge=1)
    entry_kind: str = Field(default="transfer", pattern="^(transfer|warehouse_outbound|inspection_shipment)$")
    external_destination: str | None = Field(default=None, max_length=240)
    notes: str | None = Field(default=None, max_length=2000)
    idempotency_key: str = Field(min_length=1, max_length=100)
    lines: list[DispatchLine] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def validate_destination(self):
        if not self.idempotency_key.strip():
            raise ValueError("idempotency_key cannot be blank")
        if self.entry_kind == "transfer":
            if self.next_team_id is None or self.external_destination is not None:
                raise ValueError("internal transfers require next_team_id and no external_destination")
        else:
            if self.next_team_id is not None or not (self.external_destination or "").strip():
                raise ValueError("external outbound requires external_destination and no next_team_id")
            self.external_destination = self.external_destination.strip()
        return self


def require_team(db, team_id):
    team = db.get(Team, team_id)
    if team is None:
        raise HTTPException(404, "team not found")
    return team


def require_actor(user, team_id):
    source = workflow._require_team_actor(user)
    if source.id != team_id:
        raise HTTPException(403, "only the current team's leader may change its stock")
    return source


def require_outbound_actor(user, team_id, entry_kind):
    source = require_actor(user, team_id)
    valid = ((entry_kind == "warehouse_outbound" and source.code == WAREHOUSE_TEAM_CODE and source.kind == "warehouse")
             or (entry_kind == "inspection_shipment" and source.code == INSPECTION_TEAM_CODE and source.kind == "production"))
    if not valid:
        raise HTTPException(403, "only the bound warehouse or inspection team may confirm its own outbound kind")
    return source


def fingerprint(payload):
    value = payload.model_dump(mode="json", exclude={"idempotency_key"}, exclude_unset=True)
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def _replay(record, user, request_hash, owner_field):
    if getattr(record, owner_field) != user.team_id:
        raise HTTPException(403, "idempotency key belongs to another team")
    if record.request_hash != request_hash:
        raise HTTPException(409, "idempotency key was used with a different payload")


def lock_lot(db, transfer_id, team_id=None):
    lot = db.scalar(select(MaterialTransfer).options(lazyload("*")).where(
        MaterialTransfer.id == transfer_id
    ).with_for_update().execution_options(populate_existing=True))
    if lot is None:
        raise HTTPException(404, "source material batch not found")
    if team_id is not None and lot.next_team_id != team_id:
        raise HTTPException(403, "source batch was not received by the current team")
    if lot.status != "received" or not lot.stock_tracked:
        raise HTTPException(409, "source batch must be received and tracked before changing stock")
    return lot


def available_locked(db, lot, exclude_transfer_id=None):
    where = [MaterialTransfer.source_transfer_id == lot.id, MaterialTransfer.status.in_(["pending", "received", "dispatched"])]
    if exclude_transfer_id is not None:
        where.append(MaterialTransfer.id != exclude_transfer_id)
    outgoing = db.execute(select(MaterialTransfer.quantity, MaterialTransfer.weight).where(*where).with_for_update()).all()
    losses = db.execute(select(MaterialLoss.quantity, MaterialLoss.weight).where(
        MaterialLoss.source_transfer_id == lot.id
    ).with_for_update()).all()
    return (lot.quantity - sum(row.quantity for row in (*outgoing, *losses)),
            lot.weight - sum((row.weight for row in (*outgoing, *losses)), Decimal(0)))


def validate_available(db, lot, quantity, weight, exclude_transfer_id=None):
    available_quantity, available_weight = available_locked(db, lot, exclude_transfer_id)
    if quantity > available_quantity or weight > available_weight:
        raise HTTPException(409, "insufficient available stock; refresh the batch balance and review amounts")


def _db_conflict(exc):
    if isinstance(exc, OperationalError) and getattr(exc.orig, "args", (None,))[0] not in (1205, 1213):
        raise exc
    raise HTTPException(409, "stock changed concurrently; retry with the same idempotency key") from exc


def create_loss(db, team_id, payload, user):
    require_actor(user, team_id)
    request_hash = fingerprint(payload)
    try:
        with db.begin():
            prior = db.scalar(select(MaterialLoss).where(MaterialLoss.idempotency_key == payload.idempotency_key))
            if prior is not None:
                _replay(prior, user, request_hash, "team_id")
                return workflow.material_loss_dict(prior)
            lot = lock_lot(db, payload.source_transfer_id, team_id)
            prior = db.scalar(select(MaterialLoss).where(MaterialLoss.idempotency_key == payload.idempotency_key).with_for_update().execution_options(populate_existing=True))
            if prior is not None:
                _replay(prior, user, request_hash, "team_id")
                return workflow.material_loss_dict(prior)
            validate_available(db, lot, payload.quantity, payload.weight)
            loss = MaterialLoss(
                loss_no="LS" + uuid4().hex[:24].upper(), source_transfer_id=lot.id, team_id=team_id,
                quantity=payload.quantity, weight=payload.weight, reason=payload.reason,
                idempotency_key=payload.idempotency_key, request_hash=request_hash,
                created_by=actor_name(user), created_by_user_id=user.id,
            )
            db.add(loss)
            db.flush()
            db.refresh(loss, attribute_names=["created_at"])
            result = workflow.material_loss_dict(loss)
        return result
    except (IntegrityError, OperationalError) as exc:
        db.rollback()
        prior = db.scalar(select(MaterialLoss).where(MaterialLoss.idempotency_key == payload.idempotency_key))
        if prior is not None:
            _replay(prior, user, request_hash, "team_id")
            return workflow.material_loss_dict(prior)
        _db_conflict(exc)


def create_dispatch(db, team_id, payload, user):
    source = require_actor(user, team_id)
    external = payload.entry_kind in EXTERNAL_ENTRY_KINDS
    if external:
        require_outbound_actor(user, team_id, payload.entry_kind)
    request_hash = fingerprint(payload)
    try:
        with db.begin():
            prior = db.scalar(select(MaterialDispatch).where(MaterialDispatch.idempotency_key == payload.idempotency_key))
            if prior is not None:
                _replay(prior, user, request_hash, "source_team_id")
                return dispatch_dict(db, prior, user)
            # Deterministic lock order also covers a multi-lot submission.
            lots = {source_id: lock_lot(db, source_id, team_id)
                    for source_id in sorted({line.source_transfer_id for line in payload.lines})}
            prior = db.scalar(select(MaterialDispatch).where(MaterialDispatch.idempotency_key == payload.idempotency_key).with_for_update().execution_options(populate_existing=True))
            if prior is not None:
                _replay(prior, user, request_hash, "source_team_id")
                return dispatch_dict(db, prior, user)
            target = None if external else workflow._active_target(db, payload.next_team_id)
            if target is not None and target.id == source.id:
                raise HTTPException(422, "source and target teams must be different")
            for source_id, lot in lots.items():
                portions = [line for line in payload.lines if line.source_transfer_id == source_id]
                validate_available(db, lot, sum(line.quantity for line in portions), sum((line.weight for line in portions), Decimal(0)))
            for line in payload.lines:
                lot = lots[line.source_transfer_id]
                kind = line.material_type if "material_type" in line.model_fields_set else lot.material_type
                workflow.validate_material_route(lot.material_type, kind, target, payload.entry_kind, payload.notes)
                if target is not None:
                    workflow._validate_warehouse_type(target, kind)
            destination = {"next_team_id": target.id if target else None,
                           "next_team_code": target.code if target else None,
                           "next_team_name": target.name if target else None,
                           "entry_kind": payload.entry_kind, "external_destination": payload.external_destination}
            dispatch = MaterialDispatch(
                dispatch_no=None, source_team_id=source.id,
                **destination,
                notes=payload.notes, idempotency_key=payload.idempotency_key, request_hash=request_hash,
                created_by=actor_name(user), created_by_user_id=user.id,
            )
            db.add(dispatch)
            db.flush()
            db.refresh(dispatch, attribute_names=["created_at"])
            for line in payload.lines:
                lot = lots[line.source_transfer_id]
                fields = {field: getattr(lot, field) for field in workflow.DOCUMENT_FIELDS}
                if "material_type" in line.model_fields_set:
                    fields["material_type"] = line.material_type
                transfer = MaterialTransfer(
                    batch_no=next_transfer_batch_number(db), serial_no=lot.serial_no, **fields,
                    source_transfer_id=lot.id, dispatch_id=dispatch.id,
                    source_team_id=source.id, source_team_code=source.code, source_team_name=source.name,
                    **destination,
                    quantity=line.quantity, weight=line.weight, status="pending", notes=payload.notes,
                    created_by=actor_name(user), created_by_user_id=user.id,
                )
                db.add(transfer)
                db.flush()
                db.refresh(transfer, attribute_names=["created_at", "updated_at"])
                workflow._record_event(db, transfer, user, "created")
            result = dispatch_dict(db, dispatch, user)
        return result
    except (IntegrityError, OperationalError) as exc:
        db.rollback()
        prior = db.scalar(select(MaterialDispatch).where(MaterialDispatch.idempotency_key == payload.idempotency_key))
        if prior is not None:
            _replay(prior, user, request_hash, "source_team_id")
            return dispatch_dict(db, prior, user)
        _db_conflict(exc)


def dispatch_status(items):
    statuses = {item.status for item in items}
    if statuses == {"voided"}:
        return "voided"
    active = statuses - {"voided"}
    if active in ({"received"}, {"dispatched"}):
        return next(iter(active))
    return "partial" if active & {"received", "dispatched"} else "pending"


def dispatch_dict(db, dispatch, user, *, items=None, include_history=False):
    from .material_dispatch_workflow import revision, allowed_actions
    if items is None:
        # This branch is used by write/replay transactions. A waiter can have
        # an older REPEATABLE READ snapshot than the newly committed header;
        # its lines must also use a current read, never an empty old snapshot.
        items = db.scalars(select(MaterialTransfer).options(lazyload("*")).where(
            MaterialTransfer.dispatch_id == dispatch.id
        ).order_by(MaterialTransfer.id).with_for_update().execution_options(populate_existing=True)).all()
        # A creation retry can have read the header before batch confirmation
        # committed. Refresh its confirmation metadata after the line locks.
        dispatch = db.scalar(select(MaterialDispatch).where(MaterialDispatch.id == dispatch.id)
                             .with_for_update().execution_options(populate_existing=True))
    if dispatch.dispatch_no is None:
        # This is a retry ledger, not a business document or a second batch identity.
        return {"items": [workflow.material_transfer_dict(item, user, include_history=include_history) for item in items]}
    source_record = workflow.material_transfer_dict(items[0], user, include_history=False)["source_team"] if items else None
    return {
        "id": dispatch.id, "barcode_payload": dispatch.dispatch_no, "barcode_type": "CODE128",
        "source_team": source_record, "revision": revision(dispatch, items),
        "pending_line_count": sum(item.status == "pending" for item in items),
        "allowed_actions": allowed_actions(dispatch, items, user),
        "locked": not any(item.status == "pending" for item in items),
        "confirmed_by": dispatch.confirmed_by, "confirmed_by_user_id": dispatch.confirmed_by_user_id,
        "confirmed_at": workflow._utc(dispatch.confirmed_at),
        "dispatch_no": dispatch.dispatch_no, "source_team_id": dispatch.source_team_id,
        "entry_kind": dispatch.entry_kind, "external_destination": dispatch.external_destination,
        "next_team": {"id": dispatch.next_team_id, "code": dispatch.next_team_code,
                      "name": dispatch.next_team_name, "kind": items[0].next_team.kind if items and items[0].next_team else None} if dispatch.next_team_id is not None else None,
        "created_by": dispatch.created_by, "created_at": workflow._utc(dispatch.created_at),
        "notes": dispatch.notes, "status": dispatch_status(items),
        "total_quantity": sum(item.quantity for item in items if item.status != "voided"),
        "total_weight": float(sum((item.weight for item in items if item.status != "voided"), Decimal(0))),
        "line_count": len(items), "items": [workflow.material_transfer_dict(item, user, include_history=include_history) for item in items],
    }


def stock_table(team_id=None):
    """Every pending outbound has already left source inventory.

    reserved retains all pending outbound amounts for compatibility; it is not
    stock to deduct again. Only internal handoffs count as in_transit.
    """
    allocations = select(MaterialTransfer.source_transfer_id.label("lot_id"), *[
        func.sum(case((predicate, getattr(MaterialTransfer, amount)), else_=0)).label(f"{prefix}_{amount}")
        for predicate, prefix in (
            (MaterialTransfer.status == "pending", "reserved"),
            ((MaterialTransfer.status == "pending") & (MaterialTransfer.entry_kind == "transfer"), "in_transit"),
            (MaterialTransfer.status.in_(["received", "dispatched"]), "dispatched"))
        for amount in ("quantity", "weight")
    ]).where(MaterialTransfer.source_team_id == team_id if team_id is not None else True, MaterialTransfer.source_transfer_id.is_not(None)).group_by(MaterialTransfer.source_transfer_id).subquery()
    losses = select(MaterialLoss.source_transfer_id.label("lot_id"),
                    func.sum(MaterialLoss.quantity).label("lost_quantity"),
                    func.sum(MaterialLoss.weight).label("lost_weight")).where(MaterialLoss.team_id == team_id if team_id is not None else True).group_by(MaterialLoss.source_transfer_id).subquery()
    columns = {}
    for amount in ("quantity", "weight"):
        columns[f"received_{amount}"] = getattr(MaterialTransfer, amount)
        for prefix, aggregate in (("reserved", allocations), ("in_transit", allocations), ("dispatched", allocations), ("lost", losses)):
            columns[f"{prefix}_{amount}"] = func.coalesce(aggregate.c[f"{prefix}_{amount}"], 0)
        settled = columns[f"received_{amount}"] - columns[f"dispatched_{amount}"] - columns[f"lost_{amount}"]
        columns[f"on_hand_{amount}"] = settled - columns[f"reserved_{amount}"]
        free = columns[f"on_hand_{amount}"]
        if amount == "weight":
            free = func.round(free, 3)
        scrap = MaterialTransfer.material_type.in_(SCRAP_MATERIAL_TYPES)
        columns[f"available_{amount}"] = case((scrap, 0), else_=free)
        columns[f"scrap_{amount}"] = case((scrap, columns[f"on_hand_{amount}"]), else_=0)
        columns[f"scrap_available_{amount}"] = case((scrap, free), else_=0)
    return select(MaterialTransfer.id.label("transfer_id"), MaterialTransfer.next_team_id.label("team_id"),
                  MaterialTransfer.batch_no, MaterialTransfer.serial_no, MaterialTransfer.material_name,
                  MaterialTransfer.material_type, MaterialTransfer.source_batch_no, MaterialTransfer.received_at,
                  *(value.label(key) for key, value in columns.items())).outerjoin(
        allocations, allocations.c.lot_id == MaterialTransfer.id
    ).outerjoin(losses, losses.c.lot_id == MaterialTransfer.id).where(
        MaterialTransfer.next_team_id == team_id if team_id is not None else True, MaterialTransfer.status == "received", MaterialTransfer.stock_tracked.is_(True)
    ).subquery()


BALANCE_KEYS = tuple(f"{prefix}_{amount}" for prefix in ("received", "dispatched", "reserved", "in_transit", "lost", "on_hand", "available", "scrap", "scrap_available") for amount in ("quantity", "weight"))


def balance_dict(row):
    return {key: round(float(row[key] or 0), 3) if key.endswith("weight") else int(row[key] or 0) for key in BALANCE_KEYS}


def literal_query(query, columns):
    escaped = query.strip().replace("!", "!!").replace("%", "!%").replace("_", "!_")
    return or_(*(column.like(f"%{escaped}%", escape="!") for column in columns))


def list_stock(db, team_id, user, *, record_filters=None, query=None, serial_no=None, material_type=None, availability="available", page=1, page_size=20):
    from .record_filters import RecordFilters
    require_team(db, team_id)
    stock = stock_table(team_id)
    filters = [stock.c.team_id == team_id]
    filters.extend((record_filters or RecordFilters()).predicates(stock.c.received_at, stock.c.serial_no))
    if serial_no is not None:
        filters.append(stock.c.serial_no == serial_no.strip())
    if availability == "available":
        filters.append(or_(stock.c.available_quantity > 0, stock.c.available_weight > 0))
    elif availability == "dispatchable":
        filters.append(or_(stock.c.available_quantity > 0, stock.c.available_weight > 0, stock.c.scrap_available_quantity > 0, stock.c.scrap_available_weight > 0))
    if material_type:
        filters.append(stock.c.material_type == material_type)
    if query and query.strip():
        filters.append(literal_query(query, [stock.c.batch_no, stock.c.serial_no, stock.c.material_name, stock.c.source_batch_no]))
    total = db.scalar(select(func.count()).select_from(stock).where(*filters)) or 0
    rows = db.execute(select(stock).where(*filters).order_by(stock.c.received_at.desc(), stock.c.transfer_id.desc()).offset((page-1)*page_size).limit(page_size)).mappings().all()
    transfers = {item.id: item for item in db.scalars(select(MaterialTransfer).where(MaterialTransfer.id.in_([row["transfer_id"] for row in rows]))).all()}
    return {"items": [{"transfer": workflow.material_transfer_dict(transfers[row["transfer_id"]], user, include_history=False), **balance_dict(row)} for row in rows],
            "total": total, "page": page, "page_size": page_size}


def overview(db, team_id):
    team = require_team(db, team_id)
    stock = stock_table(team_id)
    totals = db.execute(select(*(func.sum(stock.c[key]).label(key) for key in BALANCE_KEYS)).where(stock.c.team_id == team_id)).mappings().one()
    materials = db.execute(select(stock.c.material_name, *(func.sum(stock.c[key]).label(key) for key in BALANCE_KEYS)).where(
        stock.c.team_id == team_id
    ).group_by(stock.c.material_name).order_by(stock.c.material_name)).mappings().all()
    types = db.execute(select(stock.c.material_type, *(func.sum(stock.c[key]).label(key) for key in BALANCE_KEYS))
        .group_by(stock.c.material_type).order_by(stock.c.material_type)).mappings().all()
    pending = db.execute(select(func.count(MaterialTransfer.id), func.sum(MaterialTransfer.quantity), func.sum(MaterialTransfer.weight)).where(
        MaterialTransfer.next_team_id == team_id, MaterialTransfer.status == "pending"
    )).one()
    pending_batches = {}
    if team.code == WAREHOUSE_TEAM_CODE and team.kind == "warehouse":
        batch_key = MaterialTransfer.batch_no
        pending_batches["batch_count"] = db.scalar(select(func.count(func.distinct(batch_key))).where(
            MaterialTransfer.next_team_id == team_id, MaterialTransfer.status == "pending")) or 0
    legacy = db.scalar(select(func.count(MaterialTransfer.id)).where(MaterialTransfer.next_team_id == team_id,
        MaterialTransfer.status == "received", MaterialTransfer.stock_tracked.is_(False))) or 0
    return {"team_id": team_id, "totals": balance_dict(totals),
            "material_types": [{"material_type": row["material_type"], **balance_dict(row)} for row in types],
            "materials": [{"material_name": row["material_name"], **balance_dict(row)} for row in materials],
            "pending_incoming": {"count": pending[0], "quantity": int(pending[1] or 0), "weight": float(pending[2] or 0), **pending_batches},
            "legacy_received_count": legacy}


def list_losses(db, team_id, *, record_filters=None, query=None, serial_no=None, source_transfer_id=None, page=1, page_size=20):
    from .record_filters import RecordFilters, urgent_serials
    require_team(db, team_id)
    filters = [MaterialLoss.team_id == team_id]
    record_filters = record_filters or RecordFilters()
    filters.extend(record_filters.dates(MaterialLoss.created_at))
    if record_filters.urgent_only:
        filters.append(MaterialLoss.source_transfer_id.in_(select(MaterialTransfer.id).where(MaterialTransfer.serial_no.in_(urgent_serials()))))
    if serial_no is not None:
        filters.append(MaterialLoss.source_transfer_id.in_(select(MaterialTransfer.id).where(MaterialTransfer.serial_no == serial_no.strip())))
    if source_transfer_id:
        filters.append(MaterialLoss.source_transfer_id == source_transfer_id)
    if query and query.strip():
        ids = select(MaterialTransfer.id).where(literal_query(query, [MaterialTransfer.batch_no, MaterialTransfer.serial_no, MaterialTransfer.material_name]))
        filters.append(MaterialLoss.source_transfer_id.in_(ids))
    total = db.scalar(select(func.count(MaterialLoss.id)).where(*filters)) or 0
    rows = db.scalars(select(MaterialLoss).where(*filters).order_by(MaterialLoss.created_at.desc(), MaterialLoss.id.desc()).offset((page-1)*page_size).limit(page_size)).all()
    return {"items": [workflow.material_loss_dict(row) for row in rows], "total": total, "page": page, "page_size": page_size}


def list_outbound_batches(db, team_id, user, *, record_filters, query=None, next_team_id=None, status=None, entry_kind=None, material_type=None, page=1, page_size=20):
    require_team(db, team_id)
    mt = MaterialTransfer
    filters = [mt.source_team_id == team_id, mt.entry_kind != "warehouse_receipt",
               *record_filters.predicates(mt.created_at, mt.serial_no)]
    for column, value in ((mt.next_team_id, next_team_id), (mt.status, status), (mt.entry_kind, entry_kind), (mt.material_type, material_type)):
        if value is not None:
            filters.append(column == value)
    if query and query.strip():
        filters.append(literal_query(query, [mt.batch_no, mt.serial_no, mt.material_name, mt.external_destination]))
    total = db.scalar(select(func.count(mt.id)).where(*filters)) or 0
    items = db.scalars(select(mt).where(*filters).order_by(mt.created_at.desc(), mt.id.desc())
                       .offset((page - 1) * page_size).limit(page_size)).all()
    return {"items": [workflow.material_transfer_dict(item, user, include_history=False) for item in items],
            "total": total, "page": page, "page_size": page_size}


def list_dispatches(db, team_id, user, *, record_filters=None, query=None, next_team_id=None, status=None, entry_kind=None, page=1, page_size=20):
    from .record_filters import RecordFilters, urgent_serials
    record_filters = record_filters or RecordFilters()
    require_team(db, team_id)
    mt = MaterialTransfer
    # Union is only the lightweight page index; line details are fetched for
    # that page, not grouped after pagination in the browser.
    statuses = case(
        (func.sum(case((mt.status != "voided", 1), else_=0)) == 0, "voided"),
        ((func.sum(case((mt.status == "pending", 1), else_=0)) == 0) & (func.sum(case((mt.status == "dispatched", 1), else_=0)) > 0), "dispatched"),
        (func.sum(case((mt.status == "pending", 1), else_=0)) == 0, "received"),
        (func.sum(case((mt.status.in_(["received", "dispatched"]), 1), else_=0)) > 0, "partial"),
        else_="pending")
    grouped = select(MaterialDispatch.id.label("group_id"), literal(None).label("single_id"),
        MaterialDispatch.dispatch_no.label("dispatch_no"), MaterialDispatch.created_at.label("created_at"),
        MaterialDispatch.next_team_id.label("next_team_id"), statuses.label("status")
    ).join(mt, mt.dispatch_id == MaterialDispatch.id).where(MaterialDispatch.source_team_id == team_id, MaterialDispatch.dispatch_no.is_not(None)).group_by(
        MaterialDispatch.id, MaterialDispatch.dispatch_no, MaterialDispatch.created_at, MaterialDispatch.next_team_id)
    singles = select(literal(None).label("group_id"), mt.id.label("single_id"), mt.batch_no.label("dispatch_no"),
        mt.created_at.label("created_at"), mt.next_team_id.label("next_team_id"), mt.status.label("status")
    ).outerjoin(MaterialDispatch, mt.dispatch_id == MaterialDispatch.id).where(mt.source_team_id == team_id, MaterialDispatch.dispatch_no.is_(None))
    if entry_kind:
        grouped = grouped.where(MaterialDispatch.entry_kind == entry_kind)
        singles = singles.where(mt.entry_kind == entry_kind)
    if query and query.strip():
        matching_groups = select(mt.dispatch_id).where(mt.source_team_id == team_id, literal_query(query, [mt.batch_no, mt.serial_no, mt.material_name]))
        grouped = grouped.where(or_(literal_query(query, [MaterialDispatch.dispatch_no, MaterialDispatch.external_destination]), MaterialDispatch.id.in_(matching_groups)))
        singles = singles.where(literal_query(query, [mt.batch_no, mt.serial_no, mt.material_name]))
    grouped = grouped.where(*record_filters.dates(MaterialDispatch.created_at))
    singles = singles.where(*record_filters.dates(mt.created_at))
    if record_filters.urgent_only:
        matching = select(mt.dispatch_id).where(mt.serial_no.in_(urgent_serials()), mt.status != "voided")
        grouped = grouped.where(MaterialDispatch.id.in_(matching))
        singles = singles.where(mt.serial_no.in_(urgent_serials()), mt.status != "voided")
    index = union_all(grouped, singles).subquery()
    filters = []
    if next_team_id:
        filters.append(index.c.next_team_id == next_team_id)
    if status:
        filters.append(index.c.status == status)
    total = db.scalar(select(func.count()).select_from(index).where(*filters)) or 0
    rows = db.execute(select(index).where(*filters).order_by(index.c.created_at.desc(), index.c.dispatch_no.desc()).offset((page-1)*page_size).limit(page_size)).mappings().all()
    group_ids = [row["group_id"] for row in rows if row["group_id"] is not None]
    single_ids = [row["single_id"] for row in rows if row["single_id"] is not None]
    groups = {group.id: group for group in db.scalars(select(MaterialDispatch).where(MaterialDispatch.id.in_(group_ids))).all()}
    transfers = db.scalars(select(mt).where(or_(mt.dispatch_id.in_(group_ids), mt.id.in_(single_ids))).order_by(mt.id)).all()
    items = []
    for row in rows:
        if row["group_id"] is not None:
            items.append(dispatch_dict(db, groups[row["group_id"]], user, items=[item for item in transfers if item.dispatch_id == row["group_id"]]))
        else:
            item = next(item for item in transfers if item.id == row["single_id"])
            record = workflow.material_transfer_dict(item, user, include_history=False)
            items.append({"dispatch_no": item.batch_no, "source_team_id": team_id, "next_team": record["next_team"],
                "entry_kind": item.entry_kind, "external_destination": item.external_destination,
                "created_by": item.created_by, "created_at": record["created_at"], "notes": item.notes, "status": item.status,
                "total_quantity": 0 if item.status == "voided" else item.quantity,
                "total_weight": 0 if item.status == "voided" else float(item.weight), "line_count": 1, "items": [record]})
    return {"items": items, "total": total, "page": page, "page_size": page_size}
