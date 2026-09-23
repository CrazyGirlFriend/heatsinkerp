"""Team stock workspace HTTP routes. Business writes remain transaction services."""
from fastapi import Depends, Path, Query
from sqlalchemy.orm import Session

from .auth import get_current_user
from .record_filters import RecordFilters
from .database import get_db
from .models import User
from .schemas import DIRECT_MATERIAL_TYPE_PATTERN, WarehouseReceiptCreate, MaterialTransferResponse, MaterialTransferList
from . import material_stock as stock
from . import warehouse_receipts
from .async_read_response import team_read_response

from .async_api import AsyncAPIRouter as APIRouter

router = APIRouter(prefix="/api/team-materials", tags=["team material stock"])


@router.post("/{team_id}/receipts", status_code=201, response_model=MaterialTransferResponse)
def create_warehouse_receipt(payload: WarehouseReceiptCreate, team_id: int = Path(ge=1),
                             user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return warehouse_receipts.create_receipt(db, team_id, payload, user)


@router.get("/{team_id}/receipts", response_model=MaterialTransferList)
def list_warehouse_receipts(record_filters: RecordFilters = Depends(), team_id: int = Path(ge=1), query: str | None = Query(default=None, max_length=160),
                            material_type: str | None = Query(default=None, pattern=DIRECT_MATERIAL_TYPE_PATTERN),
                            receipt_source: str | None = Query(default=None, pattern="^(external|internal|return)$"),
                            page: int = Query(default=1, ge=1), page_size: int = Query(default=20, ge=1, le=100),
                            user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return warehouse_receipts.list_receipts(db, team_id, user, record_filters=record_filters, query=query, material_type=material_type, receipt_source=receipt_source,
                                            page=page, page_size=page_size)


@router.get("/{team_id}/overview")
def overview(team_id: int = Path(ge=1), _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return team_read_response(db, lambda session: stock.overview(session, team_id))


@router.get("/{team_id}/stock")
def list_stock(record_filters: RecordFilters = Depends(), team_id: int = Path(ge=1), query: str | None = Query(default=None, max_length=160),
               serial_no: str | None = Query(default=None, max_length=80),
               material_type: str | None = Query(default=None, pattern=DIRECT_MATERIAL_TYPE_PATTERN),
               availability: str = Query(default="available", pattern="^(available|dispatchable|all)$"),
               page: int = Query(default=1, ge=1), page_size: int = Query(default=20, ge=1, le=100),
               user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return stock.list_stock(db, team_id, user, record_filters=record_filters, query=query, serial_no=serial_no, material_type=material_type,
                           availability=availability, page=page, page_size=page_size)


@router.post("/{team_id}/losses", status_code=201)
def create_loss(payload: stock.LossCreate, team_id: int = Path(ge=1),
                user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return stock.create_loss(db, team_id, payload, user)


@router.get("/{team_id}/losses")
def list_losses(record_filters: RecordFilters = Depends(), team_id: int = Path(ge=1), query: str | None = Query(default=None, max_length=160),
                serial_no: str | None = Query(default=None, max_length=80),
                source_transfer_id: int | None = Query(default=None, ge=1),
                page: int = Query(default=1, ge=1), page_size: int = Query(default=20, ge=1, le=100),
                _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return stock.list_losses(db, team_id, record_filters=record_filters, query=query, serial_no=serial_no, source_transfer_id=source_transfer_id, page=page, page_size=page_size)


@router.post("/{team_id}/dispatches", status_code=201)
@router.post("/{team_id}/outbound-batches", status_code=201)
def create_dispatch(payload: stock.DispatchCreate, team_id: int = Path(ge=1),
                    user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return stock.create_dispatch(db, team_id, payload, user)


@router.get("/{team_id}/outbound-batches", response_model=MaterialTransferList)
def list_outbound_batches(record_filters: RecordFilters = Depends(), team_id: int = Path(ge=1),
                         query: str | None = Query(default=None, max_length=160),
                         material_type: str | None = Query(default=None, pattern=DIRECT_MATERIAL_TYPE_PATTERN),
                         next_team_id: int | None = Query(default=None, ge=1),
                         status: str | None = Query(default=None, pattern="^(pending|received|dispatched|voided)$"),
                         entry_kind: str | None = Query(default=None, pattern="^(transfer|warehouse_outbound|inspection_shipment)$"),
                         page: int = Query(default=1, ge=1), page_size: int = Query(default=10, ge=1, le=100),
                         user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return stock.list_outbound_batches(db, team_id, user, record_filters=record_filters, query=query,
        material_type=material_type, next_team_id=next_team_id, status=status, entry_kind=entry_kind, page=page, page_size=page_size)


@router.get("/{team_id}/dispatches")
def list_dispatches(record_filters: RecordFilters = Depends(), team_id: int = Path(ge=1), query: str | None = Query(default=None, max_length=160),
                    next_team_id: int | None = Query(default=None, ge=1),
                    status: str | None = Query(default=None, pattern="^(pending|partial|received|dispatched|voided)$"),
                    entry_kind: str | None = Query(default=None, pattern="^(transfer|warehouse_outbound|inspection_shipment)$"),
                    page: int = Query(default=1, ge=1), page_size: int = Query(default=20, ge=1, le=100),
                    user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return stock.list_dispatches(db, team_id, user, record_filters=record_filters, query=query, next_team_id=next_team_id, status=status, entry_kind=entry_kind, page=page, page_size=page_size)
