"""Production work and inspection facts, without inferring output or responsibility."""

from collections import defaultdict
from datetime import date, timedelta, timezone
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

from fastapi import Depends, HTTPException, Query
from sqlalchemy import Numeric, and_, case, cast, func, literal_column, or_, select, true, union_all
from sqlalchemy.orm import Session

from .async_api import AsyncAPIRouter
from .auth import get_current_user
from .config import settings
from .configure_material_teams import MATERIAL_TEAMS
from .database import get_db
from .models import (
    InspectionFeedbackTeam as Member,
)
from .models import (
    InspectionProblem,
    InspectionProblemType,
    MaterialTransfer,
    Team,
    User,
    utcnow,
)
from .models import (
    MaterialInspection as Inspection,
)
from .models import (
    MaterialQuantityAdjustment as Work,
)
from .quality_feedback import visible
from .record_filters import RecordFilters, day_bounds
from .schemas import SCRAP_MATERIAL_TYPES
from .team_constants import PROCESSING_TEAM_CODES

router = AsyncAPIRouter(prefix="/api/factory-performance")
PRODUCTION_METRICS = (
    "record_count",
    "initial_record_count",
    "rework_record_count",
    "completed_quantity",
    "completed_weight",
    "rework_quantity",
    "rework_weight",
    "work_quantity",
    "work_weight",
)
QUALITY_METRICS = ("record_count", "checked_quantity", "passed_quantity", "failed_quantity")


def quantities(row, keys):
    return {
        key: round(float(row[key] or 0), 6) if key.endswith("weight") else int(row[key] or 0)
        for key in keys
    }


def add_metrics(target, row, keys):
    for key in keys:
        target[key] += row[key] or 0


def period_start(day, period):
    if period == "week":
        return day - timedelta(days=day.weekday())
    if period == "month":
        return day.replace(day=1)
    return day


def period_dates(dates, period):
    return list(dict.fromkeys(period_start(day, period) for day in dates))


def production_facts(db, team_ids, dates, serial_no=None, material_name=None):
    """One work record per actual output serial; plans and remaining stock are excluded."""
    columns = [
        Work.id.label("work_id"),
        Work.team_id,
        Work.processing_date,
        Work.work_kind,
        MaterialTransfer.material_name,
        Work.purpose_name,
        Work.processing_task_name,
    ]
    conditions = [
        Work.team_id.in_(team_ids),
        Work.processing_date >= dates[0],
        Work.processing_date <= dates[-1],
        Work.completed_quantity.is_not(None),
        Work.processor_employee_id.is_not(None),
        Work.work_kind.in_(("initial", "rework")),
        ~Work.idempotency_key.like("outbound-clear:%"),
        ~func.coalesce(MaterialTransfer.material_type, "").in_(SCRAP_MATERIAL_TYPES),
    ]
    if material_name is not None:
        conditions.append(MaterialTransfer.material_name == material_name)
    if db.get_bind().dialect.name == "mysql":
        outputs = (
            func.json_table(
                Work.outputs,
                literal_column("""'$[*]' COLUMNS (
                role VARCHAR(16) PATH '$.role',
                serial_no VARCHAR(80) PATH '$.serial_no',
                quantity BIGINT PATH '$.quantity',
                weight DECIMAL(17,6) PATH '$.weight'
            )"""),
            )
            .table_valued("role", "serial_no", "quantity", "weight")
            .alias("output")
        )
        role, serial, quantity, weight = (
            outputs.c[key] for key in ("role", "serial_no", "quantity", "weight")
        )
        length = func.json_length(Work.outputs)
    else:
        outputs = func.json_each(Work.outputs).table_valued("value").alias("output")
        role, serial, quantity, weight = (
            func.json_extract(outputs.c.value, f"$.{key}")
            for key in ("role", "serial_no", "quantity", "weight")
        )
        length = func.json_array_length(Work.outputs)
    serial = func.coalesce(serial, MaterialTransfer.serial_no)
    plain = (
        select(
            *columns,
            MaterialTransfer.serial_no,
            Work.completed_quantity.label("quantity"),
            Work.completed_weight.label("weight"),
        )
        .join(MaterialTransfer, MaterialTransfer.id == Work.source_transfer_id)
        .where(
            *conditions,
            or_(
                Work.outputs.is_(None),
                func.json_type(Work.outputs).in_(("NULL", "null")),
                length == 0,
            ),
        )
    )
    split = (
        select(
            *columns,
            serial.label("serial_no"),
            func.sum(quantity).label("quantity"),
            func.sum(cast(weight, Numeric(17, 6))).label("weight"),
        )
        .select_from(Work)
        .join(MaterialTransfer, MaterialTransfer.id == Work.source_transfer_id)
        .join(outputs, true())
        .where(*conditions, role == "produced")
        .group_by(*columns, serial)
    )
    if serial_no is not None:
        plain = plain.where(MaterialTransfer.serial_no == serial_no)
        split = split.where(serial == serial_no)
    return union_all(plain, split).cte("work_facts")


def production_report(
    db, teams, dates, period="day", serial_no=None, work_id=None, material_name=None
):
    team_names = {team.id: team.name for team in teams if team.code in PROCESSING_TEAM_CODES}
    facts = production_facts(db, list(team_names), dates, serial_no, material_name)
    chosen = select(facts).order_by(
        facts.c.processing_date.desc(), facts.c.work_id.desc(), facts.c.serial_no
    )
    if work_id is not None:
        chosen = chosen.where(facts.c.work_id == work_id)
    chosen = db.execute(chosen.limit(1)).mappings().first()
    empty = {key: 0 for key in PRODUCTION_METRICS}
    if chosen is None:
        return {"scope": None, "scopes": [], "totals": empty, "trend": []}
    dimensions = ("material_name", "purpose_name", "processing_task_name")
    conditions = [facts.c.team_id == chosen["team_id"], facts.c.serial_no == chosen["serial_no"]]
    sums = [func.count().label("record_count")]
    for kind, prefix in (("initial", "completed"), ("rework", "rework")):
        sums.append(
            func.sum(case((facts.c.work_kind == kind, 1), else_=0)).label(f"{kind}_record_count")
        )
        for amount in ("quantity", "weight"):
            sums.append(
                func.sum(case((facts.c.work_kind == kind, facts.c[amount]), else_=0)).label(
                    f"{prefix}_{amount}"
                )
            )
    sums.extend(
        func.sum(facts.c[amount]).label(f"work_{amount}") for amount in ("quantity", "weight")
    )
    scopes = [
        {
            **dict(row),
            "team_id": chosen["team_id"],
            "team_name": team_names[chosen["team_id"]],
            "serial_no": chosen["serial_no"],
            **quantities(row, PRODUCTION_METRICS),
        }
        for row in db.execute(
            select(
                func.max(facts.c.work_id).label("scope_id"),
                *(facts.c[key] for key in dimensions),
                *sums,
            )
            .where(*conditions)
            .group_by(*(facts.c[key] for key in dimensions))
            .order_by(*(facts.c[key] for key in dimensions))
        ).mappings()
    ]
    scope = next(row for row in scopes if all(row[key] == chosen[key] for key in dimensions))
    day_rows = db.execute(
        select(facts.c.processing_date, *sums)
        .where(*conditions, *(facts.c[key].is_not_distinct_from(chosen[key]) for key in dimensions))
        .group_by(facts.c.processing_date)
    ).mappings()
    grouped = defaultdict(lambda: defaultdict(int))
    for row in day_rows:
        add_metrics(grouped[period_start(row["processing_date"], period)], row, PRODUCTION_METRICS)
    return {
        "scope": scope,
        "scopes": scopes,
        "totals": quantities(scope, PRODUCTION_METRICS),
        "trend": [
            {"date": day.isoformat(), **quantities(grouped[day], PRODUCTION_METRICS)}
            for day in period_dates(dates, period)
        ],
    }


def checked_day(dates, period="day"):
    intervals = defaultdict(list)
    for day in dates:
        intervals[period_start(day, period)].append(day)
    return case(
        *[
            (
                and_(
                    Inspection.checked_at >= day_bounds(days[0])[0],
                    Inspection.checked_at < day_bounds(days[-1])[1],
                ),
                start.isoformat(),
            )
            for start, days in intervals.items()
        ]
    )


def quality_totals(row):
    result = quantities(row, QUALITY_METRICS)
    result["pass_rate"] = (
        round(result["passed_quantity"] * 100 / result["checked_quantity"], 2)
        if result["checked_quantity"]
        else None
    )
    return result


def quality_report(db, teams, dates, period="day", material_name=None):
    day = checked_day(dates, period)
    phase = case((Inspection.parent_id.is_(None), "first"), else_="recheck")
    rows = db.execute(
        select(
            Inspection.team_id,
            MaterialTransfer.material_name,
            day.label("day"),
            Inspection.kind,
            Inspection.scope,
            phase.label("phase"),
            func.count().label("record_count"),
            func.sum(Inspection.sample_quantity).label("checked_quantity"),
            func.sum(Inspection.sample_quantity - Inspection.failed_quantity).label(
                "passed_quantity"
            ),
            func.sum(Inspection.failed_quantity).label("failed_quantity"),
        )
        .join(MaterialTransfer, MaterialTransfer.id == Inspection.source_transfer_id)
        .where(
            *(
                [MaterialTransfer.material_name == material_name]
                if material_name is not None
                else []
            ),
            Inspection.team_id.in_([team.id for team in teams]),
            *RecordFilters(date_from=dates[0], date_to=dates[-1]).dates(Inspection.checked_at),
        )
        .group_by(
            Inspection.team_id,
            MaterialTransfer.material_name,
            day,
            Inspection.kind,
            Inspection.scope,
            phase,
        )
    ).mappings()
    groups = defaultdict(lambda: defaultdict(int))
    materials = defaultdict(lambda: defaultdict(int))
    trend = defaultdict(lambda: defaultdict(int))
    names = {team.id: team.name for team in teams}
    for row in rows:
        dimensions = (row["material_name"], row["kind"], row["scope"], row["phase"])
        add_metrics(groups[(row["team_id"], *dimensions)], row, QUALITY_METRICS)
        add_metrics(materials[dimensions], row, QUALITY_METRICS)
        add_metrics(trend[(row["day"], *dimensions)], row, QUALITY_METRICS)
    return {
        "materials": [
            {
                "material_name": material,
                "kind": kind,
                "scope": scope,
                "phase": phase,
                **quality_totals(amounts),
            }
            for (material, kind, scope, phase), amounts in sorted(
                materials.items(), key=lambda item: tuple(str(value or "") for value in item[0])
            )
        ],
        "groups": [
            {
                "team_id": team_id,
                "team_name": names[team_id],
                "material_name": material,
                "kind": kind,
                "scope": scope,
                "phase": phase,
                **quality_totals(amounts),
            }
            for (team_id, material, kind, scope, phase), amounts in sorted(
                groups.items(), key=lambda item: tuple(str(value or "") for value in item[0])
            )
        ],
        "trend": [
            {
                "date": day,
                "material_name": material,
                "kind": kind,
                "scope": scope,
                "phase": phase,
                **quality_totals(amounts),
            }
            for (day, material, kind, scope, phase), amounts in sorted(
                trend.items(), key=lambda item: tuple(str(value or "") for value in item[0])
            )
        ],
    }


def issues_report(db, user, dates, team_id, period="day", material_name=None):
    conditions = [
        Inspection.parent_id.is_(None),
        Inspection.failed_quantity > 0,
        visible(user),
        *RecordFilters(date_from=dates[0], date_to=dates[-1]).dates(Inspection.checked_at),
    ]
    if material_name is not None:
        conditions.append(MaterialTransfer.material_name == material_name)
    if team_id is not None:
        conditions.append(
            select(Member.inspection_id)
            .where(Member.inspection_id == Inspection.id, Member.team_id == team_id)
            .exists()
        )
    roots = (
        select(
            Inspection.id,
            Inspection.feedback_status,
            checked_day(dates, period).label("day"),
        )
        .join(MaterialTransfer, MaterialTransfer.id == Inspection.source_transfer_id)
        .where(*conditions)
        .subquery()
    )
    summary = dict(total=0, pending=0, processing=0, closed=0, unresolved=0)
    trend = defaultdict(lambda: dict(total=0, unresolved=0))
    for day, status, count in db.execute(
        select(roots.c.day, roots.c.feedback_status, func.count())
        .group_by(roots.c.day, roots.c.feedback_status)
        .order_by(roots.c.day)
    ):
        summary["total"] += count
        summary[status] += count
        trend[day]["total"] += count
        if status != "closed":
            summary["unresolved"] += count
            trend[day]["unresolved"] += count

    counts = [
        func.count().label("issue_count"),
        func.sum(case((roots.c.feedback_status != "closed", 1), else_=0)).label("unresolved_count"),
    ]
    problems = db.execute(
        select(
            InspectionProblem.problem_type_id,
            InspectionProblemType.name,
            *counts,
        )
        .select_from(roots)
        .outerjoin(InspectionProblem, InspectionProblem.inspection_id == roots.c.id)
        .outerjoin(
            InspectionProblemType, InspectionProblemType.id == InspectionProblem.problem_type_id
        )
        .group_by(InspectionProblem.problem_type_id, InspectionProblemType.name)
        .order_by(func.count().desc(), InspectionProblem.problem_type_id)
    ).mappings()
    teams_query = (
        select(Member.team_id, Team.name.label("team_name"), *counts)
        .select_from(roots)
        .join(Member, Member.inspection_id == roots.c.id)
        .join(Team, Team.id == Member.team_id)
        .group_by(Member.team_id, Team.name)
        .order_by(func.count().desc(), Member.team_id)
    )
    if team_id is not None:
        teams_query = teams_query.where(Member.team_id == team_id)
    return {
        "summary": summary,
        "problems": [{**dict(row), "name": row["name"] or "历史未分类"} for row in problems],
        "teams": [dict(row) for row in db.execute(teams_query).mappings()],
        "trend": [
            {"date": day.isoformat(), **trend[day.isoformat()]}
            for day in period_dates(dates, period)
        ],
    }


@router.get("")
def report(
    date_from: date | None = None,
    date_to: date | None = None,
    team_id: int | None = Query(default=None, gt=0),
    period: Literal["day", "week", "month"] = "day",
    serial_no: Annotated[str | None, Query(min_length=1, max_length=80)] = None,
    work_id: Annotated[int | None, Query(gt=0)] = None,
    material_name: Annotated[str | None, Query(min_length=1, max_length=160)] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    now = utcnow()
    today = now.replace(tzinfo=timezone.utc).astimezone(ZoneInfo(settings.factory_timezone)).date()
    end = date_to or today
    if end <= date.min + timedelta(days=29) or end >= date.max:
        raise HTTPException(422, "请选择有效统计日期")
    start = date_from or end - timedelta(days=29)
    if start > end:
        raise HTTPException(422, "开始日期不能晚于结束日期")
    if (end - start).days >= 366 or start <= date.min or end >= date.max:
        raise HTTPException(422, "请选择不超过 366 天的统计范围")
    dates = [start + timedelta(days=offset) for offset in range((end - start).days + 1)]
    teams = list(
        db.scalars(
            select(Team)
            .where(Team.code.in_([row[0] for row in MATERIAL_TEAMS]))
            .order_by(Team.sort_order, Team.id)
        )
    )
    if team_id is not None and team_id not in {team.id for team in teams}:
        raise HTTPException(404, "未找到统计班组")
    selected = [team for team in teams if team_id is None or team.id == team_id]
    return {
        "period": period,
        "period_dates": [day.isoformat() for day in period_dates(dates, period)],
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "generated_at": now.replace(tzinfo=timezone.utc).isoformat(),
        "teams": [
            dict(id=team.id, code=team.code, name=team.name, active=team.active) for team in teams
        ],
        "production": production_report(
            db, selected, dates, period, serial_no, work_id, material_name
        ),
        "quality": quality_report(db, selected, dates, period, material_name),
        "issues": issues_report(db, user, dates, team_id, period, material_name),
    }
