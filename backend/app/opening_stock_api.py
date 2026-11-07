"""HTTP validation and identity boundary for opening stock."""

from fastapi import Depends, Path
from sqlalchemy.orm import Session

from . import opening_stock as service
from .async_api import AsyncAPIRouter as APIRouter
from .auth import get_current_user
from .database import get_db
from .models import User
from .opening_stock import OpeningCreate
from .stock_read_schemas import OpeningStockResultResponse, OpeningStockStateResponse

router = APIRouter(prefix="/api/team-materials", tags=["opening stock"])


@router.get("/{team_id}/opening-stock", response_model=OpeningStockStateResponse)
def state(
    team_id: int = Path(ge=1), user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return service.state(team_id=team_id, user=user, db=db)


@router.post("/{team_id}/opening-stock", status_code=201, response_model=OpeningStockResultResponse)
def create(
    payload: OpeningCreate,
    team_id: int = Path(ge=1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return service.create(payload=payload, team_id=team_id, user=user, db=db)
