"""Shared engineering response assembly for routes, rework and notifications."""

from sqlalchemy import select

from .models import ProcessRouteDrawing, TeamProcessingTask, TeamPurpose
from .process_routes import missing_route_documents
from .rework_routes import request_document


def drawing_document(row):
    return {
        "id": row.id,
        "filename": row.filename,
        "size_bytes": row.size_bytes,
        "sha256": row.sha256,
    }


def execution_labels(row, db):
    if db is None:
        return {"tasks": {}, "purposes": {}}
    return {
        key: dict(
            db.execute(
                select(model.id, model.name).where(
                    model.id.in_([step[field] for step in row.steps if step.get(field)])
                )
            ).all()
        )
        for key, model, field in (
            ("tasks", TeamProcessingTask, "processing_task_id"),
            ("purposes", TeamPurpose, "purpose_id"),
        )
    }


def document(row, *, detail=True, db=None, missing_documents=None):
    if missing_documents is None:
        missing_documents = missing_route_documents(db, [row.id]).get(row.id, []) if db else []
    return {
        "id": row.id,
        "title": row.title,
        "route_kind": row.route_kind,
        "missing_documents": missing_documents,
        "rework_request": request_document(db, row) if db is not None else None,
        "filename": row.filename,
        "state": row.state,
        "version": row.version,
        "parent_id": row.parent_id,
        "serial_nos": row.serial_nos,
        "created_by": row.created_by,
        "created_by_user_id": row.created_by_user_id,
        "engineering_employee_id": row.engineering_employee_id,
        "engineering_employee_name": row.engineering_employee_name,
        "modified_employee_id": row.modified_employee_id,
        "modified_employee_name": row.modified_employee_name,
        "created_at": row.created_at.isoformat() + "Z",
        "updated_at": row.updated_at.isoformat() + "Z" if row.updated_at else None,
        "published_at": row.published_at.isoformat() + "Z" if row.published_at else None,
        **(
            {
                "steps": row.steps,
                "source_data": row.source_data,
                "review_note": row.review_note,
                "source_sha256": row.source_sha256,
                "execution_labels": execution_labels(row, db),
                "drawings": [
                    drawing_document(item)
                    for item in db.scalars(
                        select(ProcessRouteDrawing)
                        .where(ProcessRouteDrawing.route_id == row.id)
                        .order_by(ProcessRouteDrawing.id)
                    )
                ]
                if db is not None
                else [],
            }
            if detail
            else {}
        ),
    }
