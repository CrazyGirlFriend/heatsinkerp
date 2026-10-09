"""Bounded suggestions from existing documents; never create a stock association."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import MaterialTransfer

INPUT_FIELDS = (
    "serial_no",
    "material_name",
    "customer_code",
    "product_code",
    "part_no",
    "external_source",
    "outsourced_unit",
)
PROFILE_FIELDS = (
    "material_name",
    "finished_specification",
    "customer_code",
    "product_code",
    "part_no",
    "technical_requirements",
)


def input_suggestions(db: Session, field: str, query: str, limit: int) -> dict:
    """Group identical profiles so later batches do not crowd out alternatives."""
    column = getattr(MaterialTransfer, field)
    profile = (
        [getattr(MaterialTransfer, name) for name in PROFILE_FIELDS] if field == "serial_no" else []
    )
    filters = [MaterialTransfer.status != "voided", column.is_not(None), column != ""]
    if query.strip():
        term = query.strip().replace("!", "!!").replace("%", "!%").replace("_", "!_")
        filters.append(column.like(f"%{term}%", escape="!"))
    statement = (
        select(column, *profile, func.max(MaterialTransfer.id).label("latest"))
        .where(*filters)
        .group_by(column, *profile)
        .order_by(func.max(MaterialTransfer.id).desc())
        .limit(limit)
    )
    items = []
    for row in db.execute(statement):
        details = dict(zip(PROFILE_FIELDS, row[1:-1], strict=True)) if profile else {}
        latest = db.get(MaterialTransfer, row[-1])
        items.append({"value": row[0], "details": details, "source_batch_no": latest.batch_no})
    return {"items": items}
