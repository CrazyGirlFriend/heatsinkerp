"""Transactional, process-independent material handoffs between teams."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import joinedload, lazyload, raiseload
from sqlalchemy.orm.attributes import set_committed_value

from .auth import actor_name
from .batch_numbers import next_transfer_batch_number
from .models import MaterialDispatch, MaterialTransfer, MaterialTransferEvent, Team, User, utcnow
from .schemas import MaterialTransferDocumentFields, SCRAP_MATERIAL_TYPES
from .team_constants import EXTERNAL_ENTRY_KINDS


DOCUMENT_FIELDS = tuple(MaterialTransferDocumentFields.model_fields)
AUDITED_FIELDS = DOCUMENT_FIELDS + (
    "batch_no", "serial_no", "source_team_id", "source_team_code", "source_team_name",
    "next_team_id", "next_team_code", "next_team_name", "quantity", "weight", "notes",
    "status", "version", "created_by", "created_at", "received_by", "received_at",
    "voided_by", "voided_at",
    "source_transfer_id", "dispatch_id", "stock_tracked", "entry_kind",
    "external_destination", "dispatched_by", "dispatched_at",
    "receipt_kind", "external_source", "return_dispatch_no", "rejection_reason",
    "purpose_id", "purpose_name", "opening_stock_id",
)


def _creation_fingerprint(payload) -> str:
    # Preserve pre-upgrade idempotency hashes when optional fields are absent.
    value = payload.model_dump(mode="json", exclude={"idempotency_key"})
    for field in ("receipt_kind", "external_source", "return_dispatch_no", "purpose_id"):
        if field not in payload.model_fields_set:
            value.pop(field, None)
    for field in DOCUMENT_FIELDS:
        if value.get(field) is None:
            value.pop(field, None)
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def _snapshot(transfer: MaterialTransfer) -> dict[str, Any]:
    result = {}
    for field in AUDITED_FIELDS:
        value = getattr(transfer, field)
        if isinstance(value, Decimal):
            value = float(value)
        elif isinstance(value, datetime):
            value = _utc(value).isoformat()
        result[field] = value
    return result


def _record_event(db, transfer, user, action, before=None) -> None:
    previous = before or {}
    changes = {
        field: {"before": previous.get(field), "after": value}
        for field, value in _snapshot(transfer).items()
        if previous.get(field) != value
    }
    transfer.history.append(MaterialTransferEvent(
        action=action, actor=actor_name(user), actor_user_id=user.id,
        occurred_at=transfer.updated_at, changes=changes,
    ))
    db.flush()


def _assert_version(transfer, payload) -> None:
    if payload.expected_version is not None and payload.expected_version != transfer.version:
        raise _conflict("material transfer has changed; refresh and review before continuing")


def _conflict(message: str) -> HTTPException:
    return HTTPException(409, message)


def _forbidden(message: str) -> HTTPException:
    return HTTPException(403, message)


def _utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _require_team_actor(user: User) -> Team:
    if user.role != "TEAM":
        raise _forbidden("team leader account required")
    if user.team is None or user.team_id is None or not user.team.active:
        raise _forbidden("current account must be bound to an active team")
    return user.team


def _active_target(db, team_id: int) -> Team:
    team = db.scalar(select(Team).where(Team.id == team_id).with_for_update())
    if team is None or not team.active:
        raise HTTPException(422, "next_team_id must reference an active team")
    return team


def _validate_warehouse_type(target: Team, material_type: str | None) -> None:
    if target.kind == "warehouse" and not material_type:
        raise HTTPException(422, "material_type is required for transfers into the warehouse")


def validate_material_route(source_type, material_type, target, entry_kind, notes):
    source_scrap, result_scrap = source_type in SCRAP_MATERIAL_TYPES, material_type in SCRAP_MATERIAL_TYPES
    if source_scrap and not result_scrap:
        raise HTTPException(422, "废料不能直接改为正常物料出库")
    if result_scrap:
        if entry_kind != "warehouse_outbound" and (target is None or target.kind != "warehouse"):
            raise HTTPException(422, "废料只能转入库房或由库房办理对外处理")
        if not (notes or "").strip():
            raise HTTPException(422, "请填写转废或废料处理原因")


def _locked_transfer(db, batch_no: str) -> MaterialTransfer:
    source_id = db.scalar(select(MaterialTransfer.source_transfer_id).where(MaterialTransfer.batch_no == batch_no))
    if source_id is not None:
        # Lock the received source before the outbound line, like new dispatch
        # and loss creation. Deductions later use current/locking reads.
        from .material_stock import lock_lot
        lock_lot(db, source_id)
    transfer = db.scalar(
        select(MaterialTransfer)
        .options(lazyload("*"))
        .where(MaterialTransfer.batch_no == batch_no)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if transfer is None:
        raise HTTPException(404, "material transfer not found")
    return transfer


def _assert_source(user: User, transfer: MaterialTransfer) -> None:
    team = _require_team_actor(user)
    if team.id != transfer.source_team_id:
        raise _forbidden("only the source team can change this transfer")


def _assert_receiver(user: User, transfer: MaterialTransfer) -> None:
    team = _require_team_actor(user)
    if team.id != transfer.next_team_id:
        raise _forbidden("only the target team can confirm this transfer")


def material_transfer_allowed_actions(
    transfer: MaterialTransfer, user: User | None
) -> list[str]:
    if user is None or user.role != "TEAM" or transfer.status != "pending":
        return []
    if user.team_id == transfer.source_team_id:
        return ["edit", "void", "confirm_outbound"] if transfer.entry_kind in EXTERNAL_ENTRY_KINDS else ["edit", "void"]
    if user.team_id == transfer.next_team_id:
        return (["reject"] if transfer.next_team and transfer.next_team.kind == "warehouse" else []) if transfer.rejection_reason else ["confirm", *(["reject"] if transfer.next_team and transfer.next_team.kind == "warehouse" else [])]
    return []


def material_loss_dict(loss):
    from .serial_urgency import urgency_dict
    source = loss.source_transfer
    return {
        "id": loss.id, "loss_no": loss.loss_no, "team_id": loss.team_id,
        "source_transfer_id": loss.source_transfer_id, "batch_no": source.batch_no,
        "serial_no": source.serial_no, "material_name": source.material_name,
        "urgency": urgency_dict(source.urgency),
        "quantity": loss.quantity, "weight": float(loss.weight), "reason": loss.reason,
        "created_by": loss.created_by, "created_at": _utc(loss.created_at),
    }


def material_transfer_list_options():
    # Lists need only the immediate source's identity, not its own relationships.
    # All joins are scalar/unique, so they preserve page limits and row counts.
    return (
        joinedload(MaterialTransfer.urgency),
        joinedload(MaterialTransfer.stock_source).load_only(MaterialTransfer.batch_no).raiseload("*"),
        joinedload(MaterialTransfer.dispatch).load_only(MaterialDispatch.dispatch_no),
        raiseload(MaterialTransfer.history),
        raiseload(MaterialTransfer.losses),
    )


def material_transfer_dict(
    transfer: MaterialTransfer, user: User | None = None, *, include_history: bool = True
) -> dict[str, Any]:
    from .serial_urgency import urgency_dict
    locked_at = transfer.received_at or transfer.dispatched_at or transfer.voided_at
    return {
        "id": transfer.id,
        "batch_no": transfer.batch_no,
        "barcode_payload": transfer.batch_no,
        "barcode_type": "CODE128",
        "serial_no": transfer.serial_no,
        "urgency": urgency_dict(transfer.urgency),
        "entry_kind": transfer.entry_kind,
        "purpose_id": transfer.purpose_id,
        "purpose_name": transfer.purpose_name,
        "external_destination": transfer.external_destination,
        "receipt_kind": transfer.receipt_kind,
        "external_source": transfer.external_source,
        "return_dispatch_no": transfer.return_dispatch_no,
        "rejection_reason": transfer.rejection_reason,
        **{field: getattr(transfer, field) for field in DOCUMENT_FIELDS},
        "version": transfer.version,
        "stock_tracked": transfer.stock_tracked,
        "source_transfer_id": transfer.source_transfer_id,
        "source_transfer_batch_no": transfer.stock_source.batch_no if transfer.source_transfer_id else None,
        "dispatch_no": transfer.dispatch.dispatch_no if transfer.dispatch_id else None,
        "loss_records": [material_loss_dict(loss) for loss in transfer.losses] if include_history else [],
        "history": [
            {"id": event.id, "action": event.action, "actor": event.actor,
             "occurred_at": _utc(event.occurred_at), "changes": event.changes}
            for event in transfer.history
        ] if include_history else [],
        "source_team_id": transfer.source_team_id,
        "source_team": {
            "id": transfer.source_team_id,
            "code": transfer.source_team_code,
            "name": transfer.source_team_name,
            "kind": transfer.source_team.kind if transfer.source_team is not None else None,
        } if transfer.source_team_id is not None else None,
        "next_team_id": transfer.next_team_id,
        "next_team": {
            "id": transfer.next_team_id,
            "code": transfer.next_team_code,
            "name": transfer.next_team_name,
            "kind": transfer.next_team.kind if transfer.next_team is not None else None,
        } if transfer.next_team_id is not None else None,
        "quantity": transfer.quantity,
        "quantity_unit": "件",
        "weight": float(transfer.weight),
        "weight_unit": "kg",
        "status": transfer.status,
        "notes": transfer.notes,
        "created_by": transfer.created_by,
        "created_by_user_id": transfer.created_by_user_id,
        "created_at": _utc(transfer.created_at),
        "updated_at": _utc(transfer.updated_at),
        "received_by": transfer.received_by,
        "received_by_user_id": transfer.received_by_user_id,
        "received_at": _utc(transfer.received_at),
        "dispatched_by": transfer.dispatched_by,
        "dispatched_by_user_id": transfer.dispatched_by_user_id,
        "dispatched_at": _utc(transfer.dispatched_at),
        "voided_by": transfer.voided_by,
        "voided_by_user_id": transfer.voided_by_user_id,
        "voided_at": _utc(transfer.voided_at),
        "locked": transfer.status != "pending",
        "locked_at": _utc(locked_at),
        "allowed_actions": material_transfer_allowed_actions(transfer, user),
    }


def create_material_transfer(db, payload, user: User) -> dict[str, Any]:
    from .team_business import purpose_snapshot
    source = _require_team_actor(user)
    request_hash = _creation_fingerprint(payload)
    try:
        with db.begin():
            if payload.idempotency_key:
                prior = db.scalar(
                    select(MaterialTransfer)
                    .where(MaterialTransfer.idempotency_key == payload.idempotency_key)
                    .with_for_update()
                )
                if prior is not None:
                    if prior.source_team_id != source.id:
                        raise _forbidden("idempotency key belongs to another source team")
                    if prior.request_hash != request_hash:
                        raise _conflict("idempotency key was used with a different payload")
                    return material_transfer_dict(prior, user)

            target = _active_target(db, payload.next_team_id)
            if target.id == source.id:
                raise HTTPException(422, "source and target teams must be different")
            _validate_warehouse_type(target, payload.material_type)
            validate_material_route(None, payload.material_type, target, "transfer", payload.notes)
            transfer = MaterialTransfer(
                batch_no=next_transfer_batch_number(db),
                **purpose_snapshot(db, target.id, payload.purpose_id),
                serial_no=payload.serial_no,
                **{field: getattr(payload, field) for field in DOCUMENT_FIELDS},
                source_team_id=source.id,
                source_team_code=source.code,
                source_team_name=source.name,
                next_team_id=target.id,
                next_team_code=target.code,
                next_team_name=target.name,
                quantity=payload.quantity,
                weight=payload.weight,
                status="pending",
                notes=payload.notes,
                idempotency_key=payload.idempotency_key,
                request_hash=request_hash,
                created_by=actor_name(user),
                created_by_user_id=user.id,
            )
            db.add(transfer)
            db.flush()
            _record_event(db, transfer, user, "created")
            result = material_transfer_dict(transfer, user)
        return result
    except IntegrityError as exc:
        db.rollback()
        if payload.idempotency_key:
            prior = db.scalar(
                select(MaterialTransfer).where(
                    MaterialTransfer.idempotency_key == payload.idempotency_key
                )
            )
            if (
                prior is not None
                and prior.source_team_id == source.id
                and prior.request_hash == request_hash
            ):
                return material_transfer_dict(prior, user)
        raise _conflict("duplicate material-transfer number or idempotency key") from exc


def get_material_transfer(db, batch_no: str, user: User) -> dict[str, Any]:
    transfer = db.scalar(
        select(MaterialTransfer).where(MaterialTransfer.batch_no == batch_no)
    )
    if transfer is None:
        raise HTTPException(404, "material transfer not found")
    return material_transfer_dict(transfer, user)


def update_material_transfer(db, batch_no: str, payload, user: User) -> dict[str, Any]:
    with db.begin():
        transfer = _locked_transfer(db, batch_no)
        _assert_source(user, transfer)
        if transfer.status != "pending":
            raise _conflict("confirmed or voided transfer is permanently locked")
        _assert_version(transfer, payload)
        before = _snapshot(transfer)
        supplied = payload.model_fields_set
        quantity = payload.quantity if "quantity" in supplied else transfer.quantity
        weight = payload.weight if "weight" in supplied else transfer.weight
        if quantity == 0 and weight == 0:
            raise HTTPException(422, "quantity or weight must be positive")
        if transfer.source_transfer_id is not None:
            from .material_stock import validate_available
            for field in ("serial_no", "material_name"):
                if field in supplied and getattr(payload, field) != getattr(transfer, field):
                    raise HTTPException(422, "stock-linked transfers must retain their source serial number and material")
            if "next_team_id" in supplied and payload.next_team_id != transfer.next_team_id:
                raise HTTPException(422, "a stock-linked batch's destination cannot be changed; void this batch and recreate")
            validate_available(db, transfer.stock_source, quantity, weight, exclude_transfer_id=transfer.id)
        target = transfer.next_team
        if "next_team_id" in supplied:
            target = _active_target(db, payload.next_team_id)
            if target.id == transfer.source_team_id:
                raise HTTPException(422, "source and target teams must be different")
        if target is not None and ("next_team_id" in supplied or "material_type" in supplied):
            material_type = payload.material_type if "material_type" in supplied else transfer.material_type
            _validate_warehouse_type(target, material_type)
        validate_material_route(transfer.stock_source.material_type if transfer.source_transfer_id else None,
            payload.material_type if "material_type" in supplied else transfer.material_type, target, transfer.entry_kind,
            payload.notes if "notes" in supplied else transfer.notes)
        if "next_team_id" in supplied:
            transfer.next_team_id = target.id
            transfer.next_team_code = target.code
            transfer.next_team_name = target.name
            transfer.next_team = target
        if "purpose_id" in supplied or ("next_team_id" in supplied and before["next_team_id"] != target.id):
            from .team_business import purpose_snapshot
            if target is not None:
                _active_target(db, target.id)
            # Keeping a historical/disabled selection preserves its snapshot.
            if payload.purpose_id != transfer.purpose_id or before["next_team_id"] != transfer.next_team_id:
                purpose = purpose_snapshot(db, target.id if target else None, payload.purpose_id)
                transfer.purpose_id, transfer.purpose_name = purpose["purpose_id"], purpose["purpose_name"]
        for field in ("serial_no", "quantity", "weight", "notes", *DOCUMENT_FIELDS):
            if field in supplied:
                setattr(transfer, field, getattr(payload, field))
        if _snapshot(transfer) != before:
            transfer.rejection_reason = None
            transfer.version += 1
            transfer.updated_at = utcnow()
            db.flush()
            _record_event(db, transfer, user, "updated", before)
        result = material_transfer_dict(transfer, user)
    return result


def void_material_transfer(db, batch_no: str, user: User) -> None:
    with db.begin():
        transfer = _locked_transfer(db, batch_no)
        _assert_source(user, transfer)
        if transfer.status != "pending":
            raise _conflict("only a pending transfer can be voided")
        before = _snapshot(transfer)
        now = utcnow()
        transfer.status = "voided"
        transfer.voided_by = actor_name(user)
        transfer.voided_by_user_id = user.id
        transfer.voided_at = now
        transfer.updated_at = now
        transfer.version += 1
        db.flush()
        _record_event(db, transfer, user, "voided", before)


def confirm_material_transfer(db, batch_no: str, payload, user: User) -> dict[str, Any]:
    try:
        with db.begin():
            transfer = _locked_transfer(db, batch_no)
            _assert_receiver(user, transfer)
            if (
                transfer.status == "received"
                and transfer.receipt_idempotency_key == payload.idempotency_key
            ):
                return material_transfer_dict(transfer, user)
            key_owner = db.scalar(
                select(MaterialTransfer.id).where(
                    MaterialTransfer.receipt_idempotency_key == payload.idempotency_key
                )
            )
            if key_owner is not None and key_owner != transfer.id:
                raise _conflict("idempotency key was used for another receipt")
            if transfer.status != "pending":
                raise _conflict("only a pending transfer can be confirmed")
            _assert_version(transfer, payload)
            if transfer.rejection_reason:
                raise _conflict("该明细已退回核对，须上序修改后再接收")
            _active_target(db, transfer.next_team_id)  # Serialize initial stock and first receipt.
            validate_material_route(transfer.stock_source.material_type if transfer.source_transfer_id else None,
                transfer.material_type, transfer.next_team, transfer.entry_kind, transfer.notes)
            before = _snapshot(transfer)
            now = utcnow()
            transfer.status = "received"
            transfer.stock_tracked = True
            transfer.received_by = actor_name(user)
            transfer.received_by_user_id = user.id
            transfer.receipt_idempotency_key = payload.idempotency_key
            transfer.received_at = now
            transfer.updated_at = now
            transfer.version += 1
            db.flush()
            _record_event(db, transfer, user, "received", before)
            result = material_transfer_dict(transfer, user)
        return result
    except IntegrityError as exc:
        db.rollback()
        transfer = db.scalar(
            select(MaterialTransfer).where(MaterialTransfer.batch_no == batch_no)
        )
        if (
            transfer is not None
            and transfer.next_team_id == user.team_id
            and transfer.status == "received"
            and transfer.receipt_idempotency_key == payload.idempotency_key
        ):
            return material_transfer_dict(transfer, user)
        raise _conflict("duplicate receipt idempotency key") from exc


def reject_material_transfer(db, batch_no, payload, user):
    with db.begin():
        transfer = _locked_transfer(db, batch_no)
        _assert_receiver(user, transfer)
        if user.team.kind != "warehouse" or transfer.status != "pending":
            raise _conflict("仅库房可退回待接收明细，已接收单据不能修改")
        if transfer.rejection_reason == payload.reason and transfer.version == payload.expected_version + 1:
            return material_transfer_dict(transfer, user)
        _assert_version(transfer, payload)
        before = _snapshot(transfer)
        transfer.rejection_reason = payload.reason
        transfer.version += 1
        transfer.updated_at = utcnow()
        db.flush()
        db.refresh(transfer, attribute_names=["updated_at"])
        _record_event(db, transfer, user, "rejected", before)
        return material_transfer_dict(transfer, user)


def confirm_outbound(db, batch_no: str, payload, user: User) -> dict[str, Any]:
    """Finalize external stock leaving the loop; never manufacture a receipt lot."""
    from .material_stock import require_outbound_actor, _db_conflict
    try:
        with db.begin():
            transfer = _locked_transfer(db, batch_no)
            require_outbound_actor(user, transfer.source_team_id, transfer.entry_kind)
            # The source lookup can establish a REPEATABLE READ snapshot
            # before waiting for a concurrent confirmer. Load its audit with
            # a current read too, so an idempotent reply includes that event.
            events = db.scalars(select(MaterialTransferEvent).where(
                MaterialTransferEvent.transfer_id == transfer.id
            ).order_by(MaterialTransferEvent.id).with_for_update().execution_options(populate_existing=True)).all()
            set_committed_value(transfer, "history", events)
            if transfer.status == "dispatched" and transfer.outbound_idempotency_key == payload.idempotency_key:
                return material_transfer_dict(transfer, user)
            if transfer.status != "pending":
                raise _conflict("only a pending external outbound can be confirmed")
            _assert_version(transfer, payload)
            validate_material_route(transfer.stock_source.material_type if transfer.source_transfer_id else None,
                                    transfer.material_type, None, transfer.entry_kind, transfer.notes)
            before = _snapshot(transfer)
            now = utcnow()
            transfer.status = "dispatched"
            transfer.dispatched_by = actor_name(user)
            transfer.dispatched_by_user_id = user.id
            transfer.dispatched_at = now
            transfer.outbound_idempotency_key = payload.idempotency_key
            transfer.updated_at = now
            transfer.version += 1
            db.flush()
            # Read MySQL's persisted second precision before the audit/response.
            db.refresh(transfer, attribute_names=["dispatched_at", "updated_at"])
            _record_event(db, transfer, user, "dispatched", before)
            result = material_transfer_dict(transfer, user)
        return result
    except (IntegrityError, OperationalError) as exc:
        db.rollback()
        _db_conflict(exc)
