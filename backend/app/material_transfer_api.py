"""Process-independent transfer documents, lookup and whole-batch receipt."""
from __future__ import annotations

from fastapi import Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from .auth import get_current_user, require_admin
from .record_filters import RecordFilters
from .api_errors import not_found as _not_found
from .database import get_db
from .models import MaterialTransfer, Team, User
from .material_transfer_query import search_predicate, team_scope_predicate
from . import material_transfer_workflow
from .schemas import (DIRECT_MATERIAL_TYPE_PATTERN, MaterialTransferCreate, MaterialTransferUpdate,
                      MaterialTransferConfirm, MaterialTransferReject, MaterialTransferList, MaterialTransferResponse)

from .async_api import AsyncAPIRouter as APIRouter

router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])


@router.get("/material-trace", tags=["material transfers"])
def get_serial_trace(
    serial_no: str = Query(min_length=1, max_length=80),
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    from .material_trace import serial_trace
    if not serial_no.strip():
        raise HTTPException(422, "serial_no is required")
    return serial_trace(db, serial_no, current_user)


@router.post(
    "/material-transfers",
    response_model=MaterialTransferResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["material transfers"],
)
def create_material_transfer(
    payload: MaterialTransferCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return material_transfer_workflow.create_material_transfer(
        db, payload, current_user
    )


@router.get(
    "/material-transfers",
    response_model=MaterialTransferList,
    tags=["material transfers"],
)
def list_material_transfers(
    record_filters: RecordFilters = Depends(),
    query: str | None = Query(default=None, max_length=160),
    search_mode: str = Query(default="contains", pattern="^(contains|exact|prefix)$"),
    search_field: str = Query(default="all", pattern="^(all|batch_no|serial_no|source_batch_no|product_code|customer_code|material_name)$"),
    material_type: str | None = Query(default=None, pattern=DIRECT_MATERIAL_TYPE_PATTERN),
    team_id: int | None = Query(default=None, ge=1),
    direction: str = Query(default="all", pattern="^(all|outgoing|incoming)$"),
    serial_no: str | None = Query(default=None, max_length=80),
    source_team_id: int | None = Query(default=None, ge=1),
    next_team_id: int | None = Query(default=None, ge=1),
    target_team_id: int | None = Query(default=None, ge=1),
    status_filter: str | None = Query(
        default=None, alias="status", pattern="^(pending|received|dispatched|voided)$"
    ),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    if (
        next_team_id is not None
        and target_team_id is not None
        and next_team_id != target_team_id
    ):
        raise HTTPException(422, "next_team_id and target_team_id must match")
    target_id = next_team_id if next_team_id is not None else target_team_id
    filters = []
    if direction != "all" and team_id is None:
        raise HTTPException(422, "team_id is required when direction is incoming or outgoing")
    if team_id is not None:
        if db.get(Team, team_id) is None:
            raise _not_found("team")
        filters.append(team_scope_predicate(team_id, direction))
    if query and query.strip():
        filters.append(search_predicate(query, search_field, search_mode))
    if material_type is not None:
        filters.append(MaterialTransfer.material_type == material_type)
    if serial_no is not None:
        filters.append(MaterialTransfer.serial_no == serial_no.strip())
    if source_team_id is not None:
        filters.append(MaterialTransfer.source_team_id == source_team_id)
    if target_id is not None:
        filters.append(MaterialTransfer.next_team_id == target_id)
    if status_filter is not None:
        filters.append(MaterialTransfer.status == status_filter)
    filters.extend(record_filters.predicates(MaterialTransfer.created_at, MaterialTransfer.serial_no))
    total = db.scalar(select(func.count(MaterialTransfer.id)).where(*filters)) or 0
    order_columns = (
        (MaterialTransfer.created_at.asc(), MaterialTransfer.id.asc())
        if serial_no is not None
        else (MaterialTransfer.created_at.desc(), MaterialTransfer.id.desc())
    )
    transfers = db.scalars(
        select(MaterialTransfer)
        .options(*material_transfer_workflow.material_transfer_list_options())
        .where(*filters)
        .order_by(*order_columns)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return {
        "items": [
            material_transfer_workflow.material_transfer_dict(item, current_user, include_history=False)
            for item in transfers
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get(
    "/material-transfers/{batch_no}",
    response_model=MaterialTransferResponse,
    tags=["material transfers"],
)
def get_material_transfer(
    batch_no: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return material_transfer_workflow.get_material_transfer(db, batch_no, current_user)


@router.patch(
    "/material-transfers/{batch_no}",
    response_model=MaterialTransferResponse,
    tags=["material transfers"],
)
def update_material_transfer(
    batch_no: str,
    payload: MaterialTransferUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return material_transfer_workflow.update_material_transfer(
        db, batch_no, payload, current_user
    )


@router.delete(
    "/material-transfers/{batch_no}",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["material transfers"],
)
def void_material_transfer(
    batch_no: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    material_transfer_workflow.void_material_transfer(db, batch_no, current_user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/material-transfers/{batch_no}/confirm",
    response_model=MaterialTransferResponse,
    tags=["material transfers", "scanning"],
)
def confirm_material_transfer(
    batch_no: str,
    payload: MaterialTransferConfirm,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return material_transfer_workflow.confirm_material_transfer(
        db, batch_no, payload, current_user
    )


@router.post("/material-transfers/{batch_no}/confirm-outbound", response_model=MaterialTransferResponse,
             tags=["material transfers"])
def confirm_outbound(batch_no: str, payload: MaterialTransferConfirm,
                     current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    return material_transfer_workflow.confirm_outbound(db, batch_no, payload, current_user)


@router.post("/material-transfers/{batch_no}/reject", response_model=MaterialTransferResponse,
             tags=["material transfers"])
def reject_material_transfer(batch_no: str, payload: MaterialTransferReject,
                             current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    return material_transfer_workflow.reject_material_transfer(db, batch_no, payload, current_user)
