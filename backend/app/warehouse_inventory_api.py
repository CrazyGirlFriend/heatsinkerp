"""HTTP parameters and authentication for classified inventory queries."""

from typing import Annotated

from fastapi import Depends, Path, Query
from sqlalchemy.orm import Session

from .async_api import AsyncAPIRouter as APIRouter
from .async_read_response import team_read_response
from .auth import get_current_user
from .database import get_db
from .inventory_read_schemas import TeamInventoryPageResponse
from .models import User
from .record_filters import RecordFilters
from .stock_read_schemas import StockMovementsResponse, StockPageResponse
from .warehouse_inventory import (
    WarehouseInventoryFilters,
    list_group_movements,
    list_group_pending,
    list_group_sources,
    list_inventory,
)

router = APIRouter(prefix="/api/team-materials", tags=["classified inventory"])


@router.get(
    "/{team_id}/inventory/{group_id}/pending-outbound", response_model=StockMovementsResponse
)
def pending_endpoint(
    team_id: int = Path(ge=1),
    group_id: int = Path(ge=1),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return team_read_response(
        db,
        lambda session: list_group_pending(
            session, team_id, group_id, user, page=page, page_size=page_size
        ),
        schema=StockMovementsResponse,
    )


@router.get("/{team_id}/inventory/{group_id}/movements", response_model=StockMovementsResponse)
def movements_endpoint(
    team_id: int = Path(ge=1),
    group_id: int = Path(ge=1),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return team_read_response(
        db,
        lambda session: list_group_movements(
            session, team_id, group_id, user, page=page, page_size=page_size
        ),
        schema=StockMovementsResponse,
    )


@router.get(
    "/{team_id}/inventory",
    response_model=TeamInventoryPageResponse,
    response_model_exclude_unset=True,
)
def inventory_endpoint(
    filters: Annotated[WarehouseInventoryFilters, Query()],
    team_id: int = Path(ge=1),
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return team_read_response(
        db,
        lambda session: list_inventory(session, team_id, filters),
        schema=TeamInventoryPageResponse,
    )


@router.get(
    "/{team_id}/inventory/{group_id}/sources",
    response_model=StockPageResponse,
    response_model_exclude_unset=True,
)
def sources_endpoint(
    record_filters: RecordFilters = Depends(),
    team_id: int = Path(ge=1),
    group_id: int = Path(ge=1),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    current_only: bool = False,
    query: str | None = Query(default=None, max_length=160),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return list_group_sources(
        db,
        team_id,
        group_id,
        user,
        page=page,
        page_size=page_size,
        current_only=current_only,
        query=query,
        record_filters=record_filters,
    )
