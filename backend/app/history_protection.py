"""Read-only references that keep historical data safe during administration.

Legacy business APIs/workflows are removed. These guards do not expose them;
they only prevent deleting/reclassifying teams still referenced by old rows.
"""
from sqlalchemy import func, select
from .legacy_models import ProductRouteOperation, Operation, OperationReport, OperationException


def team_has_historical_references(db, team_id: int) -> bool:
    return any(db.scalar(select(func.count(model.id)).where(column == team_id)) for model, column in (
        (ProductRouteOperation, ProductRouteOperation.responsible_team_id),
        (Operation, Operation.responsible_team_id),
        (OperationReport, OperationReport.scrap_destination_team_id),
        (OperationException, OperationException.destination_team_id),
    ))
