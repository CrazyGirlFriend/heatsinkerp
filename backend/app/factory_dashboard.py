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
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session

from .async_api import AsyncAPIRouter
from .auth import actor_name, get_current_user, require_admin
from .config import settings
from .configure_material_teams import MATERIAL_TEAMS
from .database import get_db
from .material_stock import literal_query, stock_table
from .models import AdminAuditEvent, MaterialTransfer, SerialDeliveryPlan, Team, User, utcnow
from .observability import record, request_id
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
            )
            .where(or_(quantity > 0, weight > 0))
            .group_by(stock.c.team_id, stock.c.serial_no, name)
        ).mappings()
    )
    directory = {t.code: t for t in db.scalars(select(Team))}
    # Include any historical team that still owns stock; never silently lose it
    # from the factory total merely because it is outside the formal eight.
    team_ids = {r["team_id"] for r in rows}
    teams = [
        {
            "team_id": directory[code].id if code in directory else None,
            "team_code": code,
            "team_name": directory[code].name if code in directory else name,
            "active": bool(code in directory and directory[code].active),
        }
        for code, name, _, _ in MATERIAL_TEAMS
    ]
    teams += [
        {"team_id": t.id, "team_code": t.code, "team_name": t.name, "active": t.active}
        for t in directory.values()
        if t.id in team_ids and t.code not in {x[0] for x in MATERIAL_TEAMS}
    ]

    def total(items):
        return amount(
            sum(r["quantity"] for r in items), sum((r["weight"] for r in items), Decimal(0))
        )

    materials = [
        {"name": name, **total([r for r in rows if r["material"] == name])}
        for name in sorted({r["material"] for r in rows})
    ]
    matrix = {
        "materials": materials,
        "rows": [
            {
                **t,
                "amounts": {
                    m["name"]: total(
                        [
                            r
                            for r in rows
                            if r["team_id"] == t["team_id"] and r["material"] == m["name"]
                        ]
                    )
                    for m in materials
                },
                "total": total([r for r in rows if r["team_id"] == t["team_id"]])
                if t["team_id"]
                else None,
            }
            for t in teams
        ],
        "total": total(rows),
    }
    return matrix, rows


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
    rows = db.execute(
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
    remaining = {r["serial_no"] for r in owned}
    result = []
    for row in rows:
        source, output = float(row["input_weight"]), float(row["output_weight"])
        status = (
            "needs_review"
            if row["returns"]
            or row["opening"]
            or row["untracked"]
            or source <= 0
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
                "rate": round(output / source * 100, 2) if status == "complete" else None,
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
    teams = {t.id: t.name for t in db.scalars(select(Team))}
    return {
        "items": [
            {
                "team_id": r["team_id"],
                "team_name": teams.get(r["team_id"], "历史班组"),
                "input_weight": float(r["input_weight"]),
                "output_weight": float(output.get(r["team_id"], 0)),
                "rate": round(float(output.get(r["team_id"], 0) / r["input_weight"]) * 100, 2)
                if r["input_weight"] > 0
                and not r["remaining_weight"]
                and not r["remaining_quantity"]
                else None,
                "status": "in_progress"
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
    predicates = [or_(quantity > 0, weight > 0)]
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


class Installment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str = Field(min_length=1, max_length=60)
    due_date: date
    quantity: int = Field(gt=0, le=2_147_483_647)

    @field_validator("label")
    @classmethod
    def clean_label(cls, value):
        if not value.strip():
            raise ValueError("批次名称不能为空")
        return value.strip()

    @field_validator("due_date")
    @classmethod
    def supported_date(cls, value):
        if not date(2000, 1, 1) <= value <= date(2100, 12, 31):
            raise ValueError("交期须在2000至2100年之间")
        return value


class PlanUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    serial_no: str = Field(min_length=1, max_length=80)
    expected_version: int = Field(ge=0)
    installments: list[Installment] = Field(max_length=100)


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
def save_plan(
    payload: PlanUpdate, user: User = Depends(require_admin), db: Session = Depends(get_db)
):
    serial = payload.serial_no.strip()
    with db.begin():
        origin = db.scalar(
            select(mt.id)
            .where(mt.serial_no == serial, mt.status != "voided")
            .order_by(mt.id)
            .limit(1)
            .with_for_update()
        )
        if origin is None:
            raise HTTPException(404, "未找到流水号")
        row = db.scalar(
            select(SerialDeliveryPlan)
            .where(SerialDeliveryPlan.serial_no == serial)
            .with_for_update()
        )
        if (row.version if row else 0) != payload.expected_version:
            raise HTTPException(409, "交付计划已更新，请重新打开后修改")
        before = row.installments if row else []
        if row is None:
            row = SerialDeliveryPlan(serial_no=serial, version=0)
            db.add(row)
        row.installments = sorted(
            [part.model_dump(mode="json") for part in payload.installments],
            key=lambda p: p["due_date"],
        )
        row.version += 1
        row.updated_by = actor_name(user)
        row.updated_at = utcnow()
        db.add(
            AdminAuditEvent(
                actor_user_id=user.id,
                actor=actor_name(user),
                target_type="delivery_plan",
                target_id=origin,
                action="updated",
                request_id=request_id.get(),
                changes={
                    "serial_no": serial,
                    "before": before,
                    "after": row.installments,
                    "version": row.version,
                },
            )
        )
        db.flush()
        result = {"serial_no": serial, "version": row.version, "installments": row.installments}
    record(
        "delivery_plan.updated",
        actor_id=user.id,
        version=result["version"],
        installment_count=len(result["installments"]),
    )
    return result


def delivery_rows(db, today):
    plans = list(db.scalars(select(SerialDeliveryPlan).order_by(SerialDeliveryPlan.serial_no)))
    shipments = defaultdict(list)
    # Historical confirmation times determine completion, not today's balance.
    for row in db.execute(
        select(mt.serial_no, mt.dispatched_at, func.sum(mt.quantity).label("quantity"))
        .where(finished_shipments(), mt.serial_no.in_([p.serial_no for p in plans]))
        .group_by(mt.serial_no, mt.dispatched_at)
        .order_by(mt.dispatched_at)
    ):
        shipments[row.serial_no].append((local_day(row.dispatched_at), int(row.quantity)))
    rows = []
    for plan in plans:
        cumulative = 0
        total_shipped = sum(q for _, q in shipments[plan.serial_no])
        for index, part in enumerate(sorted(plan.installments, key=lambda p: p["due_date"])):
            start, cumulative = cumulative, cumulative + part["quantity"]
            confirmed, completed = min(part["quantity"], max(0, total_shipped - start)), None
            running = 0
            for day, quantity in shipments[plan.serial_no]:
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
                    "serial_no": plan.serial_no,
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
