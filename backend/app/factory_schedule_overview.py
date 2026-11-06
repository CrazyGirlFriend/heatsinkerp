"""Read-only delivery KPIs using the same completion rules as the schedule board."""

from datetime import datetime, time, timedelta, timezone

from sqlalchemy import case, func, select

from . import production_schedules as schedules
from .models import ProductionSchedule as Plan
from .models import ProductionScheduleTask as Task
from .models import utcnow


def overview(db, days):
    now = utcnow()
    today = now.replace(tzinfo=timezone.utc).astimezone(schedules.LOCAL_ZONE).date()
    start_day = today - timedelta(days=days - 1)
    start = datetime.combine(start_day, time(), schedules.LOCAL_ZONE)
    end = datetime.combine(today + timedelta(days=1), time(), schedules.LOCAL_ZONE)
    progress = schedules.progress_table()
    rows = (
        select(
            Plan.id,
            Plan.due_at,
            schedules.status_expression(progress, now).label("status"),
        )
        .join(Task, Task.id == Plan.task_id)
        .outerjoin(progress, progress.c.schedule_id == Plan.id)
        .where(Task.cancelled_at.is_(None), Plan.cancelled_at.is_(None))
        .subquery()
    )
    period_ids = schedules.filtered_nodes(
        due_from=start.astimezone(timezone.utc).replace(tzinfo=None),
        due_to=end.astimezone(timezone.utc).replace(tzinfo=None) - timedelta(microseconds=1),
    )
    counts = dict(
        db.execute(
            select(rows.c.status, func.count())
            .where(rows.c.id.in_(period_ids), rows.c.status != "not_assessed")
            .group_by(rows.c.status)
        ).all()
    )
    current = dict(db.execute(select(rows.c.status, func.count()).group_by(rows.c.status)).all())
    assessed = sum(counts.get(key, 0) for key in ("completed", "completed_late", "overdue"))
    attention_ids = list(
        db.scalars(
            select(rows.c.id)
            .where(rows.c.status.in_(("overdue", "today")))
            .order_by(case((rows.c.status == "overdue", 0), else_=1), rows.c.due_at, rows.c.id)
            .limit(6)
        )
    )
    attention = schedules.summaries(db, attention_ids, now=now)
    return {
        "as_of": schedules.iso(now),
        "date_from": start_day.isoformat(),
        "date_to": today.isoformat(),
        "period": {key: counts.get(key, 0) for key in ("completed", "completed_late", "overdue")},
        "assessed_count": assessed,
        "on_time_rate": round(counts.get("completed", 0) * 100 / assessed, 1) if assessed else None,
        "overdue_count": current.get("overdue", 0),
        "today_count": current.get("today", 0),
        "attention": [attention[value] for value in attention_ids],
    }
