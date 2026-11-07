"""HTTP validation and identity boundary for factory overview."""

from fastapi import Depends, Query
from sqlalchemy.orm import Session

from . import factory_overview as service
from .analytics_read_schemas import FactoryOverviewResponse
from .async_api import AsyncAPIRouter as APIRouter
from .auth import get_current_user
from .database import get_db

router = APIRouter(prefix="/api/factory-overview", dependencies=[Depends(get_current_user)])


@router.get("", response_model=FactoryOverviewResponse, response_model_exclude_unset=True)
def overview_endpoint(days: int = Query(30, ge=1, le=365), db: Session = Depends(get_db)):
    return service.factory_overview(db, days)
