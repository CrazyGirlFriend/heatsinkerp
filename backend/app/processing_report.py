"""Inspection facts for production exports, linked to the exact processing record."""

from sqlalchemy import select

from .material_transfer_workflow import _utc
from .models import MaterialInspection


def inspections_by_record(db, team_id, record_ids):
    if not record_ids:
        return {}
    results = {}
    rows = db.scalars(
        select(MaterialInspection)
        .where(
            MaterialInspection.team_id == team_id,
            MaterialInspection.processing_record_id.in_(record_ids),
        )
        .order_by(MaterialInspection.checked_at, MaterialInspection.id)
    )
    for row in rows:
        results.setdefault(row.processing_record_id, []).append(
            dict(
                id=row.id,
                source_transfer_id=row.source_transfer_id,
                checked_at=_utc(row.checked_at),
                inspector_name=row.inspector_name,
                batch_quantity=row.batch_quantity,
                sample_quantity=row.sample_quantity,
                passed_quantity=row.sample_quantity - row.failed_quantity,
                failed_quantity=row.failed_quantity,
                kind=row.kind,
                scope=row.scope,
                parent_id=row.parent_id,
                disposition=row.disposition,
                problem_names=[problem.name for problem in row.problems],
                notes=row.notes,
            )
        )
    return results
