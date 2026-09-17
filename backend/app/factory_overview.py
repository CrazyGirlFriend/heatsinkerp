"""Factory-wide read-only stock and movement report for the eight official teams."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import and_, case, cast, func, or_, select, String
from sqlalchemy.orm import Session

from .auth import get_current_user
from .configure_material_teams import MATERIAL_TEAMS
from .database import get_db
from .record_filters import urgent_serials
from .material_analytics import AGE_LABELS, Days, age_conditions, amounts, daily, outgoing_flow, period
from .material_stock import BALANCE_KEYS, balance_dict, stock_table
from .models import MaterialDispatch, MaterialLoss, MaterialTransfer, Team, utcnow

router = APIRouter(prefix="/api/factory-overview", dependencies=[Depends(get_current_user)])
mt = MaterialTransfer


def stock_rankings(db, stock, in_scope, remaining, column):
    table = select(func.coalesce(column, "未填写材质").label("key"),
        func.sum(stock.c.on_hand_quantity).label("quantity"),
        func.sum(stock.c.on_hand_weight).label("weight")).where(in_scope, remaining).group_by(column).subquery()
    return {unit: amounts(db, select(table).where(table.c[unit] > 0)
            .order_by(table.c[unit].desc(), table.c.key).limit(8)) for unit in ("quantity", "weight")}


def material_stock_summary(db, team_ids):
    # Full material names/grades, not material nature or a truncated top-eight ranking.
    # Reuse physical balances so transit, losses and confirmed external exits are not counted twice.
    stock = stock_table()
    name = func.coalesce(func.nullif(func.trim(stock.c.material_name), ""), "未填写材质")
    return amounts(db, select(name.label("key"),
        func.sum(stock.c.on_hand_quantity).label("quantity"),
        func.sum(stock.c.on_hand_weight).label("weight"))
        .where(stock.c.team_id.in_(team_ids), or_(stock.c.on_hand_quantity > 0, stock.c.on_hand_weight > 0))
        .group_by(name).order_by(name))


def recent_batches(db, involved, limit=12):
    # Aggregate complete CK groups before LIMIT; never present one child line as
    # an entire batch. This is a latest-state feed, not a fabricated event log.
    code = func.coalesce(MaterialDispatch.dispatch_no, mt.batch_no)
    count = lambda predicate: func.sum(case((predicate, 1), else_=0))
    status = case((count(mt.status != "voided") == 0, "voided"),
        (and_(count(mt.status == "pending") == 0, count(mt.status == "dispatched") > 0), "dispatched"),
        (count(mt.status == "pending") == 0, "received"),
        (count(mt.status.in_(["received", "dispatched"])) > 0, "partial"), else_="pending")
    material = case((mt.status != "voided", func.coalesce(func.nullif(func.trim(mt.material_name), ""), "未填写材质")))
    rows = db.execute(select(code.label("batch_no"), status.label("status"),
        func.min(mt.source_team_id).label("source_id"), func.min(mt.next_team_id).label("target_id"),
        func.min(mt.entry_kind).label("entry_kind"), func.min(mt.source_team_name).label("source_name"),
        func.min(mt.next_team_name).label("target_name"), func.min(mt.external_destination).label("external_destination"),
        func.count(mt.id).label("line_count"),
        func.count(func.distinct(case((and_(mt.status != "voided", mt.serial_no.in_(urgent_serials())), mt.serial_no)))).label("urgent_serial_count"),
        func.count(func.distinct(case((mt.status != "voided", mt.serial_no)))).label("serial_count"),
        func.count(func.distinct(material)).label("material_count"),
        case((func.count(func.distinct(material)) == 1, func.min(material)), else_=None).label("material_name"),
        func.min(case((mt.status == "pending", mt.created_at))).label("waiting_since"),
        func.sum(case((mt.status != "voided", mt.quantity), else_=0)).label("quantity"),
        func.sum(case((mt.status != "voided", mt.weight), else_=0)).label("weight"),
        func.max(mt.updated_at).label("updated_at")
    ).outerjoin(MaterialDispatch, mt.dispatch_id == MaterialDispatch.id).where(involved)
        .group_by(code).order_by(func.max(mt.updated_at).desc(), code.desc()).limit(limit)).mappings()
    return [{**dict(row), "weight": float(row["weight"] or 0),
             "waiting_since": row["waiting_since"].replace(tzinfo=timezone.utc).isoformat() if row["waiting_since"] else None,
             "updated_at": row["updated_at"].replace(tzinfo=timezone.utc).isoformat()} for row in rows]


def factory_overview(db, days=30, recent_limit=12):
    now = utcnow()
    dates, start, end = period(days, now)
    configured = {team.code: team for team in db.scalars(select(Team).where(Team.code.in_([row[0] for row in MATERIAL_TEAMS])))}
    ids = [team.id for team in configured.values()]
    stock = stock_table()
    in_scope = stock.c.team_id.in_(ids)
    remaining = or_(stock.c.on_hand_quantity > 0, stock.c.on_hand_weight > 0)
    stock_rows = list(db.execute(select(stock.c.team_id,
        func.count(func.distinct(case((remaining, stock.c.serial_no)))).label("serial_count"),
        func.count(func.distinct(case((and_(remaining, stock.c.serial_no.in_(urgent_serials())), stock.c.serial_no)))).label("urgent_serial_count"),
        *(func.sum(stock.c[key]).label(key) for key in BALANCE_KEYS)).where(in_scope).group_by(stock.c.team_id)).mappings())
    balances = {row["team_id"]: balance_dict(row) for row in stock_rows}
    serial_counts = {row["team_id"]: row for row in stock_rows}
    batch_key = case((mt.dispatch_id.is_not(None), "CK" + cast(mt.dispatch_id, String)), else_=mt.batch_no)
    incoming = {row["team_id"]: {"batches": row["batches"], "quantity": int(row["quantity"] or 0), "weight": float(row["weight"] or 0)}
        for row in db.execute(select(mt.next_team_id.label("team_id"), func.count(func.distinct(batch_key)).label("batches"),
            func.sum(mt.quantity).label("quantity"), func.sum(mt.weight).label("weight"))
            .where(mt.next_team_id.in_(ids), mt.entry_kind == "transfer", mt.status == "pending")
            .group_by(mt.next_team_id)).mappings()}
    zero_balance = dict.fromkeys(BALANCE_KEYS, 0)
    teams = [{"id": configured[code].id if code in configured else None, "code": code, "name": name,
              "active": configured[code].active if code in configured else False,
              "serial_count": serial_counts.get(configured[code].id, {}).get("serial_count", 0) if code in configured else None,
              "urgent_serial_count": serial_counts.get(configured[code].id, {}).get("urgent_serial_count", 0) if code in configured else None,
              "pending_incoming": incoming.get(configured[code].id, {"batches": 0, "quantity": 0, "weight": 0}) if code in configured else None,
              "balance": balances.get(configured[code].id, zero_balance) if code in configured else None}
             for code, name, _, _ in MATERIAL_TEAMS]
    totals = {key: round(sum(row[key] for row in balances.values()), 3) if key.endswith("weight") else sum(row[key] for row in balances.values()) for key in BALANCE_KEYS}

    # Count an internal movement once, never once at each end. Outbound operations
    # have no receiving team and stay separate from internal pending receipts.
    involved = or_(mt.source_team_id.in_(ids), mt.next_team_id.in_(ids))
    pending = and_(involved, mt.status == "pending")
    pending_total = db.execute(select(func.count(func.distinct(batch_key)).label("batches"),
        func.sum(mt.quantity).label("quantity"), func.sum(mt.weight).label("weight")).where(pending)).mappings().one()
    pending_amount = {"batches": pending_total["batches"], "quantity": int(pending_total["quantity"] or 0), "weight": float(pending_total["weight"] or 0)}
    bucket = case(*[(condition, key) for key, condition in age_conditions(mt.created_at, now).items()])
    waiting = {}
    for key, condition in (("internal", mt.entry_kind == "transfer"), ("external", mt.entry_kind.in_(["warehouse_outbound", "inspection_shipment"]))):
        waiting[key] = {row["key"]: row for row in amounts(db, select(bucket.label("key"),
            func.sum(mt.quantity).label("quantity"), func.sum(mt.weight).label("weight")).where(pending, condition).group_by(bucket))}

    # Internal submission moves stock into transit, never factory inbound/outbound.
    # Receipts and external exits retain their confirmation timestamps.
    flows = {
        "inbound": (mt.received_at, and_(mt.next_team_id.in_(ids), mt.entry_kind == "warehouse_receipt", mt.status == "received")),
        "outbound": (mt.dispatched_at, and_(mt.source_team_id.in_(ids), mt.entry_kind == "warehouse_outbound", mt.status == "dispatched")),
        "shipment": (mt.dispatched_at, and_(mt.source_team_id.in_(ids), mt.entry_kind == "inspection_shipment", mt.status == "dispatched")),
        "internal": (mt.created_at, and_(mt.source_team_id.in_(ids), mt.next_team_id.in_(ids), mt.entry_kind == "transfer", mt.status.in_(["pending", "received"]))),
    }
    movement = {key: daily(db, dates, column, mt.quantity, mt.weight, predicate, start, end) for key, (column, predicate) in flows.items()}
    movement["loss"] = daily(db, dates, MaterialLoss.created_at, MaterialLoss.quantity, MaterialLoss.weight,
                              MaterialLoss.team_id.in_(ids), start, end, True)
    zero = {"quantity": 0, "weight": 0}
    period_totals = {key: {unit: round(sum(row[unit] for row in values.values()), 3) if unit == "weight" else sum(row[unit] for row in values.values()) for unit in zero} for key, values in movement.items()}
    types = amounts(db, select(func.coalesce(stock.c.material_type, "unknown").label("key"),
        func.sum(stock.c.on_hand_quantity).label("quantity"), func.sum(stock.c.on_hand_weight).label("weight")).where(in_scope, remaining).group_by(stock.c.material_type))
    age_bucket = case(*[(condition, key) for key, condition in age_conditions(stock.c.received_at, now).items()], else_="unknown")
    age_rows = {row["key"]: row for row in amounts(db, select(age_bucket.label("key"),
        func.sum(stock.c.on_hand_quantity).label("quantity"), func.sum(stock.c.on_hand_weight).label("weight")).where(in_scope, remaining).group_by(age_bucket))}
    legacy = db.scalar(select(func.count(mt.id)).where(mt.next_team_id.in_(ids), mt.status == "received", mt.stock_tracked.is_(False))) or 0
    return {"as_of": now.replace(tzinfo=timezone.utc).isoformat(), "days": days, "teams": teams, "totals": totals,
            "material_ranking": stock_rankings(db, stock, in_scope, remaining, stock.c.material_name),
            "serial_ranking": stock_rankings(db, stock, in_scope, remaining, stock.c.serial_no),
            "recent_batches": recent_batches(db, involved, recent_limit),
            "pending": pending_amount, "period_totals": period_totals, "material_types": types,
            "trend": [{"key": day.isoformat(), **{key: values.get(day.isoformat(), zero) for key, values in movement.items()}} for day in dates],
            "stock_age": [{"key": key, "label": label, **age_rows.get(key, zero)} for key, label in AGE_LABELS.items()] + ([{"label": "时间未知", **age_rows["unknown"]}] if "unknown" in age_rows else []),
            "waiting_age": [{"key": key, "label": label, **{direction: values.get(key, zero) for direction, values in waiting.items()}} for key, label in AGE_LABELS.items()],
            "legacy_received_count": legacy}


@router.get("")
def overview_endpoint(days: Days = 30, db: Session = Depends(get_db)):
    return factory_overview(db, days)


@router.get("/live")
def live_endpoint(db: Session = Depends(get_db)):
    """Visual status board: pending counts are whole batches, not child lines."""
    report = factory_overview(db, recent_limit=100)
    ids = [team["id"] for team in report["teams"] if team["id"]]
    batch_key = case((mt.dispatch_id.is_not(None), "CK" + cast(mt.dispatch_id, String)), else_=mt.batch_no)
    pending = mt.status == "pending"
    now = datetime.fromisoformat(report["as_of"]).replace(tzinfo=None)
    _, start, end = period(1, now)
    # Internal outgoing pieces count at submission; acceptance must not count
    # them again. External exits count at confirmation. Completed CKs count once.
    outgoing_at, outgoing = outgoing_flow()
    outgoing_quantity = db.scalar(select(func.sum(mt.quantity)).where(mt.source_team_id.in_(ids),
        outgoing, outgoing_at >= start, outgoing_at <= end)) or 0
    received_groups = select(batch_key).where(or_(mt.source_team_id.in_(ids), mt.next_team_id.in_(ids))).group_by(batch_key).having(
        func.sum(case((pending, 1), else_=0)) == 0,
        func.sum(case((mt.status == "received", 1), else_=0)) > 0,
        func.max(case((mt.status == "received", mt.received_at))) >= start,
        func.max(case((mt.status == "received", mt.received_at))) <= end).subquery()
    today = {"outgoing_quantity": int(outgoing_quantity),
             "received_batches": db.scalar(select(func.count()).select_from(received_groups)) or 0}
    for key, column in (("incoming", mt.next_team_id), ("outgoing", mt.source_team_id)):
        counts = dict(db.execute(select(column, func.count(func.distinct(batch_key)))
            .where(pending, column.in_(ids)).group_by(column)).all())
        for team in report["teams"]:
            team[key] = counts.get(team["id"], 0) if team["id"] else None
    # Group pending internal receipts by receiving team, using each serial's
    # own amounts and only unaccepted lines in partially received CKs.
    for team in report["teams"]:
        team["pending_transfers"] = pending_transfer_rows(db, team["id"]) if team["id"] else []
    # Only actual team-to-team handoffs create edges. External operations remain
    # visible in the batch feed, never as a fictitious receiving team or robot.
    since = datetime.fromisoformat(report["as_of"]).replace(tzinfo=None) - timedelta(hours=24)
    confirmed = and_(mt.status == "received", mt.received_at >= since)
    links = db.execute(select(mt.source_team_id.label("source_id"), mt.next_team_id.label("target_id"),
        func.count(func.distinct(case((pending, batch_key)))).label("pending_batches"),
        func.count(func.distinct(case((confirmed, batch_key)))).label("confirmed_batches")
    ).where(mt.entry_kind == "transfer", mt.source_team_id.in_(ids), mt.next_team_id.in_(ids),
            or_(pending, confirmed)).group_by(mt.source_team_id, mt.next_team_id)
      .order_by(mt.source_team_id, mt.next_team_id)).mappings()
    return {**{key: report[key] for key in ("as_of", "teams", "totals", "pending", "recent_batches", "legacy_received_count")},
            "today": today, "links": [dict(row) for row in links],
            "material_stock": material_stock_summary(db, ids)}


def pending_transfer_rows(db, team_id):
    code = func.coalesce(MaterialDispatch.dispatch_no, mt.batch_no)
    rows = db.execute(select(code.label("batch_no"), mt.serial_no,
        mt.source_team_id.label("source_id"), mt.next_team_id.label("target_id"),
        func.min(mt.source_team_name).label("source_name"),
        func.sum(mt.quantity).label("quantity"), func.sum(mt.weight).label("weight"),
        func.max(mt.updated_at).label("updated_at"))
        .outerjoin(MaterialDispatch, mt.dispatch_id == MaterialDispatch.id)
        .where(mt.next_team_id == team_id, mt.entry_kind == "transfer", mt.status == "pending")
        .group_by(code, mt.serial_no, mt.source_team_id, mt.next_team_id)
        .order_by(func.max(mt.updated_at).desc(), code.desc(), mt.serial_no)
        .limit(100)).mappings()
    return [{**dict(row), "quantity": int(row["quantity"] or 0), "weight": float(row["weight"] or 0),
             "updated_at": row["updated_at"].replace(tzinfo=timezone.utc).isoformat()} for row in rows]
