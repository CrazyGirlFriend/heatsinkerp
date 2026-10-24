"""Turn a lot's untransferred stock into auditable same-team material batches."""

from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select

from . import material_transfer_workflow as workflow
from .auth import actor_name
from .batch_numbers import next_transfer_batch_numbers
from .material_weight import sludge_measurement, validate_material_amounts
from .models import MaterialTransfer, Team
from .processing_records import require_processing_team
from .schemas import SCRAP_MATERIAL_TYPES


def create_outputs(db, lot, payload, user, now, hold, task_fields=None, route_step_index=None):
    """Caller owns the source lock and commits outputs plus adjustment atomically."""
    require_processing_team(db, lot.next_team_id)
    if lot.material_type in SCRAP_MATERIAL_TYPES:
        raise HTTPException(422, "废料不能通过加工登记改为正常物料")
    if payload.processing_status is None:
        raise HTTPException(422, "请标明本批加工进度")
    if payload.quantity != sum(line.quantity for line in payload.outputs):
        raise HTTPException(422, "加工后件数须等于各项加工明细件数之和")
    if payload.processing_status == "complete" and any(
        line.role == "remaining" for line in payload.outputs
    ):
        raise HTTPException(422, "还有未加工大料时，请选择部分加工")
    team = db.scalar(
        select(Team)
        .where(Team.id == lot.next_team_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if not team.active:
        raise HTTPException(403, "班组已停用")
    items = []
    numbers = next_transfer_batch_numbers(db, len(payload.outputs))
    for output, number in zip(payload.outputs, numbers, strict=True):
        from .shared_material import allocate

        route_shared = bool(
            lot.shared_unallocated
            and lot.process_route_id
            and not lot.process_route.steps[
                route_step_index if route_step_index is not None else lot.process_step_index
            ].get("split_here")
        )
        serial_no, unallocated, member_fields = (
            (lot.serial_no, lot.shared_unallocated, {})
            if payload.processing_mode == "unit" or route_shared
            else allocate(lot, output)
        )
        if (
            output.role == "remaining"
            and lot.material_type is not None
            and output.material_type != lot.material_type
        ):
            raise HTTPException(422, "未加工大料须保留来源物料类型")
        validate_material_amounts(output.material_type, output.quantity, output.weight)
        measured = sludge_measurement(
            output.material_type,
            output.weight,
            output.sludge_gross_weight,
            output.sludge_content_percent,
        )
        fields = {key: getattr(lot, key) for key in workflow.DOCUMENT_FIELDS}
        fields.update(
            material_type=output.material_type,
            transfer_specification=output.transfer_specification,
            delivery_date=None,
            delivery_quantity=None,
        )
        fields.update(member_fields)
        item = MaterialTransfer(
            batch_no=number,
            serial_no=serial_no,
            shared_group_id=lot.shared_group_id,
            shared_unallocated=unallocated,
            entry_kind="processing_output",
            processing_role=output.role,
            rework_pending=payload.work_kind == "rework" and output.role == "remaining",
            rework_count=lot.rework_count
            + (1 if payload.work_kind == "rework" and output.role != "remaining" else 0),
            inspection_hold_root_id=hold.source_transfer_id
            if hold
            else lot.inspection_hold_root_id,
            source_transfer_id=lot.id,
            delivery_origin_id=lot.delivery_origin_id or lot.id,
            source_team_id=team.id,
            source_team_code=team.code,
            source_team_name=team.name,
            next_team_id=team.id,
            next_team_code=team.code,
            next_team_name=team.name,
            purpose_id=task_fields["purpose_id"]
            if task_fields
            and task_fields["purpose_name"] is not None
            and output.role != "remaining"
            else lot.purpose_id,
            purpose_name=task_fields["purpose_name"]
            if task_fields
            and task_fields["purpose_name"] is not None
            and output.role != "remaining"
            else lot.purpose_name,
            quantity=output.quantity,
            weight=output.weight,
            **fields,
            **measured,
            status="received",
            stock_tracked=True,
            notes=payload.reason,
            created_by=actor_name(user),
            created_by_user_id=user.id,
            received_by=actor_name(user),
            received_by_user_id=user.id,
            created_at=now,
            updated_at=now,
            received_at=now,
            history=[],
            losses=[],
        )
        db.add(item)
        items.append(item)
    # Obtain output IDs before appending the immutable adjustment snapshot.
    # Intermediate balances are invisible outside this transaction.
    db.flush()
    snapshots = [
        {
            "id": row.id,
            "batch_no": row.batch_no,
            "serial_no": row.serial_no,
            "shared_unallocated": row.shared_unallocated,
            "role": row.processing_role,
            "quantity": row.quantity,
            "weight": float(row.weight),
            "material_type": row.material_type,
            "transfer_specification": row.transfer_specification,
            "sludge_gross_weight": float(row.sludge_gross_weight)
            if row.sludge_gross_weight is not None
            else None,
            "sludge_content_percent": float(row.sludge_content_percent)
            if row.sludge_content_percent is not None
            else None,
        }
        for row in items
    ]
    return items, snapshots, sum((row.weight for row in items), Decimal(0))


def record_events(db, items, user):
    for item in items:
        db.refresh(item, attribute_names=["created_at", "updated_at", "received_at"])
        workflow._record_event(db, item, user, "processed", flush=False)
    db.flush()
