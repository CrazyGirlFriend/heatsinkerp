"""HTTP validation and identity boundary for factory performance."""

from datetime import date
from typing import Annotated, Literal

from fastapi import Depends, Query
from sqlalchemy.orm import Session

from . import factory_performance as service
from .async_api import AsyncAPIRouter
from .auth import get_current_user
from .database import get_db
from .factory_performance_schemas import FactoryPerformanceResponse
from .models import (
    User,
)

router = AsyncAPIRouter(prefix="/api/factory-performance")


@router.get("", response_model=FactoryPerformanceResponse, response_model_exclude_unset=True)
def report(
    date_from: date | None = None,
    date_to: date | None = None,
    team_id: int | None = Query(default=None, gt=0),
    period: Literal["day", "week", "month"] = "day",
    serial_no: Annotated[str | None, Query(min_length=1, max_length=80)] = None,
    work_id: Annotated[int | None, Query(gt=0)] = None,
    material_name: Annotated[str | None, Query(min_length=1, max_length=160)] = None,
    include_activity: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return service.report(
        date_from=date_from,
        date_to=date_to,
        team_id=team_id,
        period=period,
        serial_no=serial_no,
        work_id=work_id,
        material_name=material_name,
        include_activity=include_activity,
        db=db,
        user=user,
    )
