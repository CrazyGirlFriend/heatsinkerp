"""Read-only team dashboards; aggregate before pagination, never infer production output."""
from datetime import date, timedelta, timezone
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Path, Query
from pydantic import BeforeValidator, Field
from sqlalchemy import and_, case, cast, func, or_, select, String
from sqlalchemy.orm import Session

from .auth import get_current_user
from .config import settings
from .database import get_db
from .record_filters import RecordFilters, day_bounds, urgent_serials
from .serial_urgency import urgency_map, urgency_dict
from .models import MaterialLoss, MaterialTransfer, utcnow
from .material_stock import BALANCE_KEYS, balance_dict, literal_query, require_team, stock_table

router = APIRouter(prefix="/api/team-materials", dependencies=[Depends(get_current_user)])
Age = Literal["lt1", "1_3", "3_7", "ge7"]
Days = Annotated[Literal[7, 30], BeforeValidator(int)]
AGE_LABELS = {"lt1": "不足1天", "1_3": "1–3天", "3_7": "3–7天", "ge7": "7天及以上"}
META_FIELDS = ("material_name", "material_type", "transfer_specification", "finished_specification",
               "source_batch_no", "customer_code", "product_code", "finished_quantity")
mt = MaterialTransfer


class SerialFilters(RecordFilters):
    query: str | None = Field(default=None, max_length=160)
    serial_no: str | None = Field(default=None, max_length=80)
    material_name: str | None = Field(default=None, max_length=160)
    material_type: str | None = Field(default=None, max_length=32)
    availability: Literal["all", "available"] = "all"
    stock_age: Age | None = None
    waiting_age: Age | None = None
    waiting_direction: Literal["incoming", "outgoing"] | None = None
    activity_day: date | None = None
    activity_kind: Literal["incoming", "outgoing", "loss"] | None = None
    has_loss: bool = False
    flow_direction: Literal["incoming", "outgoing"] | None = None
    peer: str | None = Field(default=None, max_length=80)
    days: Days = 30
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)


def period(days, now):
    today = now.replace(tzinfo=timezone.utc).astimezone(ZoneInfo(settings.factory_timezone)).date()
    dates = [today - timedelta(days=offset) for offset in reversed(range(days))]
    return dates, day_bounds(dates[0])[0], now


def age_conditions(column, now):
    return {
        "lt1": column > now - timedelta(days=1),
        "1_3": and_(column <= now - timedelta(days=1), column > now - timedelta(days=3)),
        "3_7": and_(column <= now - timedelta(days=3), column > now - timedelta(days=7)),
        "ge7": column <= now - timedelta(days=7),
    }


def scope(team_id):
    return or_(mt.source_team_id == team_id, mt.next_team_id == team_id)


def flow(team_id, direction):
    if direction == "incoming":
        return mt.received_at, and_(mt.next_team_id == team_id, mt.status == "received")
    column, predicate = outgoing_flow()
    return column, and_(mt.source_team_id == team_id, predicate)


def outgoing_flow():
    """Internal transfer leaves at submission; external exits still need confirmation."""
    internal = mt.entry_kind == "transfer"
    return (case((internal, mt.created_at), else_=mt.dispatched_at),
            or_(and_(internal, mt.status.in_(["pending", "received"])),
                and_(mt.entry_kind.in_(["warehouse_outbound", "inspection_shipment"]), mt.status == "dispatched")))


def peer_key(direction):
    if direction == "incoming":
        return case((mt.entry_kind == "warehouse_receipt", "warehouse_receipt"), else_=cast(mt.source_team_id, String))
    return case((mt.entry_kind != "transfer", mt.entry_kind), else_=cast(mt.next_team_id, String))


def serial_table(team_id):
    stock = stock_table(team_id)
    balances = select(stock.c.serial_no, *(func.sum(stock.c[key]).label(key) for key in BALANCE_KEYS)).group_by(stock.c.serial_no).subquery()
    meta = []
    for field in META_FIELDS:
        column = getattr(mt, field)
        meta.extend([case((func.count(func.distinct(column)) <= 1, func.min(column)), else_=None).label(field),
                     func.count(func.distinct(column)).label(f"{field}_count")])
    pending = [func.sum(case((and_(getattr(mt, f"{side}_team_id") == team_id, mt.status == "pending"), getattr(mt, unit)), else_=0)).label(f"pending_{direction}_{unit}")
               for side, direction in (("next", "incoming"), ("source", "outgoing")) for unit in ("quantity", "weight")]
    core = select(mt.serial_no, func.max(mt.updated_at).label("last_transfer_at"), *meta, *pending).where(scope(team_id), mt.status != "voided").group_by(mt.serial_no).subquery()
    recent_loss = select(mt.serial_no, func.max(MaterialLoss.created_at).label("last_loss_at")).join(
        MaterialLoss, MaterialLoss.source_transfer_id == mt.id).where(MaterialLoss.team_id == team_id).group_by(mt.serial_no).subquery()
    return select(core, *(func.coalesce(balances.c[key], 0).label(key) for key in BALANCE_KEYS),
                  case((recent_loss.c.last_loss_at > core.c.last_transfer_at, recent_loss.c.last_loss_at), else_=core.c.last_transfer_at).label("last_activity_at")
                  ).outerjoin(balances, balances.c.serial_no == core.c.serial_no).outerjoin(recent_loss, recent_loss.c.serial_no == core.c.serial_no).subquery()


def serial_predicates(team_id, table, filters, now):
    result = []
    if filters.urgent_only:
        result.append(table.c.serial_no.in_(urgent_serials()))
    if filters.date_from or filters.date_to or (filters.activity_day and not filters.activity_kind):
        calendar = RecordFilters(date_from=filters.date_from or filters.activity_day, date_to=filters.date_to or filters.activity_day)
        # Match activity, then display full CURRENT balances. Never truncate
        # allocations or losses used to calculate stock.
        matches = select(mt.serial_no).where(scope(team_id), or_(
            and_(*calendar.dates(mt.created_at)), and_(*calendar.dates(mt.received_at)),
            and_(*calendar.dates(mt.dispatched_at)), and_(*calendar.dates(mt.voided_at))))
        loss_matches = select(mt.serial_no).join(MaterialLoss, MaterialLoss.source_transfer_id == mt.id).where(
            MaterialLoss.team_id == team_id, *calendar.dates(MaterialLoss.created_at))
        result.append(table.c.serial_no.in_(matches.union(loss_matches)))
    if filters.availability == "available":
        result.append(or_(table.c.available_quantity > 0, table.c.available_weight > 0))
    if filters.serial_no:
        result.append(table.c.serial_no == filters.serial_no.strip())
    if filters.query and filters.query.strip():
        matches = select(mt.serial_no).where(scope(team_id), mt.status != "voided", literal_query(filters.query, [mt.serial_no, mt.material_name, mt.product_code, mt.transfer_specification]))
        result.append(table.c.serial_no.in_(matches))
    stock = stock_table(team_id)
    remaining = or_(stock.c.on_hand_quantity > 0, stock.c.on_hand_weight > 0)
    if filters.material_type or filters.material_name or filters.stock_age:
        conditions = [remaining]
        if filters.material_type:
            conditions.append(func.coalesce(stock.c.material_type, "unknown") == filters.material_type)
        if filters.material_name:
            conditions.append(func.coalesce(stock.c.material_name, "未填写材质") == filters.material_name)
        if filters.stock_age:
            conditions.append(age_conditions(stock.c.received_at, now)[filters.stock_age])
        result.append(table.c.serial_no.in_(select(stock.c.serial_no).where(*conditions)))
    if filters.waiting_direction:
        conditions = [getattr(mt, "next_team_id" if filters.waiting_direction == "incoming" else "source_team_id") == team_id, mt.status == "pending"]
        if filters.waiting_age:
            conditions.append(age_conditions(mt.created_at, now)[filters.waiting_age])
        result.append(table.c.serial_no.in_(select(mt.serial_no).where(*conditions)))
    _, start, end = period(filters.days, now)
    if filters.has_loss or filters.activity_kind == "loss":
        if filters.activity_day:
            start, end = day_bounds(filters.activity_day)
        result.append(table.c.serial_no.in_(select(mt.serial_no).join(MaterialLoss, MaterialLoss.source_transfer_id == mt.id).where(
            MaterialLoss.team_id == team_id, MaterialLoss.created_at >= start, MaterialLoss.created_at < end)))
    elif filters.activity_day and filters.activity_kind:
        column, predicate = flow(team_id, filters.activity_kind)
        start, end = day_bounds(filters.activity_day)
        result.append(table.c.serial_no.in_(select(mt.serial_no).where(predicate, column >= start, column < end)))
    if filters.flow_direction and filters.peer:
        column, predicate = flow(team_id, filters.flow_direction)
        result.append(table.c.serial_no.in_(select(mt.serial_no).where(predicate, column >= start, column <= end, peer_key(filters.flow_direction) == filters.peer)))
    return result


def list_serials(db, team_id, filters):
    require_team(db, team_id)
    table = serial_table(team_id)
    conditions = serial_predicates(team_id, table, filters, utcnow())
    total = db.scalar(select(func.count()).select_from(table).where(*conditions)) or 0
    rows = db.execute(select(table).where(*conditions).order_by(table.c.last_activity_at.desc(), table.c.serial_no).offset(
        (filters.page - 1) * filters.page_size).limit(filters.page_size)).mappings().all()
    priorities = urgency_map(db, [row["serial_no"] for row in rows])
    items = []
    for row in rows:
        item = {"serial_no": row["serial_no"], **balance_dict(row),
                "urgency": priorities.get(row["serial_no"], urgency_dict(None)),
                "last_activity_at": row["last_activity_at"].replace(tzinfo=timezone.utc).isoformat() if row["last_activity_at"] else None}
        for field in META_FIELDS:
            item[field] = row[field]
            item[f"{field}_count"] = row[f"{field}_count"]
        for direction in ("incoming", "outgoing"):
            item[f"pending_{direction}_quantity"] = int(row[f"pending_{direction}_quantity"])
            item[f"pending_{direction}_weight"] = float(row[f"pending_{direction}_weight"])
        items.append(item)
    return {"items": items, "total": total, "page": filters.page, "page_size": filters.page_size}


def amounts(db, statement):
    return [{**dict(row), "quantity": int(row["quantity"] or 0), "weight": float(row["weight"] or 0)} for row in db.execute(statement).mappings()]


def daily(db, dates, column, quantity, weight, predicate, start, end, from_loss=False):
    # Explicit local-day UTC boundaries work on both SQLite and MySQL, including DST.
    bucket = case(*[(and_(column >= day_bounds(day)[0], column < day_bounds(day)[1]), day.isoformat()) for day in dates])
    statement = select(bucket.label("key"), func.sum(quantity).label("quantity"), func.sum(weight).label("weight")).where(predicate, column >= start, column <= end).group_by(bucket)
    if from_loss:
        statement = statement.select_from(MaterialLoss)
    return {row["key"]: row for row in amounts(db, statement)}


def analytics(db, team_id, days=30, metric="weight"):
    require_team(db, team_id)
    now = utcnow()
    dates, start, end = period(days, now)
    stock = stock_table(team_id)
    remaining = or_(stock.c.on_hand_quantity > 0, stock.c.on_hand_weight > 0)
    trend = {}
    peers = {}
    for direction in ("incoming", "outgoing"):
        column, predicate = flow(team_id, direction)
        trend[direction] = daily(db, dates, column, mt.quantity, mt.weight, predicate, start, end)
        key = peer_key(direction)
        label = (case((mt.entry_kind == "warehouse_receipt", "库房手工入库"), else_=mt.source_team_name) if direction == "incoming" else
                 case((mt.entry_kind == "warehouse_outbound", "对外出库"), (mt.entry_kind == "inspection_shipment", "检验发货"), else_=mt.next_team_name))
        peers[direction] = amounts(db, select(key.label("key"), func.max(label).label("label"), func.sum(mt.quantity).label("quantity"), func.sum(mt.weight).label("weight")).where(
            predicate, column >= start, column <= end).group_by(key).order_by(func.sum(getattr(mt, metric)).desc()))
    losses = daily(db, dates, MaterialLoss.created_at, MaterialLoss.quantity, MaterialLoss.weight, MaterialLoss.team_id == team_id, start, end, True)
    loss_rank = amounts(db, select(mt.serial_no.label("key"), func.sum(MaterialLoss.quantity).label("quantity"), func.sum(MaterialLoss.weight).label("weight")).join(
        MaterialLoss, MaterialLoss.source_transfer_id == mt.id).where(MaterialLoss.team_id == team_id, MaterialLoss.created_at >= start, MaterialLoss.created_at <= end).group_by(mt.serial_no).order_by(func.sum(getattr(MaterialLoss, metric)).desc(), mt.serial_no).limit(10))
    ranking = amounts(db, select(stock.c.serial_no.label("key"), func.sum(stock.c.on_hand_quantity).label("quantity"), func.sum(stock.c.on_hand_weight).label("weight")).where(remaining).group_by(stock.c.serial_no).order_by(func.sum(stock.c[f"on_hand_{metric}"]).desc(), stock.c.serial_no).limit(10))
    types = amounts(db, select(func.coalesce(stock.c.material_type, "unknown").label("key"), func.sum(stock.c.on_hand_quantity).label("quantity"), func.sum(stock.c.on_hand_weight).label("weight")).where(remaining).group_by(stock.c.material_type))
    materials = amounts(db, select(func.coalesce(stock.c.material_name, "未填写材质").label("key"), func.sum(stock.c.on_hand_quantity).label("quantity"), func.sum(stock.c.on_hand_weight).label("weight")).where(remaining).group_by(stock.c.material_name).order_by(func.sum(stock.c[f"on_hand_{metric}"]).desc()))
    age_bucket = case(*[(condition, key) for key, condition in age_conditions(stock.c.received_at, now).items()], else_="unknown")
    ages = {row["key"]: row for row in amounts(db, select(age_bucket.label("key"), func.sum(stock.c.on_hand_quantity).label("quantity"), func.sum(stock.c.on_hand_weight).label("weight")).where(remaining).group_by(age_bucket))}
    waiting = {}
    for direction in ("incoming", "outgoing"):
        bucket = case(*[(condition, key) for key, condition in age_conditions(mt.created_at, now).items()])
        grouped = amounts(db, select(bucket.label("key"), func.sum(mt.quantity).label("quantity"), func.sum(mt.weight).label("weight")).where(
            getattr(mt, "next_team_id" if direction == "incoming" else "source_team_id") == team_id, mt.status == "pending").group_by(bucket))
        waiting[direction] = {row["key"]: row for row in grouped}
    zero = {"quantity": 0, "weight": 0}
    return {"team_id": team_id, "days": days, "metric": metric, "as_of": now.replace(tzinfo=timezone.utc).isoformat(),
            "trend": [{"key": day.isoformat(), "incoming": trend["incoming"].get(day.isoformat(), zero), "outgoing": trend["outgoing"].get(day.isoformat(), zero), "loss": losses.get(day.isoformat(), zero)} for day in dates],
            "stock_ranking": ranking, "material_types": types, "materials": materials, "loss_ranking": loss_rank,
            "stock_age": [{"key": key, "label": label, **ages.get(key, zero)} for key, label in AGE_LABELS.items()] + ([{"label": "接收时间未知", **ages["unknown"]}] if "unknown" in ages else []),
            "waiting_age": [{"key": key, "label": label, "incoming": waiting["incoming"].get(key, zero), "outgoing": waiting["outgoing"].get(key, zero)} for key, label in AGE_LABELS.items()],
            "peers": peers}


@router.get("/{team_id}/serials")
def serials_endpoint(filters: Annotated[SerialFilters, Query()], team_id: int = Path(ge=1), db: Session = Depends(get_db)):
    return list_serials(db, team_id, filters)


@router.get("/{team_id}/analytics")
def analytics_endpoint(team_id: int = Path(ge=1), days: Days = 30,
                       metric: Literal["quantity", "weight"] = "weight", db: Session = Depends(get_db)):
    return analytics(db, team_id, days, metric)
