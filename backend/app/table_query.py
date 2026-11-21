"""Column filters and ordering applied before list counts and pagination."""

from contextvars import ContextVar
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import Date, DateTime, String, and_, cast, false, func, or_, select

from .config import settings
from .record_filters import day_bounds


class ColumnFilter(BaseModel):
    model_config = ConfigDict(extra="forbid")
    field: str = Field(min_length=1, max_length=80)
    kind: Literal["text", "number", "date", "select"] = "text"
    value: str = Field(default="", max_length=500)
    end: str = Field(default="", max_length=500)
    operator: (
        Literal[
            "contains",
            "not_contains",
            "eq",
            "ne",
            "starts_with",
            "ends_with",
            "gt",
            "gte",
            "lt",
            "lte",
            "between",
            "blank",
            "not_blank",
            "in",
            "not_in",
        ]
        | None
    ) = None
    values: list[str | None] = Field(default_factory=list, max_length=1000)


class ColumnOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    field: str = Field(min_length=1, max_length=80)
    kind: Literal["text", "number", "date", "select"] = "text"
    search: str = Field(default="", max_length=160)
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=100, ge=1, le=200)


class ColumnOrder(BaseModel):
    model_config = ConfigDict(extra="forbid")
    field: str = Field(min_length=1, max_length=80)
    direction: Literal["asc", "desc"]


class TableQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    filters: list[ColumnFilter] = Field(default_factory=list, max_length=30)
    sort: ColumnOrder | None = None
    options: ColumnOptions | None = None


current_table_query: ContextVar[TableQuery | None] = ContextVar("table_query", default=None)


def parse_table_query(value: str | None):
    if not value:
        return None
    if len(value) > 100000:
        raise HTTPException(422, "表头筛选条件过长")
    try:
        return TableQuery.model_validate_json(value)
    except ValidationError as exc:
        raise HTTPException(422, "表头筛选或排序条件无效") from exc


def date_predicate(column, operator, value, end=""):
    day = date.fromisoformat(value) if value else None
    last = date.fromisoformat(end) if end else None
    date_only = isinstance(column.type, Date) and not isinstance(column.type, DateTime)
    start, stop = (
        ((day, day + timedelta(days=1)) if date_only else day_bounds(day)) if day else (None, None)
    )
    if operator == "between":
        if day and last and day > last:
            raise ValueError
        upper = (last + timedelta(days=1) if date_only else day_bounds(last)[1]) if last else None
        return and_(
            *([column >= start] if start is not None else []),
            *([column < upper] if upper is not None else []),
        )
    if day is None:
        raise ValueError
    if operator == "eq":
        return and_(column >= start, column < stop)
    if operator == "ne":
        return or_(column < start, column >= stop)
    if operator == "gt":
        return column >= stop
    if operator == "gte":
        return column >= start
    if operator == "lt":
        return column < start
    if operator == "lte":
        return column < stop
    raise ValueError


def column_predicate(column, item):
    text = cast(column, String)
    blank = or_(column.is_(None), text == "")
    operator = item.operator
    if operator in ("blank", "not_blank"):
        return blank if operator == "blank" else ~blank
    if operator in ("in", "not_in"):
        values = [value for value in item.values if value not in (None, "")]
        match = or_(
            (or_(*(date_predicate(column, "eq", value) for value in values)) if values else false())
            if item.kind == "date"
            else text.in_(values),
            blank if any(value in (None, "") for value in item.values) else false(),
        )
        return match if operator == "in" else ~func.coalesce(match, False)
    if not item.value and not item.end:
        return None
    if item.kind == "date":
        return date_predicate(column, operator or "between", item.value, item.end)
    if item.kind == "number":

        def parse(value):
            number = Decimal(value)
            if not number.is_finite():
                raise ValueError
            return number

        lower, upper = (
            parse(item.value) if item.value else None,
            parse(item.end) if item.end else None,
        )
        operator = operator or "between"
        if operator == "between":
            if lower is not None and upper is not None and lower > upper:
                raise ValueError
            return and_(
                *([column >= lower] if lower is not None else []),
                *([column <= upper] if upper is not None else []),
            )
        if lower is None:
            raise ValueError
        if operator == "eq":
            return column == lower
        if operator == "ne":
            return column != lower
        if operator == "gt":
            return column > lower
        if operator == "gte":
            return column >= lower
        if operator == "lt":
            return column < lower
        if operator == "lte":
            return column <= lower
        raise ValueError
    if item.kind == "select" and operator is None:
        return text.in_(item.value.split(","))
    if operator == "eq":
        return text == item.value
    if operator == "ne":
        return and_(~blank, text != item.value)
    if operator == "starts_with":
        return text.istartswith(item.value, autoescape=True)
    if operator == "ends_with":
        return text.iendswith(item.value, autoescape=True)
    if operator == "not_contains":
        return and_(~blank, ~text.icontains(item.value, autoescape=True))
    if operator in (None, "contains"):
        return text.icontains(item.value, autoescape=True)
    raise ValueError


def table_predicates(columns, *, matches=None, skip_fields=()):
    query = current_table_query.get()
    result = []
    for item in query.filters if query else []:
        if item.field in skip_fields:
            continue
        if item.field not in columns:
            raise HTTPException(422, f"不支持筛选字段：{item.field}")
        if query.options and item.field == query.options.field:
            continue
        column = columns[item.field]
        try:
            predicate = (
                matches[item.field](item)
                if matches and item.field in matches
                else column_predicate(column, item)
            )
            if predicate is not None:
                result.append(predicate)
        except (ValueError, InvalidOperation) as exc:
            raise HTTPException(422, f"筛选值无效：{item.field}") from exc
    return result


class TableOptionsReady(Exception):
    """Return an authorized list's distinct values at the HTTP boundary."""

    def __init__(self, payload):
        self.payload = payload


def table_options(db, statement, columns):
    query = current_table_query.get()
    options = query.options if query else None
    if options is None:
        return
    if options.field not in columns:
        raise HTTPException(422, f"不支持筛选字段：{options.field}")
    column = columns[options.field]
    # Preserve the list's joins, access scope and filters, before pagination.
    values = (
        statement.with_only_columns(
            func.nullif(cast(column, String), "").label("value"), maintain_column_froms=True
        )
        .order_by(None)
        .subquery()
    )
    value = values.c.value
    selection = select(value).distinct()
    if options.search:
        if options.kind == "date":
            try:
                parts = [int(part) for part in options.search.split("-")]
                lower = date(*parts, *([1] * (3 - len(parts))))
                upper = (
                    date(lower.year + 1, 1, 1)
                    if len(parts) == 1
                    else date(lower.year + (lower.month == 12), lower.month % 12 + 1, 1)
                    if len(parts) == 2
                    else lower + timedelta(days=1)
                )
                date_only = isinstance(column.type, Date) and not isinstance(column.type, DateTime)
                start = str(lower) if date_only else str(day_bounds(lower)[0])
                stop = str(upper) if date_only else str(day_bounds(upper)[0])
                selection = selection.where(value >= start, value < stop)
            except (ValueError, TypeError):
                selection = selection.where(False)
        else:
            selection = selection.where(value.icontains(options.search, autoescape=True))
    rows = list(
        db.scalars(
            selection.order_by(value.is_not(None), value)
            .offset(options.offset)
            .limit(options.limit + 1)
        )
    )
    result = rows[: options.limit]
    if options.kind == "date":
        date_only = isinstance(column.type, Date) and not isinstance(column.type, DateTime)
        result = list(
            dict.fromkeys(
                None
                if value is None
                else value[:10]
                if date_only
                else datetime.fromisoformat(value)
                .replace(tzinfo=timezone.utc)
                .astimezone(ZoneInfo(settings.factory_timezone))
                .date()
                .isoformat()
                if value
                else None
                for value in result
            )
        )
    raise TableOptionsReady(
        {
            "values": result,
            "has_more": len(rows) > options.limit,
            "next_offset": options.offset + min(len(rows), options.limit),
        }
    )


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


def query_statement(statement, *default_order, columns=None, db=None):
    fields = columns if columns is not None else dict(statement.selected_columns.items())
    statement = statement.where(*table_predicates(fields))
    if db is not None:
        table_options(db, statement, fields)
    return statement.order_by(*table_order(fields, *default_order))
