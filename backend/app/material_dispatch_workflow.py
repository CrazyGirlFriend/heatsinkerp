"""Read/confirm one CK batch atomically, keeping every source and audit line."""
from __future__ import annotations

import hashlib
import json

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import lazyload
from sqlalchemy.orm.attributes import set_committed_value

from .auth import actor_name
from .models import MaterialDispatch, MaterialTransfer, MaterialTransferEvent, utcnow
from .team_constants import EXTERNAL_ENTRY_KINDS
from . import material_stock as stock
from . import material_transfer_workflow as workflow


class DispatchConfirm(BaseModel):
    model_config = ConfigDict(extra="forbid")
    idempotency_key: str = Field(min_length=1, max_length=100)
    expected_revision: str = Field(pattern="^[a-f0-9]{64}$")

    @field_validator("idempotency_key")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("idempotency_key cannot be blank")
        return value


def revision(dispatch, items):
    # Every supported line mutation increments version; include identity and
    # status too so no reviewed line may be silently skipped or substituted.
    value = [dispatch.dispatch_no, [[item.id, item.version, item.status] for item in sorted(items, key=lambda item: item.id)]]
    return hashlib.sha256(json.dumps(value, separators=(",", ":")).encode()).hexdigest()


def allowed_actions(dispatch, items, user):
    if user is None or user.role != "TEAM" or not user.team or not user.team.active or not any(item.status == "pending" for item in items):
        return []
    if dispatch.entry_kind in EXTERNAL_ENTRY_KINDS:
        try:
            stock.require_outbound_actor(user, dispatch.source_team_id, dispatch.entry_kind)
        except HTTPException:
            return []
        return ["confirm_outbound"]
    return ["confirm"] if user.team_id == dispatch.next_team_id else []


def get_dispatch(db, dispatch_no, user):
    dispatch = db.scalar(select(MaterialDispatch).where(MaterialDispatch.dispatch_no == dispatch_no))
    if dispatch is None:
        raise HTTPException(404, "material dispatch batch not found")
    items = db.scalars(select(MaterialTransfer).where(MaterialTransfer.dispatch_id == dispatch.id).order_by(MaterialTransfer.id)).all()
    return stock.dispatch_dict(db, dispatch, user, items=items, include_history=True)


def confirm_dispatch(db, dispatch_no, payload, user, *, external=False):
    try:
        with db.begin():
            group = db.scalar(select(MaterialDispatch).where(MaterialDispatch.dispatch_no == dispatch_no))
            if group is None:
                raise HTTPException(404, "material dispatch batch not found")
            _require_confirmer(group, user, external)
            # All mutations follow source -> line order. Never lock a group
            # first and then wait for its sources (a child edit does the reverse).
            source_ids = db.scalars(select(MaterialTransfer.source_transfer_id).where(MaterialTransfer.dispatch_id == group.id)).all()
            if not source_ids or any(item is None for item in source_ids):
                raise HTTPException(409, "batch source linkage is incomplete")
            for source_id in sorted(set(source_ids)):
                stock.lock_lot(db, source_id, group.source_team_id)
            items = db.scalars(select(MaterialTransfer).options(lazyload("*")).where(
                MaterialTransfer.dispatch_id == group.id
            ).order_by(MaterialTransfer.id).with_for_update().execution_options(populate_existing=True)).all()
            group = db.scalar(select(MaterialDispatch).where(MaterialDispatch.id == group.id)
                              .with_for_update().execution_options(populate_existing=True))
            _require_confirmer(group, user, external)
            # A concurrent waiter must also see the newly committed audit,
            # rather than replaying a current header with stale history.
            events = db.scalars(select(MaterialTransferEvent).where(
                MaterialTransferEvent.transfer_id.in_([item.id for item in items])
            ).order_by(MaterialTransferEvent.id).with_for_update().execution_options(populate_existing=True)).all()
            for item in items:
                set_committed_value(item, "history", [event for event in events if event.transfer_id == item.id])
            if group.confirmation_idempotency_key is not None:
                if group.confirmation_idempotency_key != payload.idempotency_key or group.confirmed_revision != payload.expected_revision:
                    raise HTTPException(409, "batch was already confirmed with a different request")
                return stock.dispatch_dict(db, group, user, items=items, include_history=True)
            if revision(group, items) != payload.expected_revision:
                raise HTTPException(409, "batch contents changed; refresh and review the complete batch")
            pending = [item for item in items if item.status == "pending"]
            if not pending:
                raise HTTPException(409, "batch has no pending lines to confirm")
            expected_done = "dispatched" if external else "received"
            for item in items:
                if (item.source_team_id != group.source_team_id or item.next_team_id != group.next_team_id
                    or item.entry_kind != group.entry_kind or item.external_destination != group.external_destination
                    or item.status not in ("pending", "voided", expected_done)):
                    raise HTTPException(409, "batch line destination or state is inconsistent")
            now = utcnow()
            group.confirmation_idempotency_key = payload.idempotency_key
            group.confirmed_revision = payload.expected_revision
            group.confirmed_by = actor_name(user)
            group.confirmed_by_user_id = user.id
            group.confirmed_at = now
            db.flush()
            db.refresh(group, attribute_names=["confirmed_at"])
            for item in pending:
                before = workflow._snapshot(item)
                item.status = expected_done
                item.stock_tracked = not external
                item.updated_at = now
                item.version += 1
                key = "batch:" + hashlib.sha256(f"{payload.idempotency_key}:{item.id}".encode()).hexdigest()
                prefix = "dispatched" if external else "received"
                setattr(item, f"{prefix}_by", group.confirmed_by)
                setattr(item, f"{prefix}_by_user_id", user.id)
                setattr(item, f"{prefix}_at", now)
                setattr(item, "outbound_idempotency_key" if external else "receipt_idempotency_key", key)
                db.flush()
                db.refresh(item, attribute_names=[f"{prefix}_at", "updated_at"])
                workflow._record_event(db, item, user, expected_done, before)
            return stock.dispatch_dict(db, group, user, items=items, include_history=True)
    except (IntegrityError, OperationalError) as exc:
        db.rollback()
        stock._db_conflict(exc)


def _require_confirmer(group, user, external):
    if (group.entry_kind in EXTERNAL_ENTRY_KINDS) != external:
        raise HTTPException(403, "use the confirmation endpoint for this batch kind")
    if external:
        stock.require_outbound_actor(user, group.source_team_id, group.entry_kind)
    else:
        team = workflow._require_team_actor(user)
        if team.id != group.next_team_id:
            raise HTTPException(403, "only the target team can confirm this batch")
