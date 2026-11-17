"""Seed metadata retained from before the urgency feature was retired."""

from app.database import SessionLocal
from app.models import SerialUrgency


def seed_legacy_urgency(serial, urgent=True):
    with SessionLocal() as db:
        row = db.get(SerialUrgency, serial)
        if row is None:
            row = SerialUrgency(serial_no=serial, version=1)
            db.add(row)
        row.urgent = urgent
        row.reason = "历史加急记录" if urgent else None
        row.updated_by = "历史管理员"
        db.commit()
