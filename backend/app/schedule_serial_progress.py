"""The selected schedule's operation plans and customer shipments, loaded on demand."""

from sqlalchemy import func, select

from .models import MaterialTransfer as Transfer
from .production_schedule_queries import iso
from .production_schedule_tasks import require_task, task_values
from .schedule_fulfillment import attributed_customer_shipments


def progress(db, task_id):
    selected = require_task(db, task_id)
    task = task_values(db, [task_id])[task_id]
    shipments = attributed_customer_shipments()
    # Use the same attribution as the list: another batch of this serial must not
    # inflate the selected schedule's shipment quantity or completion percentage.
    filters = (Transfer.id.in_(select(shipments.c.id).where(shipments.c.task_id == task_id)),)
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
        "tasks": [task],
        "planned_quantity": task["order_quantity"],
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
