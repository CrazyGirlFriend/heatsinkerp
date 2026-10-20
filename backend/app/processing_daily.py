"""SQL-paginated daily worker totals from immutable production facts."""

from sqlalchemy import func, select

from .models import MaterialQuantityAdjustment as Work
from .processing_records import production_groups, record_conditions, require_processing_team
from .processing_registration import SUMMARY_METRICS
from .record_filters import RecordFilters


def list_daily(
    db,
    team_id,
    *,
    date_from=None,
    date_to=None,
    processor_id=None,
    query=None,
    work_date=None,
    work_kind=None,
    processing_task_id=None,
    purpose_id=None,
    urgent_only=False,
    page=1,
    page_size=20,
):
    team = require_processing_team(db, team_id)
    conditions = record_conditions(
        team_id,
        RecordFilters(date_from=date_from, date_to=date_to, urgent_only=urgent_only),
        query,
        processor_id,
        work_date,
        work_kind,
        processing_task_id,
        purpose_id,
    )
    statement = production_groups(conditions)
    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    rows = db.execute(
        statement.order_by(
            Work.processing_date.desc(),
            Work.processor_employee_id,
            Work.processing_mode,
            Work.processing_task_id,
            Work.processing_task_name,
            Work.purpose_id,
            Work.purpose_name,
        )
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).mappings()
    items = [
        {
            **dict(row),
            "team_id": team.id,
            "team_name": team.name,
            "processing_date": row["processing_date"].isoformat(),
            **{
                key: float(row[key]) if key.endswith("weight") else int(row[key])
                for key in SUMMARY_METRICS
            },
        }
        for row in rows
    ]
    return {"items": items, "total": total, "page": page, "page_size": page_size}
