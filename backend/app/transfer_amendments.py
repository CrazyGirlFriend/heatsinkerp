"""Counterparty-approved corrections to received inter-team handoffs."""

from contextlib import contextmanager
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import JSON, or_, select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session, lazyload

from . import material_transfer_workflow as workflow
from .auth import actor_name
from .material_stock import available_locked
from .material_weight import validate_material_amounts
from .models import (
    MaterialQuantityAdjustment,
    MaterialTransfer,
    MaterialTransferAmendment,
    MaterialTransferEvent,
    Team,
    TransferAmendmentNotice,
    User,
    utcnow,
)
from .transfer_amendment_schemas import AmendmentCreate as AmendmentCreate
from .transfer_amendment_schemas import AmendmentReject as AmendmentReject


def eligible(transfer):
    return (
        transfer.entry_kind == "transfer"
        and transfer.status == "received"
        and transfer.stock_tracked
        and transfer.source_team_id is not None
        and transfer.next_team_id is not None
        and transfer.source_team_id != transfer.next_team_id
    )


def _visible(user, transfer):
    if user.role == "ADMIN":
        return
    if user.role != "TEAM" or user.team_id not in (
        transfer.source_team_id,
        transfer.next_team_id,
    ):
        raise HTTPException(404, "未找到该交接单")


def _actor(user, transfer):
    team = workflow._require_team_actor(user)
    _visible(user, transfer)
    if not eligible(transfer):
        raise HTTPException(409, "仅已签收的跨班组交接单可以申请修改")
    return team


def _values(transfer):
    return {
        "quantity": transfer.quantity,
        "weight": float(transfer.weight),
        "notes": transfer.notes,
    }


def _local_remaining(db, transfer):
    quantity, weight = available_locked(db, transfer)
    if transfer.process_step_complete:
        return 0, Decimal(0)
    # Modern processing moves its input to immutable output lots, so the source
    # balance already excludes it. Older inline work may leave processed stock
    # on the received lot; it must not become editable merely because it is here.
    records = db.scalars(
        select(MaterialQuantityAdjustment)
        .where(
            MaterialQuantityAdjustment.source_transfer_id == transfer.id,
            or_(
                MaterialQuantityAdjustment.outputs.is_(None),
                MaterialQuantityAdjustment.outputs == JSON.NULL,
            ),
            ~MaterialQuantityAdjustment.idempotency_key.like("outbound-clear:%"),
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    ).all()
    if any(row.processing_status == "complete" for row in records):
        return 0, Decimal(0)
    if any(
        (row.input_quantity is None and row.completed_quantity is None)
        or (row.input_weight is None and row.completed_weight is None)
        for row in records
    ):
        return 0, Decimal(0)
    used_quantity = sum(row.input_quantity or row.completed_quantity or 0 for row in records)
    used_weight = sum(
        (row.input_weight or row.completed_weight or Decimal(0) for row in records), Decimal(0)
    )
    return max(0, quantity - used_quantity), max(Decimal(0), weight - used_weight)


def _remaining_branches(db, transfer):
    """Lock only this team's unprocessed remainder lineage, parent before child."""
    branches = []
    pending = [(transfer,)]
    while pending:
        path = pending.pop()
        lot = path[-1]
        quantity, weight = _local_remaining(db, lot)
        if quantity > 0 or weight > 0:
            branches.append((path, min(quantity, lot.quantity), min(weight, lot.weight)))
        children = db.scalars(
            select(MaterialTransfer)
            .options(lazyload("*"))
            .where(
                MaterialTransfer.source_transfer_id == lot.id,
                MaterialTransfer.entry_kind == "processing_output",
                MaterialTransfer.processing_role == "remaining",
                MaterialTransfer.status == "received",
                MaterialTransfer.stock_tracked.is_(True),
                MaterialTransfer.next_team_id == transfer.next_team_id,
            )
            .order_by(MaterialTransfer.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).all()
        pending.extend(path + (child,) for child in reversed(children))
    return branches


def _remaining(db, transfer):
    branches = _remaining_branches(db, transfer)
    return (
        sum(quantity for _, quantity, _ in branches),
        sum((weight for _, _, weight in branches), Decimal(0)),
    )


def _allocate_remaining(branches, quantity_delta, weight_delta):
    # The received root changes separately. Passing the same correction down a
    # remainder path cancels intermediate debits/credits; only the unused leaf
    # and upstream source balances change. Production snapshots remain intact.
    changes = {}
    for field, delta, index in (("quantity", quantity_delta, 1), ("weight", weight_delta, 2)):
        pending = delta
        for branch in branches:
            if pending == 0:
                break
            path, capacity = branch[0], branch[index]
            if not capacity and pending < 0:
                continue
            if pending > 0:
                applied = pending
            else:
                capacity = min(
                    [
                        capacity,
                        *(
                            getattr(lot, field) + changes.get(lot.id, {}).get(field, 0)
                            for lot in path[1:]
                        ),
                    ]
                )
                applied = -min(-pending, capacity)
            for lot in path[1:]:
                change = changes.setdefault(
                    lot.id, {"lot": lot, "quantity": 0, "weight": Decimal(0)}
                )
                change[field] += applied
            pending -= applied
        if pending:
            raise HTTPException(409, "修改超出未加工余料，请刷新后重新申请")
    return list(changes.values())


def _validate_change(db, transfer, after):
    quantity, weight = after["quantity"], Decimal(str(after["weight"]))
    validate_material_amounts(
        transfer.material_type,
        quantity,
        weight,
        existing=transfer,
    )
    delta_quantity, delta_weight = quantity - transfer.quantity, weight - transfer.weight
    if delta_quantity == 0 and delta_weight == 0:
        return []
    if transfer.material_type == "sludge" and delta_weight:
        raise HTTPException(422, "泥料重量关联含量计算，请保持原重量")
    branches = _remaining_branches(db, transfer)
    remaining_quantity = sum(row[1] for row in branches)
    remaining_weight = sum((row[2] for row in branches), Decimal(0))
    if (remaining_quantity == 0 and remaining_weight == 0) or (
        -delta_quantity > remaining_quantity or -delta_weight > remaining_weight
    ):
        raise HTTPException(409, "修改超出未加工、未转出的剩余数量或重量，请刷新后重新申请")
    if delta_quantity > 0 or delta_weight > 0:
        if transfer.source_transfer_id is None:
            raise HTTPException(409, "该交接单未关联上序库存，不能增加数量或重量")
        source = db.get(MaterialTransfer, transfer.source_transfer_id)
        source_quantity, source_weight = available_locked(db, source)
        if delta_quantity > max(0, source_quantity) or delta_weight > max(
            Decimal(0), source_weight
        ):
            raise HTTPException(409, "上序剩余库存不足，不能增加交接数量或重量")
        from .inspections import require_clear

        require_clear(db, source.id)
    return _allocate_remaining(branches, delta_quantity, delta_weight)


def amendment_dict(db, amendment, user):
    transfer = db.get(MaterialTransfer, amendment.transfer_id)
    _visible(user, transfer)
    actions = []
    if amendment.status == "pending" and user.role == "TEAM" and user.team and user.team.active:
        if (
            user.team_id == amendment.counterparty_team_id
            and user.id != amendment.requested_by_user_id
        ):
            actions = ["approve", "reject"]
        elif user.team_id == amendment.requester_team_id:
            actions = ["cancel"]
    return {
        "id": amendment.id,
        "batch_no": transfer.batch_no,
        "serial_no": transfer.serial_no,
        "status": amendment.status,
        "reason": amendment.reason,
        "requester_team_id": amendment.requester_team_id,
        "requester_team_name": db.get(Team, amendment.requester_team_id).name,
        "counterparty_team_id": amendment.counterparty_team_id,
        "counterparty_team_name": db.get(Team, amendment.counterparty_team_id).name,
        "requested_by": amendment.requested_by,
        "created_at": workflow._utc(amendment.created_at),
        "resolved_at": workflow._utc(amendment.resolved_at),
        "resolved_by": amendment.resolved_by,
        "response_reason": amendment.response_reason,
        "before": amendment.before,
        "after": amendment.after,
        "allowed_actions": actions,
    }


def get_amendment(db, amendment_id, user):
    amendment = db.get(MaterialTransferAmendment, amendment_id)
    if amendment is None:
        raise HTTPException(404, "未找到修改申请")
    return amendment_dict(db, amendment, user)


def _record(db, amendment, transfer, user, action):
    changes = {
        "amendment_id": {"before": None, "after": amendment.id},
        "reason": {"before": None, "after": amendment.response_reason or amendment.reason},
        "amendment_status": {
            "before": "pending" if action != "requested" else None,
            "after": amendment.status,
        },
    }
    if action == "approved":
        changes.update(
            {
                key: {"before": amendment.before[key], "after": amendment.after[key]}
                for key in amendment.before
                if amendment.before[key] != amendment.after[key]
            }
        )
    db.add(
        MaterialTransferEvent(
            transfer_id=transfer.id,
            action=f"amendment_{action}",
            actor=actor_name(user),
            actor_user_id=user.id,
            occurred_at=utcnow(),
            changes=changes,
        )
    )
    labels = {
        "requested": "申请修改交接单",
        "approved": "已确认交接修改",
        "rejected": "已拒绝交接修改",
        "cancelled": "已撤回交接修改",
    }
    for team_id in (amendment.requester_team_id, amendment.counterparty_team_id):
        db.add(
            TransferAmendmentNotice(
                amendment_id=amendment.id,
                team_id=team_id,
                kind=f"amendment_{action}",
                event_key=f"transfer-amendment:{amendment.id}:{action}:{team_id}",
                message=f"{transfer.serial_no} · {actor_name(user)}{labels[action]}",
            )
        )


@contextmanager
def _transaction(db):
    try:
        with db.begin():
            # SQLite has no row locks. Acquire its writer lock before the first
            # read so competing approvals cannot both validate stale balances.
            if db.bind.dialect.name == "sqlite":
                db.connection().exec_driver_sql("BEGIN IMMEDIATE")
            yield
    except OperationalError as exc:
        if getattr(exc.orig, "sqlite_errorcode", None) in (5, 6) or getattr(
            exc.orig, "args", (None,)
        )[0] in (1205, 1213):
            raise HTTPException(409, "交接库存正在更新，请稍后重试") from exc
        raise


def request_amendment(db, batch_no, payload, user):
    try:
        with _transaction(db):
            transfer = workflow._locked_transfer(db, batch_no)
            team = _actor(user, transfer)
            workflow._assert_version(transfer, payload)
            before = _values(transfer)
            after = {
                "quantity": payload.quantity,
                "weight": float(payload.weight),
                "notes": payload.notes,
            }
            pending = db.scalar(
                select(MaterialTransferAmendment)
                .where(MaterialTransferAmendment.pending_transfer_id == transfer.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if pending:
                if (
                    pending.requested_by_user_id == user.id
                    and pending.after == after
                    and pending.reason == payload.reason
                ):
                    return amendment_dict(db, pending, user)
                raise HTTPException(409, "该交接单已有待确认的修改，请先处理或撤回")
            if before == after:
                raise HTTPException(422, "请修改数量、重量或备注后再提交")
            _validate_change(db, transfer, after)
            row = MaterialTransferAmendment(
                transfer_id=transfer.id,
                pending_transfer_id=transfer.id,
                base_version=transfer.version,
                requester_team_id=team.id,
                counterparty_team_id=(
                    transfer.next_team_id
                    if team.id == transfer.source_team_id
                    else transfer.source_team_id
                ),
                requested_by=actor_name(user),
                requested_by_user_id=user.id,
                before=before,
                after=after,
                reason=payload.reason,
                status="pending",
            )
            db.add(row)
            db.flush()
            _record(db, row, transfer, user, "requested")
        return amendment_dict(db, row, user)
    except IntegrityError as exc:
        raise HTTPException(409, "该交接单已有待确认的修改，请刷新后查看") from exc


def resolve_amendment(db, amendment_id, decision, user, reason=None):
    with _transaction(db):
        # Read only the locator first, then use the same source -> received lot ->
        # proposal order as request creation and normal dispatch reservations.
        batch_no = db.scalar(
            select(MaterialTransfer.batch_no)
            .join(
                MaterialTransferAmendment,
                MaterialTransferAmendment.transfer_id == MaterialTransfer.id,
            )
            .where(MaterialTransferAmendment.id == amendment_id)
        )
        if batch_no is None:
            raise HTTPException(404, "未找到修改申请")
        transfer = workflow._locked_transfer(db, batch_no)
        _actor(user, transfer)
        row = db.scalar(
            select(MaterialTransferAmendment)
            .where(MaterialTransferAmendment.id == amendment_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        required_team = (
            row.requester_team_id if decision == "cancelled" else row.counterparty_team_id
        )
        if user.team_id != required_team or (
            decision != "cancelled" and user.id == row.requested_by_user_id
        ):
            raise HTTPException(403, "仅对方班组可以确认或拒绝，申请方可以撤回")
        if row.status == decision:
            return amendment_dict(db, row, user)
        if row.status != "pending":
            raise HTTPException(409, "该修改申请已处理，请刷新后查看")
        if decision == "approved":
            if transfer.version != row.base_version or _values(transfer) != row.before:
                raise HTTPException(409, "交接单已变化，请撤回原申请并重新提交")
            changes = _validate_change(db, transfer, row.after)
            for change in changes:
                remainder = change["lot"]
                before = _values(remainder)
                remainder.quantity += change["quantity"]
                remainder.weight += change["weight"]
                remainder.version += 1
                remainder.updated_at = utcnow()
                after = _values(remainder)
                db.add(
                    MaterialTransferEvent(
                        transfer_id=remainder.id,
                        action="amendment_approved",
                        actor=actor_name(user),
                        actor_user_id=user.id,
                        occurred_at=remainder.updated_at,
                        changes={
                            "amendment_id": {"before": None, "after": row.id},
                            "reason": {"before": None, "after": row.reason},
                            **{
                                key: {"before": before[key], "after": after[key]}
                                for key in before
                                if before[key] != after[key]
                            },
                        },
                    )
                )
            transfer.quantity = row.after["quantity"]
            transfer.weight = Decimal(str(row.after["weight"]))
            transfer.notes = row.after["notes"]
            transfer.version += 1
            transfer.updated_at = utcnow()
        row.status = decision
        row.pending_transfer_id = None
        row.resolved_at = utcnow()
        row.resolved_by = actor_name(user)
        row.resolved_by_user_id = user.id
        row.response_reason = reason
        _record(db, row, transfer, user, decision)
    return amendment_dict(db, row, user)


def list_amendments(*, batch_no: str, db: Session, user: User):
    transfer = db.scalar(
        select(MaterialTransfer).options(lazyload("*")).where(MaterialTransfer.batch_no == batch_no)
    )
    if transfer is None:
        raise HTTPException(404, "未找到该交接单")
    _visible(user, transfer)
    rows = db.scalars(
        select(MaterialTransferAmendment)
        .where(MaterialTransferAmendment.transfer_id == transfer.id)
        .order_by(MaterialTransferAmendment.id.desc())
    ).all()
    remaining = _remaining(db, transfer) if eligible(transfer) else (0, Decimal(0))
    return {
        "items": [amendment_dict(db, row, user) for row in rows],
        "remaining_quantity": remaining[0],
        "remaining_weight": float(remaining[1]),
        "editable": bool(
            eligible(transfer)
            and user.role == "TEAM"
            and user.team
            and user.team.active
            and not any(row.status == "pending" for row in rows)
        ),
    }
