"""SQL-paginated daily worker totals from immutable production facts."""

from sqlalchemy import func, select

from .models import MaterialQuantityAdjustment as Work
from .models import TeamEmployee
from .processing_records import (
    production_groups,
    record_conditions,
    record_table_columns,
    require_processing_team,
)
from .processing_registration import SUMMARY_METRICS
from .quantity_adjustments import record_dict
from .record_filters import RecordFilters
from .table_query import table_predicates


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
    conditions.extend(table_predicates(record_table_columns()))
    statement = production_groups(conditions)
    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    rows = (
        db.execute(
            statement.order_by(
                Work.processing_date.desc(),
                Work.processor_employee_id,
                func.min(Work.id),
                Work.processing_mode,
                Work.processing_task_id,
                Work.processing_task_name,
                Work.purpose_id,
                Work.purpose_name,
                Work.process_route_id,
                Work.process_step_index,
            )
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        .mappings()
        .all()
    )
    work = {
        row.id: row
        for row in db.scalars(
            select(Work).where(Work.id.in_([row["representative_id"] for row in rows]))
        )
    }
    people = {key: record_dict(record)["processors"] for key, record in work.items()}
    ids = {person["id"] for group in people.values() for person in group}
    names = dict(
        db.execute(select(TeamEmployee.id, TeamEmployee.name).where(TeamEmployee.id.in_(ids))).all()
    )
    for group in people.values():
        for person in group:
            person["name"] = names.get(person["id"], person["name"])
    items = [
        {
            **{key: value for key, value in row.items() if key != "representative_id"},
            "processors": people[row["representative_id"]],
            "processor_name": "、".join(
                person["name"] or "" for person in people[row["representative_id"]]
            ),
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
