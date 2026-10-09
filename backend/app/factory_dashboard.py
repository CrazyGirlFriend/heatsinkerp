"""Factory dashboard: ownership, finished yield, daily shipments and delivery plans.

Pending outbound remains owned by its source in this management view. The stock
ledger still reserves it immediately, so this never makes reserved stock usable.
All shipment metrics use confirmed finished goods, not internal handoffs.
"""

from collections import defaultdict
from datetime import date, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

from fastapi import Depends, HTTPException, Query
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session, aliased

from .async_api import AsyncAPIRouter
from .auth import get_current_user
from .config import settings
from .database import get_db
from .material_stock import literal_query, stock_table
from .models import MaterialTransfer, SerialDeliveryPlan, Team, utcnow
from .record_filters import day_bounds
from .schemas import SCRAP_MATERIAL_TYPES
from .serial_urgency import urgency_map
from .team_constants import EXTERNAL_ENTRY_KINDS

router = AsyncAPIRouter(prefix="/api/factory-dashboard", dependencies=[Depends(get_current_user)])
mt = MaterialTransfer


def local_day(value):
    return value.replace(tzinfo=timezone.utc).astimezone(ZoneInfo(settings.factory_timezone)).date()


def finished_shipments():
    return and_(
        mt.entry_kind.in_(EXTERNAL_ENTRY_KINDS),
        mt.status == "dispatched",
        mt.material_type == "finished",
    )


def material_name(column):
    return func.coalesce(func.nullif(func.trim(column), ""), "未填写材质")


def amount(quantity=0, weight=0):
    return {"quantity": int(quantity or 0), "weight": round(float(weight or 0), 3)}


def serial_index():
    return (
        select(mt.serial_no, func.min(mt.created_at).label("created_at"))
        .where(mt.status != "voided")
        .group_by(mt.serial_no)
        .subquery()
    )


def serial_page(db, query="", page=1, page_size=50):
    table = serial_index()
    predicates = [literal_query(query.strip(), [table.c.serial_no])] if query.strip() else []
    total = db.scalar(select(func.count()).select_from(table).where(*predicates)) or 0
    items = db.execute(
        select(table)
        .where(*predicates)
        .order_by(table.c.created_at.desc(), table.c.serial_no.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).mappings()
    return {
        "items": [
            {"serial_no": row["serial_no"], "created_at": local_day(row["created_at"]).isoformat()}
            for row in items
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/serials")
def get_serials(
    query: str = Query("", max_length=80),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
):
    return serial_page(db, query, page, page_size)


def shipping_series(db, serials, start, end):
    if start > end or (end - start).days > 365 or start <= date.min or end >= date.max:
        raise HTTPException(422, "请选择不超过366天的有效日期范围")
    dates = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    # UTC bounds keep calendar aggregation correct for the factory timezone on
    # both SQLite and MySQL, without requiring MySQL timezone tables.
    day = case(
        *[
            (
                and_(mt.dispatched_at >= day_bounds(d)[0], mt.dispatched_at < day_bounds(d)[1]),
                d.isoformat(),
            )
            for d in dates
        ]
    )
    totals = (
        db.execute(
            select(mt.serial_no, day.label("day"), func.sum(mt.quantity).label("quantity"))
            .where(
                finished_shipments(),
                mt.serial_no.in_(serials),
                mt.dispatched_at >= day_bounds(start)[0],
                mt.dispatched_at < day_bounds(end)[1],
            )
            .group_by(mt.serial_no, day)
        ).mappings()
        if serials
        else []
    )
    values = {(row["serial_no"], row["day"]): int(row["quantity"]) for row in totals}
    index = serial_index()
    origins = (
        {
            row.serial_no: local_day(row.created_at)
            for row in db.execute(select(index).where(index.c.serial_no.in_(serials)))
        }
        if serials
        else {}
    )
    return {
        "dates": [d.isoformat() for d in dates],
        "series": [
            {
                "serial_no": s,
                "created_at": origins[s].isoformat(),
                "values": [
                    None if d < origins[s] else values.get((s, d.isoformat()), 0) for d in dates
                ],
            }
            for s in serials
            if s in origins
        ],
    }


@router.get("/shipments")
def get_shipments(
    date_from: date,
    date_to: date,
    serial_no: list[str] = Query(default=[], max_length=100),
    db: Session = Depends(get_db),
):
    if any(not s.strip() or len(s) > 80 for s in serial_no):
        raise HTTPException(422, "流水号格式无效")
    return shipping_series(db, list(dict.fromkeys(serial_no)), date_from, date_to)


def ownership(db):
    stock = stock_table()
    quantity = stock.c.on_hand_quantity + stock.c.reserved_quantity
    weight = stock.c.on_hand_weight + stock.c.reserved_weight
    name = material_name(stock.c.material_name)
    rows = list(
        db.execute(
            select(
                stock.c.team_id,
                stock.c.serial_no,
                name.label("material"),
                func.sum(quantity).label("quantity"),
                func.sum(weight).label("weight"),
                func.min(stock.c.received_at).label("oldest_at"),
                func.sum(stock.c.shortage_quantity).label("shortage_quantity"),
                func.sum(stock.c.shortage_weight).label("shortage_weight"),
            )
            .where(
                or_(
                    quantity != 0,
                    weight != 0,
                    stock.c.shortage_quantity > 0,
                    stock.c.shortage_weight > 0,
                )
            )
            .group_by(stock.c.team_id, stock.c.serial_no, name)
        ).mappings()
    )
    # Use the configured directory, not the phase-one installation template.
    # Disabled teams still holding stock must remain visible in factory totals.
    team_ids = {r["team_id"] for r in rows}
    teams = [
        {"team_id": t.id, "team_code": t.code, "team_name": t.name, "active": t.active}
        for t in db.scalars(select(Team).order_by(Team.sort_order, Team.id))
        if t.active or t.id in team_ids
    ]

    def total(items):
        return amount(
            sum(r["quantity"] for r in items), sum((r["weight"] for r in items), Decimal(0))
        )

    # There is no separate material master: effective documents supply the
    # vocabulary. Keep a grade's column after its balance reaches zero.
    names = set(
        db.scalars(select(material_name(mt.material_name)).where(mt.status != "voided").distinct())
    )
    names.update(r["material"] for r in rows)
    by_material, by_team, by_cell = defaultdict(list), defaultdict(list), defaultdict(list)
    for row in rows:
        by_material[row["material"]].append(row)
        by_team[row["team_id"]].append(row)
        by_cell[row["team_id"], row["material"]].append(row)
    materials = [{"name": name, **total(by_material[name])} for name in sorted(names)]
    matrix = {
        "materials": materials,
        "rows": [
            {
                **t,
                "amounts": {m["name"]: total(by_cell[t["team_id"], m["name"]]) for m in materials},
                "total": total(by_team[t["team_id"]]),
            }
            for t in teams
        ],
        "total": total(rows),
    }
    return matrix, rows


def reallocation_weights(db):
    source = aliased(MaterialTransfer)
    return (
        db.execute(
            select(
                source.serial_no.label("source_serial"),
                mt.serial_no.label("target_serial"),
                mt.next_team_id.label("team_id"),
                material_name(mt.material_name).label("material"),
                func.sum(mt.weight).label("weight"),
            )
            .join(source, source.id == mt.source_transfer_id)
            .where(mt.entry_kind == "serial_reallocation", mt.status == "received")
            .group_by(
                source.serial_no, mt.serial_no, mt.next_team_id, material_name(mt.material_name)
            )
        )
        .mappings()
        .all()
    )


def yields(db, owned):
    name = material_name(mt.material_name)
    incoming = and_(
        mt.entry_kind == "warehouse_receipt",
        mt.status == "received",
        or_(mt.receipt_kind == "external", mt.receipt_kind.is_(None)),
    )
    returned = and_(
        mt.entry_kind == "warehouse_receipt", mt.receipt_kind == "return", mt.status == "received"
    )
    rows = list(
        db.execute(
            select(
                mt.serial_no,
                name.label("material"),
                func.sum(case((incoming, mt.weight), else_=0)).label("input_weight"),
                func.sum(case((finished_shipments(), mt.weight), else_=0)).label("output_weight"),
                func.sum(case((returned, 1), else_=0)).label("returns"),
                func.sum(case((mt.entry_kind == "opening_stock", 1), else_=0)).label("opening"),
                func.sum(
                    case(
                        (
                            and_(
                                mt.entry_kind == "transfer",
                                mt.status == "received",
                                mt.stock_tracked.is_(False),
                            ),
                            1,
                        ),
                        else_=0,
                    )
                ).label("untracked"),
                func.sum(case((mt.status == "pending", 1), else_=0)).label("pending"),
            )
            .where(mt.status != "voided")
            .group_by(mt.serial_no, name)
        ).mappings()
    )
    assigned_in, assigned_out = defaultdict(Decimal), defaultdict(Decimal)
    assignments = reallocation_weights(db)
    for item in assignments:
        assigned_in[(item["target_serial"], item["material"])] += item["weight"]
        assigned_out[(item["source_serial"], item["material"])] += item["weight"]
    remaining = {r["serial_no"] for r in owned}
    shortages = {r["serial_no"] for r in owned if r["shortage_quantity"] or r["shortage_weight"]}
    uncertain = {
        row["serial_no"]
        for row in rows
        if row["returns"]
        or row["opening"]
        or row["untracked"]
        or (not row["input_weight"] and not assigned_in[(row["serial_no"], row["material"])])
    } | shortages
    # Reassigning a historical/unknown input cannot make its origin measurable.
    for _ in assignments:
        propagated = {
            item["target_serial"] for item in assignments if item["source_serial"] in uncertain
        }
        if propagated <= uncertain:
            break
        uncertain.update(propagated)
    result = []
    for row in rows:
        key = (row["serial_no"], row["material"])
        source = float(row["input_weight"] + assigned_in[key] - assigned_out[key])
        output = float(row["output_weight"])
        status = (
            "needs_review"
            if row["serial_no"] in shortages
            or row["serial_no"] in uncertain
            or source < 0
            or (source == 0 and not assigned_out[key])
            or output > source
            else "in_progress"
            if row["serial_no"] in remaining or row["pending"]
            else "complete"
        )
        result.append(
            {
                "serial_no": row["serial_no"],
                "material": row["material"],
                "input_weight": source,
                "output_weight": output,
                "reallocated_in_weight": float(assigned_in[key]),
                "reallocated_out_weight": float(assigned_out[key]),
                "rate": round(output / source * 100, 2)
                if status == "complete" and source > 0
                else None,
                "status": status,
            }
        )
    return result


@router.get("/yields")
def get_yields(
    material: str = Query("", max_length=160),
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    db: Session = Depends(get_db),
):
    _, owned = ownership(db)
    rows = [r for r in yields(db, owned) if not material or r["material"] == material]
    rows.sort(key=lambda r: (r["serial_no"], r["material"]), reverse=True)
    return {
        "items": rows[(page - 1) * page_size : page * page_size],
        "total": len(rows),
        "page": page,
        "page_size": page_size,
    }


@router.get("/team-yields")
def get_team_yields(
    serial_no: str = Query(min_length=1, max_length=80),
    material: str = Query("", max_length=160),
    db: Session = Depends(get_db),
):
    stock = stock_table()
    predicates = [stock.c.serial_no == serial_no]
    if material:
        predicates.append(material_name(stock.c.material_name) == material)
    incoming = list(
        db.execute(
            select(
                stock.c.team_id,
                func.sum(stock.c.received_weight).label("input_weight"),
                func.sum(stock.c.shortage_quantity).label("shortage_quantity"),
                func.sum(stock.c.shortage_weight).label("shortage_weight"),
                func.sum(stock.c.on_hand_weight + stock.c.reserved_weight).label(
                    "remaining_weight"
                ),
                func.sum(stock.c.on_hand_quantity + stock.c.reserved_quantity).label(
                    "remaining_quantity"
                ),
            )
            .where(*predicates)
            .group_by(stock.c.team_id)
        ).mappings()
    )
    predicates = [
        mt.serial_no == serial_no,
        mt.status.in_(["received", "dispatched"]),
        mt.entry_kind.in_(["transfer", *EXTERNAL_ENTRY_KINDS]),
        or_(mt.material_type.is_(None), ~mt.material_type.in_(SCRAP_MATERIAL_TYPES)),
    ]
    if material:
        predicates.append(material_name(mt.material_name) == material)
    output = dict(
        db.execute(
            select(mt.source_team_id, func.sum(mt.weight))
            .where(*predicates)
            .group_by(mt.source_team_id)
        ).all()
    )
    assigned_out = defaultdict(Decimal)
    for item in reallocation_weights(db):
        if item["source_serial"] == serial_no and (not material or item["material"] == material):
            assigned_out[item["team_id"]] += item["weight"]
    incoming = [
        {**r, "input_weight": r["input_weight"] - assigned_out[r["team_id"]]} for r in incoming
    ]
    teams = {t.id: t.name for t in db.scalars(select(Team))}
    return {
        "items": [
            {
                "team_id": r["team_id"],
                "team_name": teams.get(r["team_id"], "历史班组"),
                "input_weight": float(r["input_weight"]),
                "reallocated_out_weight": float(assigned_out[r["team_id"]]),
                "output_weight": float(output.get(r["team_id"], 0)),
                "rate": round(float(output.get(r["team_id"], 0) / r["input_weight"]) * 100, 2)
                if r["input_weight"] > 0
                and not r["shortage_quantity"]
                and not r["shortage_weight"]
                and output.get(r["team_id"], 0) <= r["input_weight"]
                and not r["remaining_weight"]
                and not r["remaining_quantity"]
                else None,
                "status": "needs_review"
                if r["shortage_quantity"]
                or r["shortage_weight"]
                or output.get(r["team_id"], 0) > r["input_weight"]
                else "in_progress"
                if r["remaining_weight"] or r["remaining_quantity"]
                else "complete",
            }
            for r in incoming
        ]
    }


@router.get("/stock-detail")
def get_stock_detail(
    team_id: int | None = Query(None, ge=1),
    material: str = Query("", max_length=160),
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    db: Session = Depends(get_db),
):
    stock = stock_table()
    name = material_name(stock.c.material_name)
    quantity, weight = (
        stock.c.on_hand_quantity + stock.c.reserved_quantity,
        stock.c.on_hand_weight + stock.c.reserved_weight,
    )
    predicates = [
        or_(quantity != 0, weight != 0, stock.c.shortage_quantity > 0, stock.c.shortage_weight > 0)
    ]
    if team_id is not None:
        predicates.append(stock.c.team_id == team_id)
    if material:
        predicates.append(name == material)
    grouped = (
        select(
            stock.c.team_id,
            stock.c.serial_no,
            name.label("material"),
            stock.c.material_type,
            func.sum(quantity).label("quantity"),
            func.sum(weight).label("weight"),
        )
        .where(*predicates)
        .group_by(stock.c.team_id, stock.c.serial_no, name, stock.c.material_type)
        .subquery()
    )
    total = db.scalar(select(func.count()).select_from(grouped)) or 0
    teams = {t.id: t.name for t in db.scalars(select(Team))}
    rows = db.execute(
        select(grouped)
        .order_by(grouped.c.team_id, grouped.c.serial_no, grouped.c.material_type)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).mappings()
    return {
        "items": [
            {
                **dict(row),
                "team_name": teams.get(row["team_id"], "历史班组"),
                **amount(row["quantity"], row["weight"]),
            }
            for row in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/delivery-plan")
def get_plan(serial_no: str = Query(min_length=1, max_length=80), db: Session = Depends(get_db)):
    if not db.scalar(
        select(mt.id).where(mt.serial_no == serial_no, mt.status != "voided").limit(1)
    ):
        raise HTTPException(404, "未找到流水号")
    row = db.get(SerialDeliveryPlan, serial_no)
    return {
        "serial_no": serial_no,
        "version": row.version if row else 0,
        "installments": row.installments if row else [],
    }


@router.put("/delivery-plan")
def save_plan():
    raise HTTPException(410, "交期已改为在源头批次单据上填写，请打开对应转料单或入库单")


def delivery_rows(db, today):
    plans = defaultdict(list)
    # Historical plans remain visible, explicitly distinguished from batch-owned requirements.
    for plan in db.scalars(select(SerialDeliveryPlan).order_by(SerialDeliveryPlan.serial_no)):
        plans[plan.serial_no].extend(
            {**part, "source_batch_no": None, "legacy": True} for part in plan.installments
        )
    for origin in db.execute(
        select(mt.serial_no, mt.batch_no, mt.delivery_date, mt.delivery_quantity).where(
            mt.delivery_origin_id.is_(None),
            mt.source_transfer_id.is_(None),
            mt.status != "voided",
            mt.delivery_date.is_not(None),
        )
    ):
        plans[origin.serial_no].append(
            {
                "label": origin.batch_no,
                "due_date": origin.delivery_date.isoformat(),
                "quantity": origin.delivery_quantity,
                "source_batch_no": origin.batch_no,
                "legacy": False,
            }
        )
    shipments = defaultdict(list)
    # Historical confirmation times determine completion, not today's balance.
    for row in db.execute(
        select(mt.serial_no, mt.dispatched_at, func.sum(mt.quantity).label("quantity"))
        .where(finished_shipments(), mt.serial_no.in_(list(plans)))
        .group_by(mt.serial_no, mt.dispatched_at)
        .order_by(mt.dispatched_at)
    ):
        shipments[row.serial_no].append((local_day(row.dispatched_at), int(row.quantity)))
    rows = []
    for serial, installments in plans.items():
        cumulative = 0
        total_shipped = sum(q for _, q in shipments[serial])
        for index, part in enumerate(
            sorted(installments, key=lambda p: (p["due_date"], p["label"]))
        ):
            start, cumulative = cumulative, cumulative + part["quantity"]
            confirmed, completed = min(part["quantity"], max(0, total_shipped - start)), None
            running = 0
            for day, quantity in shipments[serial]:
                running += quantity
                if running >= cumulative:
                    completed = day
                    break
            due = date.fromisoformat(part["due_date"])
            status = (
                ("on_time" if completed <= due else "late_complete")
                if completed
                else "overdue"
                if due < today
                else "pending"
            )
            rows.append(
                {
                    "serial_no": serial,
                    "index": index,
                    **part,
                    "shipped": confirmed,
                    "remaining": part["quantity"] - confirmed,
                    "completed_on": completed.isoformat() if completed else None,
                    "status": status,
                    "overdue_days": max(0, ((completed or today) - due).days),
                }
            )
    rows.sort(key=lambda r: (r["status"] != "overdue", r["due_date"], r["serial_no"], r["index"]))
    return rows


@router.get("/deliveries")
def get_deliveries(
    query: str = Query("", max_length=80),
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    db: Session = Depends(get_db),
):
    rows = [
        r
        for r in delivery_rows(db, local_day(utcnow()))
        if query.casefold() in r["serial_no"].casefold()
    ]
    return {
        "items": rows[(page - 1) * page_size : page * page_size],
        "total": len(rows),
        "page": page,
        "page_size": page_size,
    }


@router.get("")
def get_dashboard(db: Session = Depends(get_db)):
    now = utcnow()
    today = local_day(now)
    matrix, owned = ownership(db)
    serial_yields = yields(db, owned)
    materials = []
    for name in sorted({r["material"] for r in serial_yields}):
        rows = [r for r in serial_yields if r["material"] == name]
        closed = [r for r in rows if r["status"] == "complete"]
        source, output = (
            sum(r["input_weight"] for r in closed),
            sum(r["output_weight"] for r in closed),
        )
        materials.append(
            {
                "material": name,
                "input_weight": round(source, 3),
                "output_weight": round(output, 3),
                "rate": round(output / source * 100, 2) if source else None,
                "completed_count": len(closed),
                "active_count": len(rows) - len(closed),
            }
        )
    deliveries = delivery_rows(db, today)
    due = [r for r in deliveries if r["due_date"] < today.isoformat()]
    on_time = sum(r["status"] == "on_time" for r in due)
    latest = serial_page(db, page_size=5)
    grouped = defaultdict(list)
    for row in owned:
        grouped[row["serial_no"]].append(row)
    priorities = urgency_map(db, list(grouped))
    overdue = defaultdict(list)
    for row in deliveries:
        if row["status"] == "overdue":
            overdue[row["serial_no"]].append(row)
    team_names = {r["team_id"]: r["team_name"] for r in matrix["rows"]}
    attention = []
    for serial in set(grouped) | set(overdue):
        rows, late = grouped[serial], overdue[serial]
        age = max(
            ((today - local_day(r["oldest_at"])).days for r in rows if r["oldest_at"]), default=0
        )
        urgent = priorities.get(serial, {}).get("urgent", False)
        reasons = (
            (["超期"] if late else [])
            + (["加急"] if urgent else [])
            + (["库龄"] if age >= 7 else [])
        )
        if reasons:
            attention.append(
                {
                    "serial_no": serial,
                    "materials": sorted({r["material"] for r in rows}),
                    "teams": sorted({team_names.get(r["team_id"], "历史班组") for r in rows}),
                    "reasons": reasons,
                    "age_days": age,
                    "overdue_days": max((r["overdue_days"] for r in late), default=0),
                    "remaining": sum(r["remaining"] for r in deliveries if r["serial_no"] == serial)
                    if any(r["serial_no"] == serial for r in deliveries)
                    else None,
                }
            )
    attention.sort(
        key=lambda r: (
            "超期" not in r["reasons"],
            "加急" not in r["reasons"],
            -r["age_days"],
            r["serial_no"],
        )
    )
    legacy = (
        db.scalar(
            select(func.count())
            .select_from(mt)
            .where(mt.status == "received", mt.stock_tracked.is_(False))
        )
        or 0
    )
    return {
        "as_of": now.replace(tzinfo=timezone.utc).isoformat(),
        "today": today.isoformat(),
        "stock": matrix,
        "yields": materials,
        "delivery": {
            "on_time_rate": round(on_time / len(due) * 100, 1) if due else None,
            "due_count": len(due),
            "overdue_count": sum(r["status"] == "overdue" for r in deliveries),
            "upcoming_count": sum(
                today.isoformat() <= r["due_date"] <= (today + timedelta(days=3)).isoformat()
                and r["remaining"] > 0
                for r in deliveries
            ),
            "items": [r for r in deliveries if r["remaining"] > 0][:2],
            "total": len(deliveries),
        },
        "shipping": shipping_series(
            db, [r["serial_no"] for r in latest["items"]], today - timedelta(days=6), today
        ),
        "serial_count": latest["total"],
        "attention": attention,
        "legacy_count": legacy,
    }
