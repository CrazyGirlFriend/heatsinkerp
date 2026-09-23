"""Shared team balances grouped by serial, nature, specification and origin.

Aggregate the shared stock ledger before filtering/pagination. A row's anchor is
an actual received lot; it also scopes drill-down and outbound source selection.
"""
from datetime import date, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import Field, model_validator
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session

from .auth import get_current_user
from .database import get_db
from .material_analytics import META_FIELDS, SearchField, SerialFilters, serial_predicates, serial_table
from .material_stock import BALANCE_KEYS, balance_dict, literal_query, require_team, stock_table
from .material_transfer_workflow import material_transfer_dict, material_transfer_list_options
from .models import MaterialLoss, MaterialTransfer, User, utcnow
from .record_filters import RecordFilters, day_bounds, urgent_serials
from .serial_urgency import urgency_dict, urgency_map
from .warehouse_receipts import require_warehouse

router = APIRouter(prefix="/api/team-materials", tags=["classified inventory"])
mt = MaterialTransfer
WarehouseSearchField = Literal[SearchField, "source", "on_hand_quantity", "on_hand_weight"]


class WarehouseInventoryFilters(SerialFilters):
    search_field: WarehouseSearchField = "all"
    availability: Literal["current", "all", "available", "scrap"] = "current"
    receipt_source: Literal["external", "return", "internal", "opening"] | None = None
    source_team_id: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def validate_search(self):
        # Share numeric/date validation without treating warehouse balances as
        # serial totals. The parent's field validator is deliberately overridden.
        field = {"source": "material_name", "on_hand_quantity": "available_quantity", "on_hand_weight": "available_weight"}.get(self.search_field, self.search_field)
        SerialFilters(query=self.query, search_field=field, search_operator=self.search_operator)
        return self


def origin_columns():
    manual = mt.entry_kind == "warehouse_receipt"
    return {
        "serial_no": mt.serial_no,
        "material_name": func.coalesce(mt.material_name, ""),
        "transfer_specification": func.coalesce(mt.transfer_specification, ""),
        "material_type": func.coalesce(mt.material_type, ""),
        "receipt_source": case((mt.entry_kind == "opening_stock", "opening"), (~manual, "internal"), (mt.receipt_kind == "return", "return"), else_="external"),
        "source_team_id": case((~manual, mt.source_team_id), else_=None),
        "external_source": case((manual, func.coalesce(mt.external_source, "")), else_=""),
    }


def warehouse_groups(team_id, filters):
    stock = stock_table(team_id)
    origins = origin_columns()
    moves = select(mt.source_transfer_id.label("lot_id"), func.max(mt.updated_at).label("at")).where(
        mt.source_team_id == team_id, mt.source_transfer_id.is_not(None)).group_by(mt.source_transfer_id).subquery()
    losses = select(MaterialLoss.source_transfer_id.label("lot_id"), func.max(MaterialLoss.created_at).label("at")).where(
        MaterialLoss.team_id == team_id).group_by(MaterialLoss.source_transfer_id).subquery()
    recent = case((moves.c.at > mt.updated_at, moves.c.at), else_=mt.updated_at)
    recent = case((losses.c.at > recent, losses.c.at), else_=recent)
    meta = []
    for name in META_FIELDS:
        if name in origins:
            continue
        column = getattr(mt, name)
        meta.extend([case((func.count(func.distinct(column)) <= 1, func.min(column)), else_=None).label(name),
                     func.count(func.distinct(column)).label(name + "_count")])
    calendar = RecordFilters(date_from=filters.date_from, date_to=filters.date_to)
    calendar.dates(mt.received_at)  # Validate the range even for an empty ledger.
    matching_dates = True
    if filters.date_from or filters.date_to:
        movement_matches = select(mt.source_transfer_id).where(mt.source_team_id == team_id, or_(
            *(and_(*calendar.dates(column)) for column in (mt.created_at, mt.received_at, mt.dispatched_at, mt.voided_at))))
        loss_matches = select(MaterialLoss.source_transfer_id).where(MaterialLoss.team_id == team_id, *calendar.dates(MaterialLoss.created_at))
        matching_dates = or_(and_(*calendar.dates(mt.received_at)), mt.id.in_(movement_matches), mt.id.in_(loss_matches))
    return select(*(column.label(name) for name, column in origins.items()),
        func.min(mt.id).label("group_id"), func.count(mt.id).label("batch_count"),
        func.max(case((origins["receipt_source"] == "internal", mt.source_team_name), else_=origins["external_source"])).label("source_name"),
        func.max(recent).label("last_activity_at"), func.max(case((matching_dates, 1), else_=0)).label("matches_date"),
        *(func.sum(stock.c[key]).label(key) for key in BALANCE_KEYS), *meta
    ).select_from(stock).join(mt, mt.id == stock.c.transfer_id).outerjoin(moves, moves.c.lot_id == mt.id).outerjoin(
        losses, losses.c.lot_id == mt.id).group_by(*origins.values()).subquery()


def group_conditions(table, anchor):
    return [column.is_not_distinct_from(anchor[name]) for name, column in table.items()]


def list_inventory(db, team_id, filters):
    require_team(db, team_id)
    table = warehouse_groups(team_id, filters)
    conditions = [table.c.matches_date == 1]
    if filters.availability != "all":
        prefix = "on_hand" if filters.availability == "current" else "scrap" if filters.availability == "scrap" else "available"
        conditions.append(or_(table.c[prefix + "_quantity"] > 0, table.c[prefix + "_weight"] > 0))
    for key in ("serial_no", "material_name", "material_type", "receipt_source", "source_team_id"):
        value = getattr(filters, key)
        if value is not None:
            if (key, value) in (("material_name", "未填写材质"), ("material_type", "unknown")):
                value = ""
            conditions.append(table.c[key] == value)
    if filters.urgent_only:
        conditions.append(table.c.serial_no.in_(urgent_serials()))
    term = (filters.query or "").strip()
    field = filters.search_field
    matching_sources = [*group_conditions(origin_columns(), table.c), mt.next_team_id == team_id,
                        mt.status == "received", mt.stock_tracked.is_(True)]
    if term:
        if field == "urgency":
            urgent = table.c.serial_no.in_(urgent_serials())
            conditions.append(urgent if term == "urgent" else ~urgent)
        elif field == "last_activity_at":
            start, end = day_bounds(date.fromisoformat(term))
            conditions.append(and_(table.c.last_activity_at >= start, table.c.last_activity_at < end))
        elif field.endswith(("_quantity", "_weight")):
            from decimal import Decimal
            # Pending incoming is intentionally not warehouse stock; outbound
            # pending belongs to the already-deducted source group's history.
            column = mt.finished_quantity if field == "finished_quantity" else table.c.reserved_quantity if field == "pending_outgoing_quantity" else table.c.reserved_weight if field == "pending_outgoing_weight" else table.c[field] if field in table.c else None
            if column is None:
                conditions.append(False)
            else:
                if field.endswith("_weight"):
                    column = func.round(column, 3)
                value = Decimal(term)
                predicate = column >= value if filters.search_operator == "gte" else column <= value if filters.search_operator == "lte" else column == value
                conditions.append(select(mt.id).where(*matching_sources, predicate).exists() if field == "finished_quantity" else predicate)
        elif field in ("all", "source"):
            source_kind = case((table.c.receipt_source == "opening", "期初库存"), (table.c.receipt_source == "internal", "车间转入"), (table.c.receipt_source == "return", "外部退回"), else_="外部来料")
            columns = [table.c.source_name, source_kind]
            if field == "all":
                columns += [table.c[name] for name in ("serial_no", "material_name", "transfer_specification")]
            matches = literal_query(term, columns)
            if field == "all":
                matches = or_(matches, select(mt.id).where(*matching_sources,
                    literal_query(term, [mt.customer_code, mt.product_code, mt.finished_specification])).exists())
            conditions.append(matches)
        else:
            conditions.append(select(mt.id).where(*matching_sources, literal_query(term, [getattr(mt, field)])).exists())
    # Existing chart deep links still select matching serials, while source/type
    # filters above constrain the displayed group quantities themselves.
    if any((filters.stock_age, filters.waiting_direction, filters.activity_day, filters.has_loss, filters.flow_direction)):
        serial = serial_table(team_id)
        scope_filters = SerialFilters(**{**filters.model_dump(exclude={"receipt_source", "source_team_id"}),
            "query": None, "search_field": "all", "availability": "all", "material_type": None, "material_name": None,
            "date_from": None, "date_to": None})
        conditions.append(table.c.serial_no.in_(select(serial.c.serial_no).where(*serial_predicates(team_id, serial, scope_filters, utcnow()))))
    total = db.scalar(select(func.count()).select_from(table).where(*conditions)) or 0
    rows = db.execute(select(table).where(*conditions).order_by(table.c.serial_no, table.c.material_name, table.c.group_id)
        .offset((filters.page - 1) * filters.page_size).limit(filters.page_size)).mappings().all()
    priorities = urgency_map(db, [row["serial_no"] for row in rows])
    items = []
    for row in rows:
        item = dict(row)
        item.pop("matches_date")
        item.update(balance_dict(row))
        item["urgency"] = priorities.get(row["serial_no"], urgency_dict(None))
        item["last_activity_at"] = row["last_activity_at"].replace(tzinfo=timezone.utc).isoformat() if row["last_activity_at"] else None
        items.append(item)
    return {"items": items, "total": total, "page": filters.page, "page_size": filters.page_size}


def list_group_sources(db, team_id, group_id, user, *, page=1, page_size=20, current_only=False, query=None, record_filters=None):
    require_team(db, team_id)
    origins = origin_columns()
    anchor = db.execute(select(*(column.label(name) for name, column in origins.items())).where(
        mt.id == group_id, mt.next_team_id == team_id, mt.status == "received", mt.stock_tracked.is_(True))).mappings().first()
    if anchor is None:
        raise HTTPException(404, "未找到该班组的库存来源")
    stock = stock_table(team_id)
    statement = select(mt, stock).join(stock, stock.c.transfer_id == mt.id).where(*group_conditions(origins, anchor))
    if current_only:
        statement = statement.where(or_(stock.c.on_hand_quantity > 0, stock.c.on_hand_weight > 0))
    if query and query.strip():
        statement = statement.where(literal_query(query, [mt.batch_no, mt.serial_no, mt.material_name, mt.source_batch_no]))
    statement = statement.where(*(record_filters or RecordFilters()).predicates(mt.received_at, mt.serial_no))
    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    rows = db.execute(statement.options(*material_transfer_list_options()).order_by(mt.received_at.desc(), mt.id.desc()).offset((page - 1) * page_size).limit(page_size)).unique().all()
    return {"items": [{"transfer": material_transfer_dict(row[0], user, include_history=False), **balance_dict(row._mapping)} for row in rows],
            "total": total, "page": page, "page_size": page_size}


@router.get("/{team_id}/inventory")
def inventory_endpoint(filters: Annotated[WarehouseInventoryFilters, Query()], team_id: int = Path(ge=1),
                       _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return list_inventory(db, team_id, filters)


@router.get("/{team_id}/inventory/{group_id}/sources")
def sources_endpoint(record_filters: RecordFilters = Depends(), team_id: int = Path(ge=1), group_id: int = Path(ge=1),
                     page: int = Query(default=1, ge=1), page_size: int = Query(default=20, ge=1, le=100),
                     current_only: bool = False, query: str | None = Query(default=None, max_length=160),
                     user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return list_group_sources(db, team_id, group_id, user, page=page, page_size=page_size,
                              current_only=current_only, query=query, record_filters=record_filters)


# Keep published warehouse URLs scoped to the warehouse for existing clients.
@router.get("/{team_id}/warehouse-inventory", include_in_schema=False)
def legacy_inventory_endpoint(filters: Annotated[WarehouseInventoryFilters, Query()], team_id: int = Path(ge=1),
                              _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_warehouse(require_team(db, team_id))
    return list_inventory(db, team_id, filters)


@router.get("/{team_id}/warehouse-inventory/{group_id}/sources", include_in_schema=False)
def legacy_sources_endpoint(record_filters: RecordFilters = Depends(), team_id: int = Path(ge=1), group_id: int = Path(ge=1),
                            page: int = Query(default=1, ge=1), page_size: int = Query(default=20, ge=1, le=100),
                            current_only: bool = False, query: str | None = Query(default=None, max_length=160),
                            user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_warehouse(require_team(db, team_id))
    return list_group_sources(db, team_id, group_id, user, page=page, page_size=page_size,
                              current_only=current_only, query=query, record_filters=record_filters)
