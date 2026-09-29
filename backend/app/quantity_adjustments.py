"""Audited piece-count changes on available stock, serialized with all deductions."""
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, OperationalError

from .auth import actor_name
from . import material_stock as stock
from .material_transfer_workflow import _utc
from .models import MaterialQuantityAdjustment as Adjustment, MaterialStockBalance as Balance, MaterialTransfer, MaterialTransferEvent, utcnow


def validate_outbound_clearance(lot, quantity, weight, available, clearance):
    """Require explicit consent for precisely the remainder of a final-weight exit."""
    available_quantity, available_weight = available
    remaining = available_quantity - quantity
    needed = available_weight > 0 and weight == available_weight and remaining > 0
    if needed and clearance is None:
        raise HTTPException(422, f"批次 {lot.batch_no} 的重量将全部转出，还剩 {remaining} 件；请填写剩余件数清零原因后提交")
    if clearance is not None and (not needed or clearance.source_transfer_id != lot.id or clearance.quantity != remaining):
        raise HTTPException(409, "待清零件数或库存已变化，请刷新后重新核对并填写清零原因")


def record_outbound_clearance(db, lot, clearance, user, operation_key, batches):
    """Called after outbound flush, inside the same locked transaction, never a loss."""
    balance = db.scalar(select(Balance).where(Balance.transfer_id == lot.id)
        .with_for_update().execution_options(populate_existing=True))
    if balance.on_hand_weight != 0 or balance.on_hand_quantity != clearance.quantity:
        raise HTTPException(409, "剩余库存已变化，请刷新后重新核对清零件数")
    row = Adjustment(source_transfer_id=lot.id, team_id=lot.next_team_id,
        before_quantity=balance.on_hand_quantity, after_quantity=0, weight_snapshot=0,
        stock_revision_before=balance.revision, reason=clearance.reason,
        idempotency_key=f"outbound-clear:{operation_key}", request_hash=stock.fingerprint(clearance),
        created_by=actor_name(user), created_by_user_id=user.id, created_at=utcnow())
    db.add(row)
    db.add(MaterialTransferEvent(transfer_id=lot.id, action="quantity_changed", actor=actor_name(user),
        actor_user_id=user.id, occurred_at=row.created_at,
        changes={"stock_quantity": {"before": row.before_quantity, "after": 0},
                 "reason": {"before": None, "after": row.reason},
                 "outbound_batches": {"before": None, "after": batches}}))


class AdjustmentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_transfer_id: int = Field(ge=1)
    quantity: int = Field(ge=0, le=2_147_483_647)
    expected_revision: int = Field(ge=0)
    reason: str = Field(min_length=1, max_length=2000)
    idempotency_key: str = Field(min_length=1, max_length=100)

    @field_validator("reason", "idempotency_key")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("value cannot be blank")
        return value.strip()


def record_dict(row):
    return {"id": row.id, "source_transfer_id": row.source_transfer_id,
            "before_quantity": row.before_quantity, "after_quantity": row.after_quantity,
            "delta_quantity": row.after_quantity - row.before_quantity,
            "weight": float(row.weight_snapshot), "reason": row.reason,
            "created_by": row.created_by, "created_at": _utc(row.created_at)}


def context(db, team_id, lot_id, page=1, page_size=10):
    lot = db.execute(select(MaterialTransfer.id, MaterialTransfer.batch_no).where(
        MaterialTransfer.id == lot_id, MaterialTransfer.next_team_id == team_id,
        MaterialTransfer.status == "received", MaterialTransfer.stock_tracked.is_(True))).one_or_none()
    if lot is None:
        raise HTTPException(404, "未找到本班组已签收的库存批次")
    balance = db.get(Balance, lot_id)
    if balance is None:
        raise HTTPException(409, "未找到该批次的库存记录，请先核对")
    where = Adjustment.source_transfer_id == lot_id
    total = db.scalar(select(func.count()).select_from(Adjustment).where(where))
    rows = db.scalars(select(Adjustment).where(where).order_by(Adjustment.id.desc())
        .offset((page - 1) * page_size).limit(page_size)).all()
    return {"source_transfer_id": lot_id, "batch_no": lot.batch_no,
            "quantity": balance.on_hand_quantity, "weight": float(balance.on_hand_weight),
            "revision": balance.revision, "as_of": _utc(utcnow()), "items": [record_dict(row) for row in rows],
            "total": total, "page": page, "page_size": page_size}


def create(db, team_id, payload, user):
    stock.require_actor(user, team_id)
    request_hash = stock.fingerprint(payload)

    def replay(row):
        stock._replay(row, user, request_hash, "team_id")
        return record_dict(row)

    def prior():
        return db.scalar(select(Adjustment).where(Adjustment.idempotency_key == payload.idempotency_key))

    try:
        with db.begin():
            row = prior()
            if row is not None:
                return replay(row)
        with db.begin():
            lot = stock.lock_lot(db, payload.source_transfer_id, team_id)
            row = prior()
            if row is not None:
                return replay(row)
            balance = db.scalar(select(Balance).where(Balance.transfer_id == lot.id)
                .with_for_update().execution_options(populate_existing=True))
            if balance is None or balance.revision != payload.expected_revision:
                raise HTTPException(409, "库存已变化，请刷新后重新核对件数")
            if balance.on_hand_quantity == 0 and balance.on_hand_weight == 0:
                raise HTTPException(409, "本批已无在库物料，不能增加件数")
            if payload.quantity == balance.on_hand_quantity:
                raise HTTPException(422, "件数未发生变化")
            # Count changes are not a substitute for loss reporting. A zero
            # count is permitted only while a measured weight remains.
            if payload.quantity == 0 and balance.on_hand_weight == 0:
                raise HTTPException(422, "无重量物料清零请登记丢失或出库")
            row = Adjustment(source_transfer_id=lot.id, team_id=team_id,
                before_quantity=balance.on_hand_quantity, after_quantity=payload.quantity,
                weight_snapshot=balance.on_hand_weight, stock_revision_before=balance.revision,
                reason=payload.reason, idempotency_key=payload.idempotency_key, request_hash=request_hash,
                created_by=actor_name(user), created_by_user_id=user.id, created_at=utcnow())
            db.add(row)
            db.add(MaterialTransferEvent(transfer_id=lot.id, action="quantity_changed",
                actor=actor_name(user), actor_user_id=user.id, occurred_at=row.created_at,
                changes={"stock_quantity": {"before": row.before_quantity, "after": row.after_quantity},
                         "reason": {"before": None, "after": row.reason}}))
            db.flush()
            # MySQL persists DateTime at second precision; first response and
            # idempotent replay must both use the stored timestamp.
            db.refresh(row)
            result = record_dict(row)
        return result
    except (IntegrityError, OperationalError) as exc:
        db.rollback()
        row = prior()
        if row is not None:
            return replay(row)
        stock._db_conflict(exc)
