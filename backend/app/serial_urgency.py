"""Read historical serial urgency metadata for existing response contracts."""

from datetime import timezone

from sqlalchemy import select

from .models import SerialUrgency


def urgency_dict(row):
    return {
        "urgent": bool(row and row.urgent),
        "reason": row.reason if row else None,
        "version": row.version if row else 0,
        "updated_by": row.updated_by if row else None,
        "updated_at": row.updated_at.replace(tzinfo=timezone.utc).isoformat() if row else None,
    }


def urgency_map(db, serials):
    return (
        {
            row.serial_no: urgency_dict(row)
            for row in db.scalars(select(SerialUrgency).where(SerialUrgency.serial_no.in_(serials)))
        }
        if serials
        else {}
    )
