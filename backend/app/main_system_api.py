"""Exact serial lookup and explicit warehouse intake using authoritative snapshots."""
import hashlib
import json
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import main_system, material_stock, warehouse_receipts
from .auth import get_current_user
from .database import get_db
from .models import MaterialTransfer, User
from .schemas import DIRECT_MATERIAL_TYPE_PATTERN, MaterialTransferResponse, WarehouseReceiptCreate

router = APIRouter(prefix="/api/main-system", tags=["main system serial materials"])


class MainSystemReceiptCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    serial_no: str = Field(min_length=1, max_length=80)
    expected_snapshot_hash: str = Field(pattern="^[a-f0-9]{64}$")
    material_type: str = Field(pattern=DIRECT_MATERIAL_TYPE_PATTERN)
    quantity: int = Field(ge=0, le=2_147_483_647)
    weight: Decimal = Field(ge=0, max_digits=14, decimal_places=3)
    notes: str = Field(min_length=1, max_length=2000)
    idempotency_key: str = Field(min_length=1, max_length=100)

    @field_validator("serial_no", "notes", "idempotency_key")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("required text cannot be blank")
        return value.strip()

    @model_validator(mode="after")
    def positive_amount(self):
        if self.quantity == 0 and self.weight == 0:
            raise ValueError("quantity or weight must be positive")
        return self


@router.get("/serial-material", response_model=main_system.MainSystemLookup)
def lookup_serial(response: Response, serial_no: str = Query(min_length=1, max_length=80),
                  _: User = Depends(get_current_user)):
    serial_no = serial_no.strip()
    if not serial_no:
        raise HTTPException(422, "serial_no cannot be blank")
    record = main_system.fetch_serial(serial_no)
    response.headers["Cache-Control"] = "no-store"
    return {**record.model_dump(), "snapshot_hash": main_system.snapshot_hash(record)}


@router.post("/warehouses/{team_id}/receipts", status_code=201, response_model=MaterialTransferResponse)
def receive_from_main_system(payload: MainSystemReceiptCreate, team_id: int = Path(ge=1),
                             user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    warehouse_receipts.require_warehouse(material_stock.require_actor(user, team_id))
    values = {"operation": "main-system-receipt-v1", "team_id": team_id,
              **payload.model_dump(mode="json", exclude={"idempotency_key"})}
    request_hash = hashlib.sha256(json.dumps(values, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    prior = db.scalar(select(MaterialTransfer).where(MaterialTransfer.idempotency_key == payload.idempotency_key))
    if prior is not None:
        return warehouse_receipts.replay(prior, user, request_hash)
    # No database locks/transactions remain open during the outbound HTTP request.
    db.commit()
    record = main_system.fetch_serial(payload.serial_no)
    if not record.active:
        raise HTTPException(409, "serial number is inactive in main system")
    if main_system.snapshot_hash(record) != payload.expected_snapshot_hash:
        raise HTTPException(409, "main system material changed; reload and review before receiving")
    receipt = WarehouseReceiptCreate(**{
        **record.document.model_dump(),
        **payload.model_dump(exclude={"expected_snapshot_hash"}),
    })
    return warehouse_receipts.create_receipt(db, team_id, receipt, user, request_hash=request_hash,
        source_reference={
            "main_system_schema_version": record.schema_version,
            "main_system_revision": record.revision,
            "main_system_updated_at": record.updated_at.isoformat(),
            "main_system_snapshot_hash": payload.expected_snapshot_hash,
        })
