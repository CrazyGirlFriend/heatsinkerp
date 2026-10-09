"""Bounded suggestions from existing documents; never create a stock association."""

from sqlalchemy import case, func, select
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
    """Use one latest document per value, with an exact match before similar values."""
    column = getattr(MaterialTransfer, field)
    filters = [MaterialTransfer.status != "voided", column.is_not(None), column != ""]
    if query.strip():
        term = query.strip().replace("!", "!!").replace("%", "!%").replace("_", "!_")
        filters.append(column.like(f"%{term}%", escape="!"))
    statement = (
        select(column, func.max(MaterialTransfer.id).label("latest"))
        .where(*filters)
        .group_by(column)
        .order_by(case((column == query.strip(), 0), else_=1), func.max(MaterialTransfer.id).desc())
        .limit(limit)
    )
    items = []
    for row in db.execute(statement):
        latest = db.get(MaterialTransfer, row[-1])
        details = (
            {name: getattr(latest, name) for name in PROFILE_FIELDS} if field == "serial_no" else {}
        )
        items.append({"value": row[0], "details": details, "source_batch_no": latest.batch_no})
    return {"items": items}
