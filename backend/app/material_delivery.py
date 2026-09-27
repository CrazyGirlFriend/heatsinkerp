"""Batch-owned delivery dates, inherited without duplicating order quantities."""

from fastapi import HTTPException

from .models import utcnow
from .observability import record

FIELDS = ("delivery_date", "delivery_quantity")


def validate_pair(day, quantity):
    if (day is None) != (quantity is None):
        raise HTTPException(422, "请同时填写要求发货日期和应发成品件数")


def can_edit(transfer, user):
    owner = transfer.source_team_id or transfer.next_team_id
    return bool(
        user
        and user.role == "TEAM"
        and user.team_id == owner
        and user.active
        and user.team
        and user.team.active
        and transfer.status != "voided"
        and transfer.source_transfer_id is None
        and transfer.delivery_origin_id is None
        and transfer.entry_kind in ("transfer", "warehouse_receipt")
        and transfer.receipt_kind != "return"
    )


def document(transfer, user):
    origin = transfer.delivery_origin if transfer.delivery_origin_id else transfer
    return {
        "delivery_date": origin.delivery_date,
        "delivery_quantity": origin.delivery_quantity,
        "delivery_origin_batch_no": origin.batch_no,
        "can_edit_delivery": can_edit(transfer, user),
    }


def update(db, batch_no, payload, user):
    from . import material_transfer_workflow as workflow

    with db.begin():
        transfer = workflow._locked_transfer(db, batch_no)
        if not can_edit(transfer, user):
            raise HTTPException(403, "仅源头班组可以在源头单据上维护交期")
        workflow._assert_version(transfer, payload)
        before = workflow._snapshot(transfer)
        transfer.delivery_date = payload.delivery_date
        transfer.delivery_quantity = payload.delivery_quantity
        if workflow._snapshot(transfer) != before:
            transfer.version += 1
            transfer.updated_at = utcnow()
            # Signed quantities and stock remain immutable; only the requirement changes.
            workflow._record_event(db, transfer, user, "updated", before)
        result = workflow.material_transfer_dict(transfer, user)
    record(
        "material_transfer.delivery_updated",
        actor_id=user.id,
        transfer_id=transfer.id,
        version=result["version"],
    )
    return result
