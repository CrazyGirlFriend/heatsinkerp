"""Explicit search semantics shared by list filters and query-plan verification."""

from decimal import Decimal

from fastapi import HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import or_

from .models import MaterialTransfer
from .schemas import DIRECT_MATERIAL_TYPE_PATTERN
from .team_constants import EXTERNAL_ENTRY_KINDS

INDEXED_SEARCH_FIELDS = {
    name: getattr(MaterialTransfer, name)
    for name in (
        "batch_no",
        "serial_no",
        "source_batch_no",
        "product_code",
        "customer_code",
        "material_name",
    )
}
CONTAINS_SEARCH_FIELDS = (
    *INDEXED_SEARCH_FIELDS.values(),
    MaterialTransfer.source_team_code,
    MaterialTransfer.source_team_name,
    MaterialTransfer.next_team_code,
    MaterialTransfer.next_team_name,
    MaterialTransfer.created_by,
    MaterialTransfer.sent_employee_name,
    # Search the document snapshot so renamed/disabled activities remain findable.
    MaterialTransfer.purpose_name,
)


def team_scope_predicate(team_id: int, direction: str = "all"):
    if direction == "outgoing":
        return MaterialTransfer.source_team_id == team_id
    if direction == "incoming":
        return MaterialTransfer.next_team_id == team_id
    if direction != "all":
        raise ValueError("unknown material transfer direction")
    return or_(MaterialTransfer.source_team_id == team_id, MaterialTransfer.next_team_id == team_id)


def search_predicate(query: str, search_field: str = "all", search_mode: str = "contains"):
    """Never infer a mode or silently narrow an existing contains search."""
    if search_field == "all":
        fields = (
            CONTAINS_SEARCH_FIELDS
            if search_mode == "contains"
            else tuple(INDEXED_SEARCH_FIELDS.values())
        )
    else:
        fields = (INDEXED_SEARCH_FIELDS[search_field],)
    term = query.strip()
    from .shared_material import serial_match

    shared = (
        serial_match(MaterialTransfer.serial_no, term, search_mode)
        if search_field in ("all", "serial_no")
        else False
    )
    if search_mode == "exact":
        return or_(shared, *(field == term for field in fields))
    # Treat user-supplied SQL wildcards literally, including the escape itself.
    escaped = term.replace("!", "!!").replace("%", "!%").replace("_", "!_")
    pattern = f"{escaped}%" if search_mode == "prefix" else f"%{escaped}%"
    return or_(shared, *(field.like(pattern, escape="!") for field in fields))


class TransferColumnFilters(BaseModel):
    """Column filters are intersected in SQL before counting and pagination."""

    serial_query: str = Field(default="", max_length=160)
    material_query: str = Field(default="", max_length=160)
    batch_query: str = Field(default="", max_length=160)
    purpose_query: str = Field(default="", max_length=160)
    source_team_ids: str = Field(default="", max_length=1000, pattern=r"^(\d+(,\d+)*)?$")
    next_team_ids: str = Field(default="", max_length=1000, pattern=r"^(\d+(,\d+)*)?$")
    statuses: str = Field(
        default="",
        max_length=100,
        pattern=r"^((pending|received|dispatched|voided)(,(pending|received|dispatched|voided))*)?$",
    )
    material_types: str = Field(default="", max_length=500)
    quantity_min: int | None = Field(default=None, ge=0, le=2147483647)
    quantity_max: int | None = Field(default=None, ge=0, le=2147483647)
    weight_min: Decimal | None = Field(default=None, ge=0, max_digits=17, decimal_places=6)
    weight_max: Decimal | None = Field(default=None, ge=0, max_digits=17, decimal_places=6)

    def predicates(self):
        import re

        filters = []
        for value, field in (
            (self.serial_query, "serial_no"),
            (self.material_query, "material_name"),
            (self.batch_query, "batch_no"),
        ):
            if value.strip():
                filters.append(search_predicate(value, field))
        if self.purpose_query.strip():
            filters.extend(
                [
                    MaterialTransfer.entry_kind.not_in(EXTERNAL_ENTRY_KINDS),
                    MaterialTransfer.purpose_name.contains(
                        self.purpose_query.strip(), autoescape=True
                    ),
                ]
            )
        for name in ("source_team", "next_team"):
            value = getattr(self, name + "_ids")
            if value:
                ids = {int(part) for part in value.split(",")}
                if any(item < 1 or item > 2147483647 for item in ids):
                    raise HTTPException(422, "班组编号无效")
                filters.append(getattr(MaterialTransfer, name + "_id").in_(ids))
        if self.statuses:
            filters.append(MaterialTransfer.status.in_(self.statuses.split(",")))
        if self.material_types:
            values = self.material_types.split(",")
            if any(not re.fullmatch(DIRECT_MATERIAL_TYPE_PATTERN, item) for item in values):
                raise HTTPException(422, "物料类型无效")
            filters.append(MaterialTransfer.material_type.in_(values))
        for field in ("quantity", "weight"):
            lower, upper = getattr(self, field + "_min"), getattr(self, field + "_max")
            if lower is not None and upper is not None and lower > upper:
                raise HTTPException(422, "最小值不能大于最大值")
            if lower is not None:
                filters.append(getattr(MaterialTransfer, field) >= lower)
            if upper is not None:
                filters.append(getattr(MaterialTransfer, field) <= upper)
        return filters
