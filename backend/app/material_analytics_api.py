"""HTTP validation and identity boundary for material analytics."""

from typing import Annotated, Literal

from fastapi import Depends, Path, Query
from sqlalchemy.orm import Session

from . import material_analytics as service
from .analytics_read_schemas import MaterialAnalyticsResponse, SerialSummaryResponse
from .async_api import AsyncAPIRouter as APIRouter
from .auth import get_current_user
from .database import get_db
from .material_analytics import Days, SerialFilters
from .read_schemas import PageResponse

router = APIRouter(prefix="/api/team-materials", dependencies=[Depends(get_current_user)])


@router.get("/{team_id}/serials", response_model=PageResponse[SerialSummaryResponse])
def serials_endpoint(
    filters: Annotated[SerialFilters, Query()],
    team_id: int = Path(ge=1),
    db: Session = Depends(get_db),
):
    return service.list_serials(db, team_id, filters)


@router.get(
    "/{team_id}/analytics",
    response_model=MaterialAnalyticsResponse,
    response_model_exclude_unset=True,
)
def analytics_endpoint(
    team_id: int = Path(ge=1),
    days: Days = 30,
    metric: Literal["quantity", "weight"] = "weight",
    db: Session = Depends(get_db),
):
    return service.analytics(db, team_id, days, metric)
