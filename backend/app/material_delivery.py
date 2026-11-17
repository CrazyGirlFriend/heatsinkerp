"""Batch-owned delivery dates, inherited without duplicating order quantities."""

from datetime import timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from .auth import can_manage_team
from .config import settings
from .models import utcnow
from .observability import record

FIELDS = ("delivery_date", "delivery_quantity")


def with_schedule(db, documents):
    """Carry the lot's actual commitment, never the latest task for its serial."""
    from sqlalchemy import select

    from .models import ProductionScheduleTask as Task
    from .schedule_fulfillment import target_columns
    from .schedule_task_identity import stock_task_bindings, task_batch_number_column

    documents = list(documents)
    if not documents:
        return documents
    bindings = stock_task_bindings()
    quantity, due, _ = target_columns(db)
    rows = db.execute(
        select(
            bindings.c.lot_id,
            Task.id,
            due.label("due_at"),
            quantity.label("required_quantity"),
            task_batch_number_column(),
        )
        .join(Task, Task.id == bindings.c.task_id)
        .where(bindings.c.lot_id.in_([item["id"] for item in documents]))
    ).all()
    by_id = {row.lot_id: row for row in rows}
    for item in documents:
        if row := by_id.get(item["id"]):
            item.update(schedule_task_id=row.id, task_batch_number=row[4], can_edit_delivery=False)
            if row.due_at:
                item["schedule_due_at"] = row.due_at.replace(tzinfo=timezone.utc).isoformat()
                item["delivery_date"] = (
                    row.due_at.replace(tzinfo=timezone.utc)
                    .astimezone(ZoneInfo(settings.factory_timezone))
                    .date()
                    .isoformat()
                )
            item["delivery_quantity"] = row.required_quantity
    return documents


def validate_pair(day, quantity):
    if (day is None) != (quantity is None):
        raise HTTPException(422, "请同时填写要求发货日期和应发成品件数")


def can_edit(transfer, user):
    owner = transfer.source_team_id or transfer.next_team_id
    return bool(
        user
        and can_manage_team(user, owner)
        and transfer.status != "voided"
        and transfer.source_transfer_id is None
        and transfer.delivery_origin_id is None
        and transfer.entry_kind in ("transfer", "warehouse_receipt")
        and transfer.receipt_kind != "return"
        and transfer.shared_group_id is None
    )


def document(transfer, user):
    if transfer.shared_group_id:
        member = next(
            (
                member
                for member in transfer.shared_group.members
                if not transfer.shared_unallocated and member.serial_no == transfer.serial_no
            ),
            None,
        )
        return {
            "delivery_date": member.delivery_date if member else None,
            "delivery_quantity": member.delivery_quantity if member else None,
            "delivery_origin_batch_no": transfer.shared_group.batch_no,
            "can_edit_delivery": False,
        }
    origin = transfer.delivery_origin if transfer.delivery_origin_id else transfer
    day, quantity = origin.delivery_date, origin.delivery_quantity
    # Older orders keep their requirement in the reviewed engineering attachment.
    # Raw intake remains optional; exact schedule data overrides this on read.
    if not day and transfer.source_transfer_id and transfer.process_route:
        order = transfer.process_route.source_data.get("order_document") or {}
        if order.get("serial_no") == transfer.serial_no:
            fields = order.get("receipt_fields") or {}
            day = (fields.get("delivery_date") or {}).get("value")
            quantity = (fields.get("delivery_quantity") or {}).get("value")
    return {
        "delivery_date": day,
        "delivery_quantity": quantity,
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
