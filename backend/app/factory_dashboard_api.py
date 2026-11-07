"""Authenticated factory dashboard queries, with HTTP input validation."""

from datetime import date

from fastapi import Depends, Query
from sqlalchemy.orm import Session

from . import factory_dashboard as queries
from .async_api import AsyncAPIRouter
from .auth import get_current_user
from .database import get_db
from .factory_dashboard_schemas import (
    DashboardSerialResponse,
    DashboardStockDetailResponse,
    DeliveryResponse,
    FactoryDashboardResponse,
    LegacyDeliveryPlanResponse,
    SerialYieldResponse,
    ShipmentsResponse,
    TeamYieldsResponse,
)
from .read_schemas import PageResponse

router = AsyncAPIRouter(prefix="/api/factory-dashboard", dependencies=[Depends(get_current_user)])


@router.get("/serials", response_model=PageResponse[DashboardSerialResponse])
def get_serials(
    query: str = Query("", max_length=80),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
):
    return queries.serial_page(db, query, page, page_size)


@router.get("/shipments", response_model=ShipmentsResponse)
def get_shipments(
    date_from: date,
    date_to: date,
    serial_no: list[str] = Query(default=[], max_length=100),
    db: Session = Depends(get_db),
):
    return queries.get_shipments(date_from=date_from, date_to=date_to, serial_no=serial_no, db=db)


@router.get("/yields", response_model=PageResponse[SerialYieldResponse])
def get_yields(
    material: str = Query("", max_length=160),
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    db: Session = Depends(get_db),
):
    return queries.get_yields(material=material, page=page, page_size=page_size, db=db)


@router.get("/team-yields", response_model=TeamYieldsResponse)
def get_team_yields(
    serial_no: str = Query(min_length=1, max_length=80),
    material: str = Query("", max_length=160),
    db: Session = Depends(get_db),
):
    return queries.get_team_yields(serial_no=serial_no, material=material, db=db)


@router.get("/stock-detail", response_model=PageResponse[DashboardStockDetailResponse])
def get_stock_detail(
    team_id: int | None = Query(None, ge=1),
    material: str = Query("", max_length=160),
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    db: Session = Depends(get_db),
):
    return queries.get_stock_detail(
        team_id=team_id, material=material, page=page, page_size=page_size, db=db
    )


@router.get("/delivery-plan", response_model=LegacyDeliveryPlanResponse)
def get_plan(serial_no: str = Query(min_length=1, max_length=80), db: Session = Depends(get_db)):
    return queries.get_plan(serial_no=serial_no, db=db)


@router.put("/delivery-plan")
def save_plan():
    return queries.save_plan()


@router.get("/deliveries", response_model=PageResponse[DeliveryResponse])
def get_deliveries(
    query: str = Query("", max_length=80),
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    db: Session = Depends(get_db),
):
    return queries.get_deliveries(query=query, page=page, page_size=page_size, db=db)


@router.get("", response_model=FactoryDashboardResponse, response_model_exclude_unset=True)
def get_dashboard(db: Session = Depends(get_db)):
    return queries.get_dashboard(db=db)
