"""One authorized, atomic initialization per team; never overwrite balances."""
from decimal import Decimal
from fastapi import Depends, HTTPException, Path
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from .auth import actor_name, get_current_user
from .batch_numbers import next_transfer_batch_number
from .database import get_db
from .models import Team, MaterialTransfer, OpeningStockSubmission, User, utcnow
from .schemas import MaterialTransferDocumentFields
from . import material_stock as stock
from . import material_transfer_workflow as workflow
from .team_business import purpose_snapshot

from .async_api import AsyncAPIRouter as APIRouter

router = APIRouter(prefix="/api/team-materials", tags=["opening stock"])


class OpeningLine(MaterialTransferDocumentFields):
    model_config = ConfigDict(extra="forbid")
    serial_no: str = Field(min_length=1, max_length=80)
    material_name: str = Field(min_length=1, max_length=160)
    purpose_id: int | None = Field(default=None, ge=1)
    quantity: int = Field(ge=0, le=2_147_483_647)
    weight: Decimal = Field(ge=0, max_digits=14, decimal_places=3)
    notes: str | None = Field(default=None, max_length=2000)

    @field_validator("serial_no")
    @classmethod
    def serial(cls, value):
        if not value.strip():
            raise ValueError("请填写流水号")
        return value.strip()

    @model_validator(mode="after")
    def valid(self):
        if not self.material_name or not self.material_type:
            raise ValueError("请填写材质并选择物料类型")
        if self.quantity == 0 and self.weight == 0:
            raise ValueError("件数和重量至少一项大于零")
        return self


class OpeningCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    idempotency_key: str = Field(min_length=1, max_length=100)
    lines: list[OpeningLine] = Field(min_length=1, max_length=100)

    @field_validator("idempotency_key")
    @classmethod
    def key(cls, value):
        if not value.strip():
            raise ValueError("idempotency_key cannot be blank")
        return value.strip()


def result(db, submission, user):
    rows = db.scalars(select(MaterialTransfer).where(MaterialTransfer.opening_stock_id == submission.id).order_by(MaterialTransfer.id)).all()
    return {"id": submission.id, "items": [workflow.material_transfer_dict(row, user) for row in rows], "count": len(rows)}


@router.get("/{team_id}/opening-stock")
def state(team_id: int = Path(ge=1), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    team = stock.require_team(db, team_id)
    submission = db.scalar(select(OpeningStockSubmission).where(OpeningStockSubmission.team_id == team_id))
    has_stock_history = db.scalar(select(MaterialTransfer.id).where(MaterialTransfer.next_team_id == team_id,
        MaterialTransfer.status == "received", MaterialTransfer.stock_tracked.is_(True)).limit(1)) is not None
    return {"enabled": team.opening_stock_enabled, "completed": submission is not None,
            "has_stock_history": has_stock_history,
            "can_submit": user.role == "TEAM" and user.team_id == team_id and team.active and team.opening_stock_enabled and not submission and not has_stock_history,
            "items": result(db, submission, user)["items"] if submission else []}


@router.post("/{team_id}/opening-stock", status_code=201)
def create(payload: OpeningCreate, team_id: int = Path(ge=1), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    stock.require_actor(user, team_id)
    request_hash = stock.fingerprint(payload)
    try:
        with db.begin():
            team = db.scalar(select(Team).where(Team.id == team_id).with_for_update().execution_options(populate_existing=True))
            prior = db.scalar(select(OpeningStockSubmission).where(OpeningStockSubmission.idempotency_key == payload.idempotency_key).with_for_update())
            if prior:
                stock._replay(prior, user, request_hash, "team_id")
                return result(db, prior, user)
            if not team.active or not team.opening_stock_enabled:
                raise HTTPException(403, "管理员尚未开启本班组的期初库存录入权限")
            if db.scalar(select(OpeningStockSubmission.id).where(OpeningStockSubmission.team_id == team_id)):
                raise HTTPException(409, "本班组已完成期初入账，不能重复提交")
            if db.scalar(select(MaterialTransfer.id).where(MaterialTransfer.next_team_id == team_id,
                MaterialTransfer.status == "received", MaterialTransfer.stock_tracked.is_(True)).limit(1)):
                raise HTTPException(409, "本班组已有入账记录，不能将当前库存再次作为期初库存叠加")
            submission = OpeningStockSubmission(team_id=team_id, idempotency_key=payload.idempotency_key,
                request_hash=request_hash, created_by=actor_name(user))
            db.add(submission)
            db.flush()
            now = utcnow()
            for line in payload.lines:
                purpose = purpose_snapshot(db, team_id, line.purpose_id, required=False)
                transfer = MaterialTransfer(batch_no=next_transfer_batch_number(db), entry_kind="opening_stock",
                    opening_stock_id=submission.id, serial_no=line.serial_no,
                    **{field: getattr(line, field) for field in workflow.DOCUMENT_FIELDS}, **purpose,
                    next_team_id=team.id, next_team_code=team.code, next_team_name=team.name,
                    quantity=line.quantity, weight=line.weight, notes=line.notes, status="received", stock_tracked=True,
                    created_by=actor_name(user), created_by_user_id=user.id, received_by=actor_name(user), received_by_user_id=user.id,
                    created_at=now, updated_at=now, received_at=now)
                db.add(transfer)
                db.flush()
                db.refresh(transfer, attribute_names=["created_at", "updated_at", "received_at"])
                workflow._record_event(db, transfer, user, "stocked")
            team.opening_stock_enabled = False
            response = result(db, submission, user)
        return response
    except (IntegrityError, OperationalError) as exc:
        db.rollback()
        prior = db.scalar(select(OpeningStockSubmission).where(OpeningStockSubmission.idempotency_key == payload.idempotency_key))
        if prior:
            stock._replay(prior, user, request_hash, "team_id")
            return result(db, prior, user)
        stock._db_conflict(exc)
