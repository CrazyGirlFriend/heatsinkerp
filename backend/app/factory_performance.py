"""Production work and inspection facts, without inferring output or responsibility."""

from collections import defaultdict
from datetime import date, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import Depends, HTTPException, Query
from sqlalchemy import and_, case, func, select
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
    "scrap_quantity",
    "scrap_weight",
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


def production_report(db, teams, dates):
    team_ids = [team.id for team in teams if team.code in PROCESSING_TEAM_CODES]
    sums = [func.count().label("record_count")]
    for kind, prefix in (("initial", "completed"), ("rework", "rework")):
        sums.append(
            func.sum(case((Work.work_kind == kind, 1), else_=0)).label(f"{kind}_record_count")
        )
        for amount in ("quantity", "weight"):
            sums.append(
                func.sum(
                    case((Work.work_kind == kind, getattr(Work, f"completed_{amount}")), else_=0)
                ).label(f"{prefix}_{amount}")
            )
    sums.extend(
        func.sum(getattr(Work, f"completed_{amount}")).label(f"work_{amount}")
        for amount in ("quantity", "weight")
    )
    sums.extend(
        func.sum(getattr(Work, f"scrap_{amount}")).label(f"scrap_{amount}")
        for amount in ("quantity", "weight")
    )
    # Match processing-daily: incomplete historical recounts are not actual work.
    rows = db.execute(
        select(Work.team_id, Work.processing_date, *sums)
        .join(MaterialTransfer, MaterialTransfer.id == Work.source_transfer_id)
        .where(
            Work.team_id.in_(team_ids),
            Work.processing_date >= dates[0],
            Work.processing_date <= dates[-1],
            Work.completed_quantity.is_not(None),
            Work.processor_employee_id.is_not(None),
            Work.work_kind.in_(("initial", "rework")),
            ~Work.idempotency_key.like("outbound-clear:%"),
            ~func.coalesce(MaterialTransfer.material_type, "").in_(SCRAP_MATERIAL_TYPES),
        )
        .group_by(Work.team_id, Work.processing_date)
    ).mappings()
    by_team = defaultdict(lambda: defaultdict(int))
    by_day = defaultdict(lambda: defaultdict(int))
    total = defaultdict(int)
    for row in rows:
        for target in (by_team[row["team_id"]], by_day[row["processing_date"]], total):
            add_metrics(target, row, PRODUCTION_METRICS)
    return {
        "totals": quantities(total, PRODUCTION_METRICS),
        "teams": [
            {
                "team_id": team.id,
                "team_name": team.name,
                **quantities(by_team[team.id], PRODUCTION_METRICS),
            }
            for team in teams
            if team.id in team_ids
        ],
        "trend": [
            {"date": day.isoformat(), **quantities(by_day[day], PRODUCTION_METRICS)}
            for day in dates
        ],
    }


def checked_day(dates):
    # UTC boundaries preserve the factory's calendar even across daylight savings.
    return case(
        *[
            (
                and_(
                    Inspection.checked_at >= day_bounds(day)[0],
                    Inspection.checked_at < day_bounds(day)[1],
                ),
                day.isoformat(),
            )
            for day in dates
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


def quality_report(db, teams, dates):
    day = checked_day(dates)
    phase = case((Inspection.parent_id.is_(None), "first"), else_="recheck")
    rows = db.execute(
        select(
            Inspection.team_id,
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
        .where(
            Inspection.team_id.in_([team.id for team in teams]),
            *RecordFilters(date_from=dates[0], date_to=dates[-1]).dates(Inspection.checked_at),
        )
        .group_by(Inspection.team_id, day, Inspection.kind, Inspection.scope, phase)
    ).mappings()
    groups = defaultdict(lambda: defaultdict(int))
    trend = defaultdict(lambda: defaultdict(int))
    names = {team.id: team.name for team in teams}
    for row in rows:
        dimensions = (row["kind"], row["scope"], row["phase"])
        add_metrics(groups[(row["team_id"], *dimensions)], row, QUALITY_METRICS)
        add_metrics(trend[(row["day"], *dimensions)], row, QUALITY_METRICS)
    return {
        "groups": [
            {
                "team_id": team_id,
                "team_name": names[team_id],
                "kind": kind,
                "scope": scope,
                "phase": phase,
                **quality_totals(amounts),
            }
            for (team_id, kind, scope, phase), amounts in sorted(groups.items())
        ],
        "trend": [
            {
                "date": day,
                "kind": kind,
                "scope": scope,
                "phase": phase,
                **quality_totals(amounts),
            }
            for (day, kind, scope, phase), amounts in sorted(trend.items())
        ],
    }


def issues_report(db, user, dates, team_id):
    conditions = [
        Inspection.parent_id.is_(None),
        Inspection.failed_quantity > 0,
        visible(user),
        *RecordFilters(date_from=dates[0], date_to=dates[-1]).dates(Inspection.checked_at),
    ]
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
            checked_day(dates).label("day"),
        )
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
        "trend": [{"date": day.isoformat(), **trend[day.isoformat()]} for day in dates],
    }


@router.get("")
def report(
    date_from: date | None = None,
    date_to: date | None = None,
    team_id: int | None = Query(default=None, gt=0),
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
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "generated_at": now.replace(tzinfo=timezone.utc).isoformat(),
        "teams": [
            dict(id=team.id, code=team.code, name=team.name, active=team.active) for team in teams
        ],
        "production": production_report(db, selected, dates),
        "quality": quality_report(db, selected, dates),
        "issues": issues_report(db, user, dates, team_id),
    }
