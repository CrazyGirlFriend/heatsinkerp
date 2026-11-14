"""A serial's operation plans and actual customer shipments, loaded on demand."""

from sqlalchemy import func, select

from .models import MaterialTransfer as Transfer
from .models import ProductionScheduleTask as Task
from .production_schedule_queries import iso
from .production_schedule_tasks import require_task, task_values
from .schedule_fulfillment import customer_shipments


def progress(db, task_id):
    selected = require_task(db, task_id)
    ids = list(
        db.scalars(
            select(Task.id)
            .where(Task.serial_no == selected.serial_no, Task.cancelled_at.is_(None))
            .order_by(Task.created_at.desc(), Task.id.desc())
        )
    )
    values = task_values(db, ids)
    tasks = [values[task_id] for task_id in ids]
    targets = []
    for task in tasks:
        active = [node for node in task["nodes"] if not node["cancelled_at"]]
        targets.append(
            sum(batch["target_quantity"] for batch in task["delivery_batches"])
            if task["delivery_batches"]
            else active[-1]["target_quantity"]
            if active
            else None
        )
    # Warehouse/inspection customer exits count once. Internal handoffs, outsourcing,
    # unfinished material, pending exits and voided records never count as shipped.
    filters = (Transfer.serial_no == selected.serial_no, *customer_shipments())
    total = db.execute(
        select(
            func.sum(Transfer.quantity),
            func.sum(Transfer.weight),
            func.max(Transfer.dispatched_at),
            func.count(Transfer.id),
        ).where(*filters)
    ).one()
    records = db.execute(
        select(
            Transfer.id,
            Transfer.batch_no,
            Transfer.source_team_name,
            Transfer.quantity,
            Transfer.weight,
            Transfer.dispatched_at,
        )
        .where(*filters)
        .order_by(Transfer.dispatched_at.desc(), Transfer.id.desc())
        .limit(20)
    )
    return {
        "serial_no": selected.serial_no,
        "tasks": tasks,
        "planned_quantity": sum(targets)
        if targets and all(t is not None for t in targets)
        else None,
        "shipped_quantity": int(total[0] or 0),
        "shipped_weight": float(total[1] or 0),
        "last_shipped_at": iso(total[2]),
        "shipment_count": total[3],
        "shipments": [
            {
                "id": row.id,
                "batch_no": row.batch_no,
                "team_name": row.source_team_name,
                "quantity": row.quantity,
                "weight": float(row.weight),
                "shipped_at": iso(row.dispatched_at),
            }
            for row in records
        ],
    }
