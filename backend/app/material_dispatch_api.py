"""One batch barcode for complete outbound documents and confirmation."""
from fastapi import Depends
from sqlalchemy.orm import Session

from .auth import get_current_user
from .database import get_db
from .models import User
from . import material_dispatch_workflow as workflow

from .async_api import AsyncAPIRouter as APIRouter

router = APIRouter(prefix="/api/material-dispatches", tags=["material dispatch batches"])


@router.get("/{dispatch_no}")
def get_dispatch(dispatch_no: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return workflow.get_dispatch(db, dispatch_no, user)


@router.post("/{dispatch_no}/confirm")
def confirm_dispatch(dispatch_no: str, payload: workflow.DispatchConfirm,
                     user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return workflow.confirm_dispatch(db, dispatch_no, payload, user)


@router.post("/{dispatch_no}/confirm-outbound")
def confirm_outbound(dispatch_no: str, payload: workflow.DispatchConfirm,
                     user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return workflow.confirm_dispatch(db, dispatch_no, payload, user, external=True)
