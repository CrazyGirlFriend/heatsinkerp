"""Append-only serial reassignment; source deduction and target stock commit together."""

from types import SimpleNamespace

from fastapi import HTTPException
from pydantic import Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, OperationalError

from . import material_stock as stock
from . import material_transfer_workflow as workflow
from .auth import actor_name
from .batch_numbers import next_transfer_batch_number
from .material_weight import sludge_measurement
from .models import MaterialTransfer, Team, utcnow
from .schemas import SludgeMeasurement, WarehouseLocationChoice
from .team_constants import REALLOCATION_TEAM_CODES, WAREHOUSE_TEAM_CODE


class ReallocationCreate(stock.StockAmounts, WarehouseLocationChoice, SludgeMeasurement):
    serial_no: str = Field(min_length=1, max_length=80)
    reason: str = Field(default="", max_length=2000)
    idempotency_key: str = Field(min_length=1, max_length=100)

    @field_validator("serial_no", "idempotency_key")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("value cannot be blank")
        return value.strip()

    @field_validator("reason")
    @classmethod
    def normalize_reason(cls, value):
        return value.strip()


def require_team(team):
    if (
        not team.active
        or team.code not in REALLOCATION_TEAM_CODES
        or (team.kind != ("warehouse" if team.code == WAREHOUSE_TEAM_CODE else "production"))
    ):
        raise HTTPException(403, "仅库房、检验和电镀班组可以转投本班组库存")
    return team


def replay(prior, user, request_hash):
    if prior.entry_kind != "serial_reallocation":
        raise HTTPException(409, "idempotency key was used for another operation")
    stock._replay(prior, user, request_hash, "next_team_id")
    return workflow.material_transfer_dict(prior, user)


def create(db, team_id, payload, user):
    require_team(stock.require_actor(user, team_id))
    request_hash = stock.fingerprint(payload)
    try:
        with db.begin():
            prior = db.scalar(
                select(MaterialTransfer).where(
                    MaterialTransfer.idempotency_key == payload.idempotency_key
                )
            )
            if prior is not None:
                return replay(prior, user, request_hash)
        with db.begin():
            # The source lock serializes deductions, including a same-key retry.
            lot = stock.lock_lot(db, payload.source_transfer_id, team_id)
            prior = db.scalar(
                select(MaterialTransfer)
                .where(MaterialTransfer.idempotency_key == payload.idempotency_key)
                .execution_options(populate_existing=True)
            )
            if prior is not None:
                return replay(prior, user, request_hash)
            team = require_team(
                db.scalar(
                    select(Team)
                    .where(Team.id == team_id)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
            )
            if payload.serial_no == lot.serial_no:
                raise HTTPException(422, "目标流水号不能与当前流水号相同")
            # Follow the existing signed-stock policy; this operation adds no amount cap.
            stock.available_locked(db, lot)
            measured = sludge_measurement(
                lot.material_type,
                payload.weight,
                payload.sludge_gross_weight,
                payload.sludge_content_percent,
                source=lot,
            )
            from .warehouse_locations import consume

            location = consume(
                db,
                team,
                SimpleNamespace(
                    **payload.model_dump(),
                    material_name=lot.material_name,
                    material_type=lot.material_type,
                ),
                user,
            )
            now = utcnow()
            item = MaterialTransfer(
                batch_no=next_transfer_batch_number(db),
                entry_kind="serial_reallocation",
                serial_no=payload.serial_no,
                source_transfer_id=lot.id,
                source_team_id=team.id,
                source_team_code=team.code,
                source_team_name=team.name,
                next_team_id=team.id,
                next_team_code=team.code,
                next_team_name=team.name,
                **{
                    field: getattr(lot, field)
                    for field in workflow.DOCUMENT_FIELDS
                    if field not in ("delivery_date", "delivery_quantity")
                },
                purpose_id=lot.purpose_id,
                purpose_name=lot.purpose_name,
                warehouse_location=location,
                quantity=payload.quantity,
                weight=payload.weight,
                **measured,
                notes=payload.reason,
                status="received",
                stock_tracked=True,
                idempotency_key=payload.idempotency_key,
                request_hash=request_hash,
                created_by=actor_name(user),
                created_by_user_id=user.id,
                received_by=actor_name(user),
                received_by_user_id=user.id,
                created_at=now,
                updated_at=now,
                received_at=now,
                history=[],
                losses=[],
            )
            db.add(item)
            db.flush()
            db.refresh(item, attribute_names=["created_at", "updated_at", "received_at"])
            workflow._record_event(db, item, user, "reallocated")
            item.history[-1].changes = {
                **item.history[-1].changes,
                "source_serial_no": {"before": None, "after": lot.serial_no},
                "source_transfer_batch_no": {"before": None, "after": lot.batch_no},
            }
            db.flush()
            result = workflow.material_transfer_dict(item, user)
        return result
    except (IntegrityError, OperationalError) as exc:
        db.rollback()
        prior = db.scalar(
            select(MaterialTransfer).where(
                MaterialTransfer.idempotency_key == payload.idempotency_key
            )
        )
        if prior is not None:
            return replay(prior, user, request_hash)
        stock._db_conflict(exc)
