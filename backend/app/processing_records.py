"""Read audited processing counts without rewriting received material batches."""
from fastapi import HTTPException
from sqlalchemy import case, func, or_, select

from . import material_stock as stock
from .material_transfer_workflow import _utc, material_transfer_dict, material_transfer_list_options
from .models import MaterialQuantityAdjustment as Adjustment
from .models import MaterialTransfer as Transfer
from .models import utcnow
from .quantity_adjustments import record_dict
from .record_filters import RecordFilters
from .schemas import SCRAP_MATERIAL_TYPES


def registered_lots(team_id):
    # Clearing a leftover piece count on outbound is not a processing operation.
    return select(Adjustment.source_transfer_id.label("lot_id"), func.max(Adjustment.id).label("latest_id")).where(
        Adjustment.team_id == team_id, ~Adjustment.idempotency_key.like("outbound-clear:%")
    ).group_by(Adjustment.source_transfer_id).subquery()


def summary_columns(balance, registered):
    remaining = or_(balance.c.on_hand_quantity > 0, balance.c.on_hand_weight > 0)
    applicable = ~func.coalesce(balance.c.material_type, "").in_(SCRAP_MATERIAL_TYPES)
    columns = []
    for name, predicate in (("registered", registered.c.latest_id.is_not(None)), ("unregistered", registered.c.latest_id.is_(None))):
        current = remaining & applicable & predicate
        columns.append(func.sum(case((current, 1), else_=0)).label(f"processing_{name}_batch_count"))
        for amount in ("quantity", "weight"):
            columns.append(func.sum(case((current, balance.c[f"on_hand_{amount}"]), else_=0)).label(f"processing_{name}_{amount}"))
    return columns


def state(material_type, quantity, weight, pending_quantity, pending_weight, registered):
    if material_type in SCRAP_MATERIAL_TYPES:
        return "not_applicable"
    if quantity > 0 or weight > 0:
        return "registered" if registered else "unregistered"
    if pending_quantity > 0 or pending_weight > 0:
        return "pending"
    return "cleared"


def annotate_sources(db, team_id, items):
    ids = [item["transfer"]["id"] for item in items]
    if not ids:
        return items
    registered = registered_lots(team_id)
    latest = set(db.scalars(select(registered.c.lot_id).where(registered.c.lot_id.in_(ids))).all())
    for item in items:
        item["processing_state"] = state(item["transfer"]["material_type"], item["on_hand_quantity"], item["on_hand_weight"],
            item["in_transit_quantity"], item["in_transit_weight"], item["transfer"]["id"] in latest)
    return items


def require_cutting_team(db, team_id):
    team = stock.require_team(db, team_id)
    if team.code != "FACTORY-WIRE" or team.kind != "production":
        raise HTTPException(422, "当前加工登记页面用于线切割班组")


def list_sources(db, team_id, user, *, group_id=None, query=None, page=1, page_size=20):
    require_cutting_team(db, team_id)
    balance = stock.stock_table(team_id)
    conditions = [~func.coalesce(balance.c.material_type, "").in_(SCRAP_MATERIAL_TYPES),
                  or_(balance.c.on_hand_quantity > 0, balance.c.on_hand_weight > 0)]
    if group_id is not None:
        from .warehouse_inventory import group_conditions, origin_columns
        origins = origin_columns()
        anchor = db.execute(select(*(column.label(name) for name, column in origins.items())).where(
            Transfer.id == group_id, Transfer.next_team_id == team_id,
            Transfer.status == "received", Transfer.stock_tracked.is_(True))).mappings().first()
        if anchor is None:
            raise HTTPException(404, "未找到本班组的库存来源")
        conditions.extend(group_conditions(origins, anchor))
    if query and query.strip():
        conditions.append(stock.literal_query(query, [Transfer.serial_no, Transfer.batch_no, Transfer.material_name]))
    statement = select(Transfer, balance).join(balance, balance.c.transfer_id == Transfer.id).where(*conditions)
    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    rows = db.execute(statement.options(*material_transfer_list_options()).order_by(Transfer.received_at.desc(), Transfer.id.desc())
        .offset((page - 1) * page_size).limit(page_size)).unique().all()
    items = [{"transfer": material_transfer_dict(row[0], user, include_history=False), **stock.balance_dict(row._mapping)} for row in rows]
    return {"items": annotate_sources(db, team_id, items), "total": total, "page": page, "page_size": page_size}


def list_records(db, team_id, *, record_filters=None, query=None, page=1, page_size=20):
    require_cutting_team(db, team_id)
    balance = stock.stock_table(team_id)
    registered = registered_lots(team_id)
    conditions = [Adjustment.team_id == team_id, ~Adjustment.idempotency_key.like("outbound-clear:%"),
                  ~func.coalesce(Transfer.material_type, "").in_(SCRAP_MATERIAL_TYPES)]
    conditions.extend((record_filters or RecordFilters()).predicates(Adjustment.created_at, Transfer.serial_no))
    if query and query.strip():
        conditions.append(stock.literal_query(query, [Transfer.serial_no, Transfer.batch_no, Transfer.material_name, Adjustment.created_by, Adjustment.reason]))
    statement = select(Adjustment, Transfer.serial_no, Transfer.batch_no, Transfer.material_name, Transfer.material_type,
        Transfer.purpose_name, balance.c.on_hand_quantity, balance.c.on_hand_weight, balance.c.in_transit_quantity,
        balance.c.in_transit_weight, registered.c.latest_id).join(Transfer, Transfer.id == Adjustment.source_transfer_id).join(
        balance, balance.c.transfer_id == Transfer.id).join(registered, registered.c.lot_id == Transfer.id).where(*conditions)
    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    rows = db.execute(statement.order_by(Adjustment.created_at.desc(), Adjustment.id.desc())
        .offset((page - 1) * page_size).limit(page_size)).all()
    items = []
    for row in rows:
        current = row._mapping
        items.append({**record_dict(row[0]), **{key: current[key] for key in ("serial_no", "batch_no", "material_name", "material_type", "purpose_name")},
            "on_hand_quantity": current["on_hand_quantity"], "on_hand_weight": float(current["on_hand_weight"]),
            "in_transit_quantity": current["in_transit_quantity"], "in_transit_weight": float(current["in_transit_weight"]),
            "processing_state": state(current["material_type"], current["on_hand_quantity"], current["on_hand_weight"],
                current["in_transit_quantity"], current["in_transit_weight"], True)})
    return {"items": items, "total": total, "page": page, "page_size": page_size, "as_of": _utc(utcnow())}
