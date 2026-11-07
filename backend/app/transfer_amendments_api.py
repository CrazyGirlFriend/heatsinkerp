"""HTTP validation and identity boundary for transfer amendments."""

from fastapi import Depends, status
from sqlalchemy.orm import Session

from . import transfer_amendments as service
from .async_api import AsyncAPIRouter
from .auth import get_current_user
from .database import get_db
from .models import (
    User,
)
from .transfer_amendment_schemas import (
    AmendmentCreate,
    AmendmentReject,
    TransferAmendmentListResponse,
    TransferAmendmentResponse,
)

router = AsyncAPIRouter(prefix="/api", tags=["transfer amendments"])


@router.get(
    "/material-transfers/{batch_no}/amendments", response_model=TransferAmendmentListResponse
)
def list_amendments(
    batch_no: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    return service.list_amendments(batch_no=batch_no, db=db, user=user)


@router.post(
    "/material-transfers/{batch_no}/amendments",
    status_code=status.HTTP_201_CREATED,
    response_model=TransferAmendmentResponse,
)
def post_amendment(
    batch_no: str,
    payload: AmendmentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return service.request_amendment(db, batch_no, payload, user)


@router.get("/transfer-amendments/{amendment_id}", response_model=TransferAmendmentResponse)
def read_amendment(
    amendment_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    return service.get_amendment(db, amendment_id, user)


@router.post(
    "/transfer-amendments/{amendment_id}/approve", response_model=TransferAmendmentResponse
)
def approve(
    amendment_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    return service.resolve_amendment(db, amendment_id, "approved", user)


@router.post("/transfer-amendments/{amendment_id}/reject", response_model=TransferAmendmentResponse)
def reject(
    amendment_id: int,
    payload: AmendmentReject,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return service.resolve_amendment(db, amendment_id, "rejected", user, payload.reason)


@router.post("/transfer-amendments/{amendment_id}/cancel", response_model=TransferAmendmentResponse)
def cancel(
    amendment_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    return service.resolve_amendment(db, amendment_id, "cancelled", user)
