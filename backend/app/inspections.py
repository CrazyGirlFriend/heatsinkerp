"""Inspection facts and a lot-level outbound hold, without stock or output writes."""

from datetime import datetime, timezone

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import aliased

from .auth import actor_name
from .models import MaterialInspection as Inspection
from .models import (
    MaterialQuantityAdjustment,
    MaterialStockBalance,
    MaterialTransfer,
    MaterialTransferEvent,
    Team,
    utcnow,
)
from .record_filters import RecordFilters
from .team_constants import INSPECTION_TEAM_CODE, PROCESSING_TEAM_CODES


class InspectionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_transfer_id: int = Field(ge=1)
    expected_revision: int = Field(ge=0)
    inspector_employee_id: int = Field(ge=1)
    checked_at: datetime
    sample_quantity: int = Field(gt=0, le=2147483647)
    failed_quantity: int = Field(ge=0, le=2147483647)
    notes: str = Field(default="", max_length=2000)
    parent_id: int | None = Field(default=None, ge=1)
    idempotency_key: str = Field(min_length=1, max_length=100)

    @field_validator("idempotency_key")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("提交标识不能为空")
        return value.strip()

    @field_validator("checked_at")
    @classmethod
    def timestamp(cls, value):
        if value.tzinfo is None:
            raise ValueError("巡检时间须带时区")
        return value.astimezone(timezone.utc)

    @model_validator(mode="after")
    def counts(self):
        if self.failed_quantity > self.sample_quantity:
            raise ValueError("不合格件数不能超过抽检件数")
        return self


def hold_conditions():
    return (
        Inspection.parent_id.is_(None),
        Inspection.failed_quantity > 0,
        Inspection.released_at.is_(None),
    )


def hold_column(lot_id):
    physical = aliased(MaterialTransfer)
    root_id = (
        select(physical.inspection_hold_root_id)
        .where(physical.id == lot_id)
        .correlate_except(physical)
        .scalar_subquery()
    )
    return (
        select(Inspection.id)
        .where(
            or_(Inspection.source_transfer_id == lot_id, Inspection.source_transfer_id == root_id),
            *hold_conditions(),
        )
        .limit(1)
        .correlate_except(Inspection)
        .scalar_subquery()
    )


def lock_hold(db, lot_id):
    lot = db.get(MaterialTransfer, lot_id)
    return db.scalar(
        select(Inspection)
        .where(
            Inspection.source_transfer_id.in_([lot_id, lot.inspection_hold_root_id or lot_id]),
            *hold_conditions(),
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )


def require_clear(db, lot_id):
    if lock_hold(db, lot_id) is not None:
        raise HTTPException(409, "本批巡检不合格，整批暂停转出；请由检验班组复检合格后放行")


def require_clear_lots(db, lots):
    root_ids = {
        root_id for lot in lots for root_id in (lot.id, lot.inspection_hold_root_id) if root_id
    }
    held = db.scalar(
        select(Inspection.id)
        .where(Inspection.source_transfer_id.in_(root_ids), *hold_conditions())
        .order_by(Inspection.id)
        .with_for_update()
    )
    if held is not None:
        raise HTTPException(409, "本批巡检不合格，整批暂停转出；请由检验班组复检合格后放行")


def held_quantity(db, root_id, *, lock=False):
    family = select(MaterialTransfer.id).where(
        or_(MaterialTransfer.id == root_id, MaterialTransfer.inspection_hold_root_id == root_id)
    )
    condition = MaterialStockBalance.transfer_id.in_(family)
    if lock:
        # Current reads after the hold lock avoid a stale REPEATABLE READ snapshot.
        # Lock balances only; a waiting worker may already own its transfer row.
        return sum(
            db.scalars(
                select(MaterialStockBalance.on_hand_quantity)
                .where(condition)
                .order_by(MaterialStockBalance.transfer_id)
                .with_for_update()
            )
        )
    return db.scalar(
        select(func.coalesce(func.sum(MaterialStockBalance.on_hand_quantity), 0)).where(condition)
    )


def recheck_context(db, inspection_id):
    row = db.get(Inspection, inspection_id)
    if row is None or row.parent_id or row.released_at or not row.failed_quantity:
        raise HTTPException(409, "待处理巡检已变化，请刷新后重试")
    lot = db.get(MaterialTransfer, row.source_transfer_id)
    balance = db.get(MaterialStockBalance, lot.id)
    return dict(
        source_transfer_id=lot.id,
        team_id=lot.next_team_id,
        serial_no=lot.serial_no,
        batch_no=lot.batch_no,
        material_name=lot.material_name,
        specification=lot.transfer_specification,
        quantity=held_quantity(db, lot.id),
        revision=balance.revision,
        hold_id=row.id,
        processing_status="complete",
    )


def record_dict(row, lot, team):
    status = (
        "released"
        if row.released_at
        else "pending"
        if row.failed_quantity and not row.parent_id
        else "failed"
        if row.failed_quantity
        else "passed"
    )
    return dict(
        id=row.id,
        source_transfer_id=row.source_transfer_id,
        team_id=row.team_id,
        team_name=team.name,
        serial_no=lot.serial_no,
        batch_no=lot.batch_no,
        material_name=lot.material_name,
        specification=lot.transfer_specification,
        inspector_employee_id=row.inspector_employee_id,
        inspector_name=row.inspector_name,
        processing_record_id=row.processing_record_id,
        processor_name=row.processor_name,
        checked_at=row.checked_at.replace(tzinfo=timezone.utc).isoformat(),
        batch_quantity=row.batch_quantity,
        sample_quantity=row.sample_quantity,
        passed_quantity=row.sample_quantity - row.failed_quantity,
        failed_quantity=row.failed_quantity,
        status=status,
        notes=row.notes,
        parent_id=row.parent_id,
        released_at=row.released_at.replace(tzinfo=timezone.utc).isoformat()
        if row.released_at
        else None,
        created_by=row.created_by,
    )


def create(db, payload, user):
    from . import material_stock as stock
    from .material_transfer_workflow import _require_team_actor, require_team_employee
    from .processing_records import registered_lots

    actor_team = _require_team_actor(user)
    if actor_team.code != INSPECTION_TEAM_CODE:
        raise HTTPException(403, "仅检验班组可登记巡检与复检放行")
    digest = stock.fingerprint(payload)

    def replay(row):
        stock._replay(row, user, digest, "inspection_team_id")
        return record_dict(
            row, db.get(MaterialTransfer, row.source_transfer_id), db.get(Team, row.team_id)
        )

    try:
        with db.begin():
            prior = db.scalar(
                select(Inspection).where(Inspection.idempotency_key == payload.idempotency_key)
            )
            if prior is not None:
                return replay(prior)
        with db.begin():
            lot = stock.lock_lot(db, payload.source_transfer_id)
            prior = db.scalar(
                select(Inspection).where(Inspection.idempotency_key == payload.idempotency_key)
            )
            if prior is not None:
                return replay(prior)
            target = stock.require_team(db, lot.next_team_id)
            if not target.active or target.code not in PROCESSING_TEAM_CODES:
                raise HTTPException(422, "请选择生产班组的已加工在库批次")
            balance = db.scalar(
                select(MaterialStockBalance)
                .where(MaterialStockBalance.transfer_id == lot.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if balance is None or balance.revision != payload.expected_revision:
                raise HTTPException(409, "库存已变化，请重新选择巡检批次")
            hold = lock_hold(db, lot.id)
            if hold is not None and payload.parent_id != hold.id:
                raise HTTPException(409, "本批已有待处理巡检，请从该记录发起复检")
            if payload.parent_id is not None and (
                hold is None or hold.id != payload.parent_id or hold.source_transfer_id != lot.id
            ):
                raise HTTPException(409, "请从原巡检记录复检整批返工物料")
            quantity = held_quantity(db, lot.id, lock=True) if hold else balance.on_hand_quantity
            if payload.sample_quantity > quantity:
                raise HTTPException(422, "抽检件数超过本批当前在库件数")
            progress = registered_lots(target.id)
            registered = db.execute(
                select(progress.c.processing_status, progress.c.latest_id).where(
                    progress.c.lot_id == lot.id
                )
            ).first()
            state = registered.processing_status if registered else None
            if state not in ("complete", "partial", "registered"):
                raise HTTPException(422, "只能抽检已登记加工的物料")
            now = utcnow()
            if payload.checked_at.replace(tzinfo=None) > now:
                raise HTTPException(422, "巡检时间不能晚于当前时间")
            if lot.received_at and payload.checked_at.replace(tzinfo=None) < lot.received_at:
                raise HTTPException(422, "巡检时间不能早于本批入库时间")
            employee = require_team_employee(
                db, actor_team.id, payload.inspector_employee_id, "巡检人"
            )
            # The inherited root hold above remains authoritative through rework.
            if hold is not None and payload.parent_id != hold.id:
                raise HTTPException(409, "本批已有待处理巡检，请从该记录发起复检")
            if payload.parent_id is not None and (hold is None or hold.id != payload.parent_id):
                raise HTTPException(409, "待处理巡检已变化，请刷新后重试")
            if hold and payload.checked_at.replace(tzinfo=None) < hold.checked_at:
                raise HTTPException(422, "复检时间不能早于原巡检")
            work = (
                db.get(MaterialQuantityAdjustment, registered.latest_id)
                if registered.latest_id
                else None
            )
            row = Inspection(
                processing_record_id=work.id if work else None,
                processor_name=work.processor_name if work else None,
                source_transfer_id=lot.id,
                team_id=target.id,
                inspection_team_id=actor_team.id,
                inspector_employee_id=employee.id,
                inspector_name=employee.name,
                checked_at=payload.checked_at.replace(tzinfo=None),
                batch_quantity=quantity,
                sample_quantity=payload.sample_quantity,
                failed_quantity=payload.failed_quantity,
                notes=payload.notes.strip(),
                parent_id=payload.parent_id,
                idempotency_key=payload.idempotency_key,
                request_hash=digest,
                created_by=actor_name(user),
                created_by_user_id=user.id,
                created_at=now,
            )
            db.add(row)
            if hold and payload.failed_quantity == 0:
                hold.released_at = now
            db.flush()
            db.add(
                MaterialTransferEvent(
                    transfer_id=lot.id,
                    action="inspection_rechecked" if hold else "inspection_recorded",
                    actor=actor_name(user),
                    actor_user_id=user.id,
                    occurred_at=now,
                    changes={
                        "inspection": {
                            "before": None,
                            "after": dict(
                                id=row.id,
                                inspector=employee.name,
                                sample=payload.sample_quantity,
                                failed=payload.failed_quantity,
                                parent_id=payload.parent_id,
                                released=bool(hold and payload.failed_quantity == 0),
                            ),
                        }
                    },
                )
            )
            result = record_dict(row, lot, target)
        return result
    except (IntegrityError, OperationalError) as exc:
        db.rollback()
        prior = db.scalar(
            select(Inspection).where(Inspection.idempotency_key == payload.idempotency_key)
        )
        if prior is not None:
            return replay(prior)
        stock._db_conflict(exc)


def list_records(
    db,
    *,
    team_id=None,
    source_transfer_id=None,
    query=None,
    inspector_id=None,
    status=None,
    date_from=None,
    date_to=None,
    page=1,
    page_size=20,
):
    from .material_stock import literal_query

    conditions = list(
        RecordFilters(date_from=date_from, date_to=date_to).dates(Inspection.checked_at)
    )
    for column, value in (
        (Inspection.team_id, team_id),
        (Inspection.inspector_employee_id, inspector_id),
    ):
        if value is not None:
            conditions.append(column == value)
    if source_transfer_id is not None:
        physical = db.get(MaterialTransfer, source_transfer_id)
        ids = [source_transfer_id]
        if physical and physical.inspection_hold_root_id:
            ids.append(physical.inspection_hold_root_id)
        conditions.append(Inspection.source_transfer_id.in_(ids))
    if query and query.strip():
        conditions.append(
            literal_query(
                query,
                [
                    MaterialTransfer.serial_no,
                    MaterialTransfer.batch_no,
                    MaterialTransfer.material_name,
                    Inspection.inspector_name,
                ],
            )
        )
    if status == "pending":
        conditions.extend(hold_conditions())
    elif status == "released":
        conditions.append(Inspection.released_at.is_not(None))
    elif status == "passed":
        conditions.append(Inspection.failed_quantity == 0)
    elif status == "failed":
        conditions.extend((Inspection.parent_id.is_not(None), Inspection.failed_quantity > 0))
    stmt = (
        select(Inspection, MaterialTransfer, Team)
        .join(MaterialTransfer, MaterialTransfer.id == Inspection.source_transfer_id)
        .join(Team, Team.id == Inspection.team_id)
        .where(*conditions)
    )
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(
        stmt.order_by(Inspection.checked_at.desc(), Inspection.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return dict(
        items=[record_dict(*row) for row in rows], total=total, page=page, page_size=page_size
    )


def list_sources(db, team_id, query=None, page=1, page_size=20):
    from .material_stock import literal_query
    from .processing_records import registered_lots, require_processing_team

    require_processing_team(db, team_id)
    registered = registered_lots(team_id)
    stmt = (
        select(
            MaterialTransfer,
            MaterialStockBalance,
            registered.c.processing_status,
            hold_column(MaterialTransfer.id).label("hold_id"),
        )
        .join(MaterialStockBalance, MaterialStockBalance.transfer_id == MaterialTransfer.id)
        .join(registered, registered.c.lot_id == MaterialTransfer.id)
        .where(
            MaterialStockBalance.team_id == team_id,
            MaterialStockBalance.on_hand_quantity > 0,
            registered.c.processing_status.in_(("complete", "partial", "registered")),
        )
    )
    if query and query.strip():
        stmt = stmt.where(
            literal_query(
                query,
                [
                    MaterialTransfer.serial_no,
                    MaterialTransfer.batch_no,
                    MaterialTransfer.material_name,
                ],
            )
        )
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(
        stmt.order_by(MaterialTransfer.received_at.desc(), MaterialTransfer.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return dict(
        items=[
            dict(
                source_transfer_id=lot.id,
                team_id=team_id,
                serial_no=lot.serial_no,
                batch_no=lot.batch_no,
                material_name=lot.material_name,
                specification=lot.transfer_specification,
                quantity=balance.on_hand_quantity,
                revision=balance.revision,
                hold_id=hold,
                processing_status=status,
            )
            for lot, balance, status, hold in rows
        ],
        total=total,
        page=page,
        page_size=page_size,
    )
