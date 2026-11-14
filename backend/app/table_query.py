"""Column filters and ordering applied before list counts and pagination."""

from contextvars import ContextVar
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import Date, DateTime, String, cast

from .record_filters import day_bounds


class ColumnFilter(BaseModel):
    model_config = ConfigDict(extra="forbid")
    field: str = Field(min_length=1, max_length=80)
    kind: Literal["text", "number", "date", "select"] = "text"
    value: str = Field(default="", max_length=500)
    end: str = Field(default="", max_length=500)


class ColumnOrder(BaseModel):
    model_config = ConfigDict(extra="forbid")
    field: str = Field(min_length=1, max_length=80)
    direction: Literal["asc", "desc"]


class TableQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    filters: list[ColumnFilter] = Field(default_factory=list, max_length=30)
    sort: ColumnOrder | None = None


current_table_query: ContextVar[TableQuery | None] = ContextVar("table_query", default=None)


def parse_table_query(value: str | None):
    if not value:
        return None
    if len(value) > 16000:
        raise HTTPException(422, "表头筛选条件过长")
    try:
        return TableQuery.model_validate_json(value)
    except ValidationError as exc:
        raise HTTPException(422, "表头筛选或排序条件无效") from exc


def table_predicates(columns):
    query = current_table_query.get()
    result = []
    for item in query.filters if query else []:
        if item.field not in columns:
            raise HTTPException(422, f"不支持筛选字段：{item.field}")
        column = columns[item.field]
        try:
            if item.kind == "number":
                lower = Decimal(item.value) if item.value else None
                upper = Decimal(item.end) if item.end else None
                if any(value is not None and not value.is_finite() for value in (lower, upper)):
                    raise ValueError
                if lower is not None and upper is not None and lower > upper:
                    raise ValueError
                if lower is not None:
                    result.append(column >= lower)
                if upper is not None:
                    result.append(column <= upper)
            elif item.kind == "date":
                if item.value and item.end and item.value > item.end:
                    raise ValueError
                date_only = isinstance(column.type, Date) and not isinstance(column.type, DateTime)
                if item.value:
                    lower = date.fromisoformat(item.value)
                    result.append(column >= (lower if date_only else day_bounds(lower)[0]))
                if item.end:
                    upper = date.fromisoformat(item.end)
                    result.append(column <= upper if date_only else column < day_bounds(upper)[1])
            elif item.kind == "select":
                if item.value:
                    result.append(cast(column, String).in_(item.value.split(",")))
            elif item.value:
                result.append(cast(column, String).icontains(item.value, autoescape=True))
        except (ValueError, InvalidOperation) as exc:
            raise HTTPException(422, f"筛选值无效：{item.field}") from exc
    return result


def table_order(columns, *default):
    query = current_table_query.get()
    if not query or not query.sort:
        return default
    if query.sort.field not in columns:
        raise HTTPException(422, f"不支持排序字段：{query.sort.field}")
    column = columns[query.sort.field]
    return (
        column.is_(None),
        column.asc() if query.sort.direction == "asc" else column.desc(),
        *default,
    )


def query_statement(statement, *default_order, columns=None):
    fields = columns if columns is not None else dict(statement.selected_columns.items())
    return statement.where(*table_predicates(fields)).order_by(*table_order(fields, *default_order))
