"""Bounded suggestions from existing documents; never create a stock association."""

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from .models import MaterialTransfer, SharedMaterialGroup, SharedMaterialMember

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
    if field == "serial_no":
        filters.append(MaterialTransfer.shared_unallocated.is_(False))
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
    latest_rows = statement.subquery()
    profiles = db.execute(
        select(
            latest_rows.c[0].label("value"),
            MaterialTransfer.batch_no,
            *(getattr(MaterialTransfer, name) for name in PROFILE_FIELDS),
        )
        .join(MaterialTransfer, MaterialTransfer.id == latest_rows.c.latest)
        .order_by(
            case((latest_rows.c[0] == query.strip(), 0), else_=1),
            latest_rows.c.latest.desc(),
        )
    ).mappings()
    items = [
        {
            "value": row["value"],
            "details": {name: row[name] for name in PROFILE_FIELDS} if field == "serial_no" else {},
            "source_batch_no": row["batch_no"],
        }
        for row in profiles
    ]
    if field == "serial_no":
        member_query = (
            select(
                SharedMaterialMember,
                SharedMaterialGroup.batch_no,
                *(getattr(MaterialTransfer, name) for name in PROFILE_FIELDS),
            )
            .join(SharedMaterialGroup, SharedMaterialGroup.id == SharedMaterialMember.group_id)
            .join(MaterialTransfer, MaterialTransfer.batch_no == SharedMaterialGroup.batch_no)
        )
        if query.strip():
            term = query.strip().replace("!", "!!").replace("%", "!%").replace("_", "!_")
            member_query = member_query.where(
                SharedMaterialMember.serial_no.like(f"%{term}%", escape="!")
            )
        member_query = member_query.order_by(
            case((SharedMaterialMember.serial_no == query.strip(), 0), else_=1),
            SharedMaterialMember.id.desc(),
        ).limit(limit)
        for row in db.execute(member_query):
            member, batch_no = row[:2]
            if any(item["value"] == member.serial_no for item in items):
                continue
            details = dict(zip(PROFILE_FIELDS, row[2:], strict=True))
            details.update(
                customer_code=member.customer_code,
                finished_specification=member.finished_specification,
            )
            items.append(
                {"value": member.serial_no, "details": details, "source_batch_no": batch_no}
            )
        items.sort(key=lambda item: item["value"] != query.strip())
    return {"items": items[:limit]}
