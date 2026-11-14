"""HTTP validation and identity boundary for warehouse locations."""

from typing import Literal

from fastapi import Depends, Query
from sqlalchemy.orm import Session

from . import warehouse_locations as service
from .async_api import AsyncAPIRouter
from .auth import get_current_user
from .database import get_db
from .models import (
    User,
)
from .warehouse_location_schemas import (
    WarehouseCatalogPage,
    WarehouseLeaseResponse,
    WarehouseLocationPage,
    WarehouseLocationResponse,
)
from .warehouse_locations import LeaseRequest, LocationWrite, PlacementWrite

router = AsyncAPIRouter(prefix="/api/warehouse-locations", tags=["warehouse management"])


@router.get("", response_model=WarehouseLocationPage, response_model_exclude_unset=True)
def catalog(
    query: str | None = Query(default=None, max_length=80),
    state: Literal["occupied", "available", "pending", "draft", "disabled"] | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return service.catalog(
        query=query, state=state, page=page, page_size=page_size, user=user, db=db
    )


@router.get("/inventory", response_model=WarehouseCatalogPage, response_model_exclude_unset=True)
def inventory_catalog(
    query: str | None = Query(default=None, max_length=80),
    state: Literal["occupied", "available", "pending", "draft", "disabled", "unassigned"]
    | None = None,
    team_id: int | None = Query(default=None, ge=1),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from .warehouse_catalog import list_catalog

    return list_catalog(
        db, user, query=query, state=state, team_id=team_id, page=page, page_size=page_size
    )


@router.post(
    "", response_model=WarehouseLocationResponse, response_model_exclude_unset=True, status_code=201
)
def create(
    payload: LocationWrite, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return service.create(payload=payload, user=user, db=db)


@router.patch(
    "/{location_id}", response_model=WarehouseLocationResponse, response_model_exclude_unset=True
)
def edit(
    location_id: int,
    payload: LocationWrite,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return service.edit(location_id=location_id, payload=payload, user=user, db=db)


@router.post("/{location_id}/reservation", response_model=WarehouseLeaseResponse)
def claim(
    location_id: int,
    payload: LeaseRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return service.claim(location_id=location_id, payload=payload, user=user, db=db)


@router.post(
    "/{location_id}/placement",
    response_model=WarehouseLocationResponse,
    response_model_exclude_unset=True,
)
def assign(
    location_id: int,
    payload: PlacementWrite,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return service.assign(location_id=location_id, payload=payload, user=user, db=db)


@router.delete("/{location_id}/reservation", status_code=204)
def unclaim(
    location_id: int,
    payload: LeaseRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return service.unclaim(location_id=location_id, payload=payload, user=user, db=db)
