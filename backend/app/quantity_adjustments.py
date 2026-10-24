"""Audited piece-count changes on available stock, serialized with all deductions."""

from fastapi import HTTPException
from pydantic import Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, OperationalError

from . import material_stock as stock
from .auth import actor_name
from .material_transfer_workflow import _utc
from .material_weight import WEIGHT_ONLY_TYPES
from .models import MaterialQuantityAdjustment as Adjustment
from .models import MaterialStockBalance as Balance
from .models import MaterialTransfer, MaterialTransferEvent, TeamEmployee, utcnow
from .processing_registration import METRICS, prepare
from .schemas import ProcessingQuantity
from .team_constants import SPLITTING_TEAM_CODES


def validate_outbound_clearance(lot, quantity, weight, available, clearance):
    """Only an explicitly requested clearance changes the remaining piece count."""
    available_quantity, available_weight = available
    remaining = available_quantity - quantity
    needed = available_weight > 0 and weight == available_weight and remaining > 0
    if clearance is not None and (
        not needed or clearance.source_transfer_id != lot.id or clearance.quantity != remaining
    ):
        raise HTTPException(409, "待清零件数或库存已变化，请刷新后重新核对")


def record_outbound_clearance(db, lot, clearance, user, operation_key, batches):
    """Called after outbound flush, inside the same locked transaction, never a loss."""
    balance = db.scalar(
        select(Balance)
        .where(Balance.transfer_id == lot.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if balance.on_hand_weight != 0 or balance.on_hand_quantity != clearance.quantity:
        raise HTTPException(409, "剩余库存已变化，请刷新后重新核对清零件数")
    row = Adjustment(
        source_transfer_id=lot.id,
        team_id=lot.next_team_id,
        before_quantity=balance.on_hand_quantity,
        after_quantity=0,
        weight_snapshot=0,
        stock_revision_before=balance.revision,
        reason=clearance.reason,
        idempotency_key=f"outbound-clear:{operation_key}",
        request_hash=stock.fingerprint(clearance),
        created_by=actor_name(user),
        created_by_user_id=user.id,
        created_at=utcnow(),
    )
    db.add(row)
    db.add(
        MaterialTransferEvent(
            transfer_id=lot.id,
            action="quantity_changed",
            actor=actor_name(user),
            actor_user_id=user.id,
            occurred_at=row.created_at,
            changes={
                "stock_quantity": {"before": row.before_quantity, "after": 0},
                "reason": {"before": None, "after": row.reason},
                "outbound_batches": {"before": None, "after": batches},
            },
        )
    )


class AdjustmentCreate(ProcessingQuantity):
    idempotency_key: str = Field(min_length=1, max_length=100)

    @field_validator("idempotency_key")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("value cannot be blank")
        return value.strip()


def record_dict(row):
    return {
        "id": row.id,
        "source_transfer_id": row.source_transfer_id,
        "process_route_id": row.process_route_id,
        "process_step_index": row.process_step_index,
        "process_step_name": row.process_step_name,
        "process_step_instructions": row.process_step_instructions,
        "before_quantity": row.before_quantity,
        "after_quantity": row.after_quantity,
        "delta_quantity": row.after_quantity - row.before_quantity,
        "weight": float(row.weight_snapshot),
        "reason": row.reason,
        "processor_name": row.processor_name,
        "processor_employee_id": row.processor_employee_id,
        "processing_task_id": row.processing_task_id,
        "processing_task_name": row.processing_task_name,
        "purpose_id": row.purpose_id,
        "purpose_name": row.purpose_name,
        "processing_date": row.processing_date.isoformat() if row.processing_date else None,
        "processing_mode": row.processing_mode,
        "work_kind": row.work_kind,
        "rework_of_id": row.rework_of_id,
        "rework_round": row.rework_round,
        **{
            key: float(getattr(row, key))
            if key.endswith("weight") and getattr(row, key) is not None
            else getattr(row, key)
            for key in METRICS
        },
        "operation_kind": "outbound_clearance"
        if row.idempotency_key.startswith("outbound-clear:")
        else "processing",
        "processing_status": row.processing_status,
        "before_specification": row.before_specification,
        "after_specification": row.after_specification,
        "after_weight": float(row.after_weight) if row.after_weight is not None else None,
        "outputs": row.outputs,
        "created_by": row.created_by,
        "created_at": _utc(row.created_at),
    }


def latest_records(db, lot_ids):
    """Use the latest processing snapshot; outbound clearance carries no progress."""
    latest = (
        select(Adjustment.source_transfer_id, func.max(Adjustment.id).label("id"))
        .where(
            Adjustment.source_transfer_id.in_(lot_ids),
            ~Adjustment.idempotency_key.like("outbound-clear:%"),
        )
        .group_by(Adjustment.source_transfer_id)
        .subquery()
    )
    return {
        row.source_transfer_id: row
        for row in db.scalars(select(Adjustment).join(latest, latest.c.id == Adjustment.id))
    }


def processor_options(db, team_id):
    return list(
        db.scalars(
            select(TeamEmployee.name)
            .where(TeamEmployee.team_id == team_id, TeamEmployee.active.is_(True))
            .order_by(TeamEmployee.id)
        )
    )


def context(db, team_id, lot_id, page=1, page_size=10):
    from .processing_statistics import weight_differences

    lot = db.execute(
        select(
            MaterialTransfer.id,
            MaterialTransfer.next_team_code,
            MaterialTransfer.batch_no,
            MaterialTransfer.serial_no,
            MaterialTransfer.material_name,
            MaterialTransfer.material_type,
            MaterialTransfer.purpose_id,
            MaterialTransfer.purpose_name,
            MaterialTransfer.transfer_specification,
            MaterialTransfer.entry_kind,
            MaterialTransfer.processing_role,
            MaterialTransfer.source_transfer_id,
        ).where(
            MaterialTransfer.id == lot_id,
            MaterialTransfer.next_team_id == team_id,
            MaterialTransfer.status == "received",
            MaterialTransfer.stock_tracked.is_(True),
        )
    ).one_or_none()
    if lot is None:
        raise HTTPException(404, "未找到本班组已签收的库存批次")
    from .processing_tasks import context as task_context
    from .rework import previous_work
    from .shared_material import document as shared_document

    physical_lot = db.get(MaterialTransfer, lot_id)
    previous = previous_work(db, physical_lot)
    tasks = task_context(db, team_id, lot_id)
    if physical_lot.process_route_id:
        rework_of_id = (
            tasks["rework_task_records"][0]["rework_of_id"]
            if tasks["rework_task_records"]
            else None
        )
    else:
        rework_of_id = previous.id if previous else None
    shared = shared_document(physical_lot)
    balance = db.get(Balance, lot_id)
    if balance is None:
        raise HTTPException(409, "未找到该批次的库存记录，请先核对")
    where = Adjustment.source_transfer_id == lot_id
    total = db.scalar(select(func.count()).select_from(Adjustment).where(where))
    rows = db.scalars(
        select(Adjustment)
        .where(where)
        .order_by(Adjustment.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    latest = latest_records(db, [lot_id]).get(lot_id)
    origin = None
    if lot.entry_kind == "processing_output":
        records = db.scalars(
            select(Adjustment)
            .where(
                Adjustment.source_transfer_id == lot.source_transfer_id,
                Adjustment.outputs.is_not(None),
            )
            .order_by(Adjustment.id.desc())
        )
        origin = next(
            (
                row
                for row in records
                if any(output["id"] == lot_id for output in (row.outputs or []))
            ),
            None,
        )
    progress = (
        latest.processing_status
        if latest and latest.processing_status is not None
        else (
            None
            if lot.processing_role == "remaining"
            else "complete"
            if lot.processing_role == "produced"
            else None
        )
    )
    from .process_routes import processing_context

    return {
        "process_route": processing_context(physical_lot),
        "source_transfer_id": lot_id,
        "batch_no": lot.batch_no,
        "serial_no": lot.serial_no,
        **shared,
        "material_name": lot.material_name,
        "material_type": lot.material_type,
        "purpose_name": lot.purpose_name,
        "purpose_id": lot.purpose_id,
        **tasks,
        "quantity": balance.on_hand_quantity,
        "weight": float(balance.on_hand_weight),
        "processing_status": progress,
        "processor_options": processor_options(db, team_id),
        "processing_mode": "split"
        if stock.require_team(db, team_id).code in SPLITTING_TEAM_CODES
        else "unit",
        "origin_processing_record": record_dict(origin) if origin else None,
        "rework_of_id": rework_of_id,
        "rework_pending": physical_lot.rework_pending,
        "rework_count": physical_lot.rework_count,
        **weight_differences(db, [lot_id], team_id).get(lot_id, {}),
        "transfer_specification": latest.after_specification
        if latest and latest.after_specification is not None
        else lot.transfer_specification,
        "revision": balance.revision,
        "as_of": _utc(utcnow()),
        "items": [record_dict(row) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


def record_quantity_change(db, lot, payload, user, operation_key, request_hash):
    """Recount only untransferred stock inside the caller's locked transaction."""
    from .inspections import lock_hold
    from .processing_records import require_processing_team

    # Serialize held-family work before locking its balances, as rechecks do.
    hold = lock_hold(db, lot.id)
    if hold and payload.work_kind != "rework":
        raise HTTPException(409, "本批巡检不合格，请登记返工；处理后须由检验班组复检放行")
    team = require_processing_team(db, lot.next_team_id)
    if lot.material_type in WEIGHT_ONLY_TYPES:
        raise HTTPException(422, "废泥、废屑只按重量计量，不能修改加工件数")
    balance = db.scalar(
        select(Balance)
        .where(Balance.transfer_id == lot.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if balance is None or balance.revision != payload.expected_revision:
        raise HTTPException(409, "库存已变化，请刷新后重新核对件数")
    if (balance.on_hand_quantity == 0 and balance.on_hand_weight == 0) or (
        payload.outputs is not None
        and balance.on_hand_quantity <= 0
        and balance.on_hand_weight <= 0
    ):
        raise HTTPException(409, "本批已无在库物料，不能增加件数")
    latest = latest_records(db, [lot.id]).get(lot.id)
    from .process_routes import finish_processing, prepare_processing, processing_fields
    from .processing_tasks import snapshot as task_snapshot
    from .rework import validate

    payload, route_index = prepare_processing(lot, payload)
    prior_work = validate(db, lot, payload, latest)
    task_fields = task_snapshot(db, lot, payload, prior_work)
    payload, production = prepare(lot, balance, latest, payload, team.code)
    before_specification = (
        latest.after_specification
        if latest and latest.after_specification is not None
        else lot.transfer_specification
    )
    after_specification = (
        payload.transfer_specification
        if payload.transfer_specification is not None
        else before_specification
    )
    status = (
        payload.processing_status
        or (latest.processing_status if latest else None)
        or (
            None
            if lot.processing_role == "remaining"
            else "complete"
            if lot.processing_role == "produced"
            else None
        )
    )
    if (
        payload.quantity == balance.on_hand_quantity
        and payload.processing_status is None
        and after_specification == before_specification
        and payload.outputs is None
    ):
        raise HTTPException(422, "件数未发生变化")
    # Count changes are not a substitute for loss reporting. A zero
    # count is permitted only while a measured weight remains.
    if payload.quantity == 0 and balance.on_hand_weight == 0 and balance.on_hand_quantity > 0:
        raise HTTPException(422, "无重量物料清零请登记丢失或出库")
    employee = db.scalar(
        select(TeamEmployee)
        .where(
            TeamEmployee.team_id == lot.next_team_id,
            TeamEmployee.id == payload.processor_employee_id
            if payload.processor_employee_id is not None
            else TeamEmployee.name == payload.processor_name,
            TeamEmployee.active.is_(True),
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if employee is None:
        raise HTTPException(422, "请选择本班组启用的加工人；员工名单可在班组设置中维护")
    now = utcnow()
    # Preserve the source snapshot before children debit its current balance.
    before_quantity, before_weight, revision = (
        balance.on_hand_quantity,
        balance.on_hand_weight,
        balance.revision,
    )
    items, snapshots, after_weight = [], None, None
    if payload.outputs is not None:
        from .processing_outputs import create_outputs

        items, snapshots, after_weight = create_outputs(
            db, lot, payload, user, now, hold, task_fields, route_index
        )
    finish_processing(lot, payload, route_index, items)
    route_fields = processing_fields(lot, route_index)
    if prior_work:
        route_fields = {
            key: getattr(prior_work, key)
            for key in (
                "process_route_id",
                "process_step_index",
                "process_step_name",
                "process_step_instructions",
            )
        }
    row = Adjustment(
        **route_fields,
        source_transfer_id=lot.id,
        team_id=lot.next_team_id,
        before_quantity=before_quantity,
        after_quantity=payload.quantity,
        processor_name=employee.name,
        processor_employee_id=employee.id,
        **task_fields,
        **production,
        work_kind=payload.work_kind,
        rework_of_id=prior_work.id if prior_work else None,
        rework_round=lot.rework_count + 1 if prior_work else 0,
        processing_status=status,
        before_specification=before_specification or "",
        after_specification=after_specification or "",
        weight_snapshot=before_weight,
        after_weight=after_weight,
        outputs=snapshots,
        stock_revision_before=revision,
        reason=payload.reason,
        idempotency_key=operation_key,
        request_hash=request_hash,
        created_by=actor_name(user),
        created_by_user_id=user.id,
        created_at=now,
    )
    db.add(row)
    db.add(
        MaterialTransferEvent(
            transfer_id=lot.id,
            action="quantity_changed",
            actor=actor_name(user),
            actor_user_id=user.id,
            occurred_at=row.created_at,
            changes={
                "stock_quantity": {"before": row.before_quantity, "after": row.after_quantity},
                **(
                    {
                        "stock_weight": {
                            "before": float(before_weight),
                            "after": float(after_weight),
                        },
                        "processing_outputs": {"before": None, "after": snapshots},
                    }
                    if snapshots is not None
                    else {}
                ),
                **(
                    {
                        "processing_status": {
                            "before": latest.processing_status if latest else None,
                            "after": status,
                        }
                    }
                    if status
                    else {}
                ),
                **(
                    {
                        "transfer_specification": {
                            "before": before_specification,
                            "after": after_specification,
                        }
                    }
                    if after_specification != before_specification
                    else {}
                ),
                "work_kind": {"before": None, "after": row.work_kind},
                "rework_of_id": {"before": None, "after": row.rework_of_id},
                "rework_round": {"before": None, "after": row.rework_round},
                "reason": {"before": None, "after": row.reason},
                "processor_name": {"before": None, "after": row.processor_name},
                "processing_task_name": {"before": None, "after": row.processing_task_name},
                "purpose_name": {"before": None, "after": row.purpose_name},
                **(
                    {
                        "processing_date": {
                            "before": None,
                            "after": row.processing_date.isoformat(),
                        },
                        "completed_quantity": {"before": None, "after": row.completed_quantity},
                        "completed_weight": {"before": None, "after": float(row.completed_weight)},
                    }
                    if row.processing_date
                    else {}
                ),
            },
        )
    )
    if prior_work and not items:
        lot.rework_count += 1
        lot.rework_pending = False
    db.flush()
    if items:
        from .processing_outputs import record_events

        record_events(db, items, user)
    return row


def create(db, team_id, payload, user):
    stock.require_actor(user, team_id)
    request_hash = stock.fingerprint(payload)

    def replay(row):
        stock._replay(row, user, request_hash, "team_id")
        return record_dict(row)

    def prior():
        return db.scalar(
            select(Adjustment).where(Adjustment.idempotency_key == payload.idempotency_key)
        )

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
            row = record_quantity_change(
                db, lot, payload, user, payload.idempotency_key, request_hash
            )
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
