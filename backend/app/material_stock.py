"""Received-lot balances, atomic outbound reservations, and append-only loss records.

Every mutation locks its source lot and uses locking/current reads for deductions.
This is important under MySQL REPEATABLE READ: a prior idempotency lookup must
not make an old snapshot usable for a second reservation after waiting on a lock.
"""

from __future__ import annotations

import hashlib
import json
from contextlib import nullcontext
from decimal import Decimal
from uuid import uuid4

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import lazyload
from sqlalchemy.orm.attributes import set_committed_value

from . import material_transfer_workflow as workflow
from . import warehouse_feeding
from .auth import actor_name
from .batch_numbers import next_transfer_batch_numbers
from .inventory_shipments import ShipmentTotal

# Preserve the service API for existing routers and transaction callers.
from .material_stock_queries import (
    BALANCE_KEYS as BALANCE_KEYS,
)
from .material_stock_queries import (
    balance_dict as balance_dict,
)
from .material_stock_queries import (
    dispatch_dict as dispatch_dict,
)
from .material_stock_queries import (
    dispatch_status as dispatch_status,
)
from .material_stock_queries import (
    list_dispatches as list_dispatches,
)
from .material_stock_queries import (
    list_losses as list_losses,
)
from .material_stock_queries import (
    list_outbound_batches as list_outbound_batches,
)
from .material_stock_queries import (
    list_stock as list_stock,
)
from .material_stock_queries import (
    literal_query as literal_query,
)
from .material_stock_queries import (
    overview as overview,
)
from .material_stock_queries import (
    require_team as require_team,
)
from .material_stock_queries import (
    stock_table as stock_table,
)
from .material_weight import (
    sludge_measurement,
    validate_material_amounts,
)
from .models import (
    MaterialDispatch,
    MaterialLoss,
    MaterialStockBalance,
    MaterialTransfer,
    ProcessRoute,
    SerialUrgency,
    WarehouseFeedingSource,
    utcnow,
)
from .schemas import (
    DIRECT_MATERIAL_TYPE_PATTERN,
    SCRAP_MATERIAL_TYPES,
    OutboundQuantityClearance,
    ProcessingQuantity,
    SharedMaterialSerial,
    SludgeMeasurement,
    WarehouseLocationChoice,
)
from .team_constants import (
    EXTERNAL_DESTINATIONS,
    EXTERNAL_ENTRY_KINDS,
    WAREHOUSE_TEAM_CODE,
    outbound_kinds,
)


class StockAmounts(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_transfer_id: int = Field(ge=1)
    quantity: int = Field(ge=0, le=2_147_483_647)
    weight: Decimal = Field(ge=0, max_digits=17, decimal_places=6)

    @model_validator(mode="after")
    def nonempty(self):
        if self.quantity == 0 and self.weight == 0:
            raise ValueError("quantity or weight must be positive")
        return self


class LossCreate(StockAmounts):
    reason: str = Field(default="", max_length=2000)
    idempotency_key: str = Field(min_length=1, max_length=100)

    @field_validator("reason")
    @classmethod
    def normalize_reason(cls, value):
        return value.strip()


class DispatchLine(StockAmounts, WarehouseLocationChoice, SludgeMeasurement):
    serial_no: str | None = Field(default=None, min_length=1, max_length=80)
    shared_serials: list[SharedMaterialSerial] | None = Field(
        default=None, min_length=2, max_length=20
    )

    @model_validator(mode="after")
    def validate_shared(self):
        if self.shared_serials:
            if self.serial_no:
                raise ValueError("共投请在明细中填写流水号")
            serials = [member.serial_no.casefold() for member in self.shared_serials]
            if len(set(serials)) != len(serials):
                raise ValueError("共投流水号不能重复")
        return self

    @field_validator("serial_no")
    @classmethod
    def normalize_serial(cls, value):
        if value is not None and (not value.strip() or value.strip().startswith("共投-")):
            raise ValueError("请输入有效流水号")
        return value.strip() if value is not None else None

    process_route_id: int | None = Field(default=None, ge=1)
    process_route_version: int | None = Field(default=None, ge=1)
    production_schedule_id: int | None = Field(default=None, ge=1)
    production_schedule_batch_id: int | None = Field(default=None, ge=1)
    material_type: str | None = Field(default=None, pattern=DIRECT_MATERIAL_TYPE_PATTERN)
    purpose_id: int | None = Field(default=None, ge=1)
    transfer_specification: str | None = Field(default=None, max_length=240)

    @field_validator("transfer_specification")
    @classmethod
    def normalize_specification(cls, value):
        return value.strip() if value is not None else None


class DispatchCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sent_employee_id: int = Field(ge=1)
    feeding_assignments: list[warehouse_feeding.FeedingAssignment] | None = Field(
        default=None, min_length=1, max_length=100
    )
    feeding_target: warehouse_feeding.FeedingTarget | None = None
    feeding_targets: list[warehouse_feeding.FeedingTarget] | None = Field(
        default=None, min_length=2, max_length=20
    )
    rework_return: bool = False
    next_team_id: int | None = Field(default=None, ge=1)
    entry_kind: str = Field(
        default="transfer", pattern="^(transfer|warehouse_outbound|inspection_shipment)$"
    )
    external_destination: str | None = Field(default=None, max_length=240)
    notes: str | None = Field(default=None, max_length=2000)
    idempotency_key: str = Field(min_length=1, max_length=100)
    lines: list[DispatchLine] = Field(default_factory=list, max_length=100)
    inventory_total: ShipmentTotal | None = None
    quantity_clearances: list[OutboundQuantityClearance] = Field(
        default_factory=list, max_length=100
    )
    quantity_adjustments: list[ProcessingQuantity] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def validate_destination(self):
        if self.feeding_assignments:
            if self.feeding_target or self.feeding_targets or self.next_team_id is not None:
                raise ValueError("分别投料时按各目标排期指定接收班组")
            ids = [lot for group in self.feeding_assignments for lot in group.source_transfer_ids]
            if len(ids) != len(set(ids)) or set(ids) != {
                line.source_transfer_id for line in self.lines
            }:
                raise ValueError("每个来源批次都必须指定一个投料去向")
            if len({group.target.schedule_id for group in self.feeding_assignments}) != len(
                self.feeding_assignments
            ):
                raise ValueError("投给同一排期的来源批次须合为一单")
            if any(row.source_transfer_id not in ids for row in self.quantity_clearances):
                raise ValueError("清零批次必须属于本次转料")
        if self.feeding_targets:
            if self.feeding_target:
                raise ValueError("请只填写一种投料排期")
            if len({item.serial_no.casefold() for item in self.feeding_targets}) != len(
                self.feeding_targets
            ):
                raise ValueError("共投流水号不能重复")
        if (self.feeding_target or self.feeding_targets or self.feeding_assignments) and (
            self.entry_kind != "transfer"
            or self.rework_return
            or self.quantity_adjustments
            or any(
                line.shared_serials
                or line.serial_no
                or line.production_schedule_id
                or line.production_schedule_batch_id
                or line.process_route_id
                or line.process_route_version
                for line in self.lines
            )
        ):
            raise ValueError("库房投料请在整单上选择目标流水号和加工排期")
        if self.inventory_total is not None:
            if (
                self.entry_kind != "inspection_shipment"
                or self.lines
                or self.quantity_adjustments
                or self.quantity_clearances
                or self.rework_return
            ):
                raise ValueError("汇总发货仅用于检验班组，不能同时填写逐批明细")
        elif not self.lines:
            raise ValueError("请选择来源批次")
        if any(
            item.outputs is not None or item.processing_mode == "unit"
            for item in self.quantity_adjustments
        ):
            raise ValueError("请先保存加工明细，再选择加工后的批次出库")
        if not self.idempotency_key.strip():
            raise ValueError("idempotency_key cannot be blank")
        if self.entry_kind == "transfer":
            if (
                self.next_team_id is None and not self.feeding_assignments
            ) or self.external_destination is not None:
                raise ValueError(
                    "internal transfers require next_team_id and no external_destination"
                )
        else:
            if self.next_team_id is not None or not (self.external_destination or "").strip():
                raise ValueError(
                    "external outbound requires external_destination and no next_team_id"
                )
            self.external_destination = self.external_destination.strip()
            if self.external_destination not in EXTERNAL_DESTINATIONS:
                raise ValueError("出库去向只能选择：" + "、".join(EXTERNAL_DESTINATIONS))
        return self


def require_actor(user, team_id):
    from .auth import can_manage_team

    if not can_manage_team(user, team_id):
        raise HTTPException(403, "only the current team's leader may change its stock")


def actor_team(db, user, team_id):
    require_actor(user, team_id)
    if team_id is None:
        raise HTTPException(422, "请选择操作班组")
    team = require_team(db, team_id)
    if not team.active:
        raise HTTPException(403, "班组已停用")
    return team


def require_outbound_actor(user, team_id, entry_kind, *, team=None):
    require_actor(user, team_id)
    source = team if team is not None else user.team
    if entry_kind not in EXTERNAL_ENTRY_KINDS or entry_kind not in outbound_kinds(source):
        raise HTTPException(
            403, "only the bound warehouse or inspection team may confirm its own outbound kind"
        )
    return source


def fingerprint(payload):
    value = payload.model_dump(mode="json", exclude={"idempotency_key"}, exclude_unset=True)
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()


def _replay(record, user, request_hash, owner_field, team_id=None):
    if team_id is not None and getattr(record, owner_field) != team_id:
        raise HTTPException(409, "提交标识已用于其他班组，请重新提交")
    if user.role != "ADMIN" and getattr(record, owner_field) != user.team_id:
        raise HTTPException(403, "idempotency key belongs to another team")
    if record.request_hash != request_hash:
        raise HTTPException(409, "idempotency key was used with a different payload")


def lock_lot(db, transfer_id, team_id=None):
    lot = db.scalar(
        select(MaterialTransfer)
        .options(lazyload("*"))
        .where(MaterialTransfer.id == transfer_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if lot is None:
        raise HTTPException(404, "source material batch not found")
    if team_id is not None and lot.next_team_id != team_id:
        raise HTTPException(403, "source batch was not received by the current team")
    if lot.status != "received" or not lot.stock_tracked:
        raise HTTPException(409, "source batch must be received and tracked before changing stock")
    return lot


def available_locked(db, lot, exclude_transfer_id=None):
    balance = db.execute(
        select(MaterialStockBalance.on_hand_quantity, MaterialStockBalance.on_hand_weight)
        .where(MaterialStockBalance.transfer_id == lot.id)
        .with_for_update()
    ).one_or_none()
    if balance is None:
        raise HTTPException(409, "stock balance is missing; reconcile before changing stock")
    quantity, weight = balance
    if exclude_transfer_id is not None:
        prior = db.execute(
            select(MaterialTransfer.quantity, MaterialTransfer.weight)
            .where(
                MaterialTransfer.id == exclude_transfer_id,
                MaterialTransfer.source_transfer_id == lot.id,
                MaterialTransfer.status.in_(["pending", "received", "dispatched"]),
            )
            .with_for_update()
        ).one_or_none()
        if prior is not None:
            quantity, weight = quantity + prior.quantity, weight + prior.weight
    return quantity, weight


def require_unallocated_source(db, lot, available):
    if (
        available[0] <= 0
        and available[1] <= 0
        and db.scalar(
            select(MaterialTransfer.id)
            .where(
                MaterialTransfer.source_transfer_id == lot.id,
                MaterialTransfer.entry_kind == "processing_output",
            )
            .limit(1)
        )
        is not None
    ):
        raise HTTPException(409, "本批已分解为加工明细，请重新选择剩余大料或加工后小料批次")


def validate_available(db, lot, quantity, weight, exclude_transfer_id=None):
    available_quantity, available_weight = available_locked(db, lot, exclude_transfer_id)
    if weight > available_weight:
        raise HTTPException(
            409,
            f"本次提交超过上一批次的剩余可转重量，请调整重量或重新选择批次。（上一批次 {lot.batch_no}，剩余 {available_weight} kg）",
        )
    if quantity > available_quantity:
        raise HTTPException(
            409, "insufficient available stock; refresh the batch balance and review amounts"
        )
    return available_quantity, available_weight


def _db_conflict(exc):
    from .observability import record

    code = getattr(exc.orig, "args", (None,))[0]
    record(
        "stock.database_conflict", error=exc, database_code=code if isinstance(code, int) else None
    )
    if isinstance(exc, OperationalError) and getattr(exc.orig, "args", (None,))[0] not in (
        1205,
        1213,
    ):
        raise exc
    raise HTTPException(
        409, "stock changed concurrently; retry with the same idempotency key"
    ) from exc


def create_loss(db, team_id, payload, user):
    require_actor(user, team_id)
    request_hash = fingerprint(payload)
    try:
        with db.begin():
            prior = db.scalar(
                select(MaterialLoss).where(MaterialLoss.idempotency_key == payload.idempotency_key)
            )
            if prior is not None:
                _replay(prior, user, request_hash, "team_id", team_id)
                return workflow.material_loss_dict(prior)
        # The business transaction's first consistent read must follow the lot
        # lock. It then sees a preceding same-key writer without FOR UPDATE on a
        # missing unique key (which gap-locks unrelated new keys in MySQL).
        with db.begin():
            lot = lock_lot(db, payload.source_transfer_id, team_id)
            prior = db.scalar(
                select(MaterialLoss)
                .where(MaterialLoss.idempotency_key == payload.idempotency_key)
                .execution_options(populate_existing=True)
            )
            if prior is not None:
                _replay(prior, user, request_hash, "team_id", team_id)
                return workflow.material_loss_dict(prior)
            validate_material_amounts(lot.material_type, payload.quantity, payload.weight)
            validate_available(db, lot, payload.quantity, payload.weight)
            loss = MaterialLoss(
                loss_no="LS" + uuid4().hex[:24].upper(),
                source_transfer_id=lot.id,
                team_id=team_id,
                quantity=payload.quantity,
                weight=payload.weight,
                reason=payload.reason,
                idempotency_key=payload.idempotency_key,
                request_hash=request_hash,
                created_by=actor_name(user),
                created_by_user_id=user.id,
            )
            db.add(loss)
            db.flush()
            db.refresh(loss, attribute_names=["created_at"])
            result = workflow.material_loss_dict(loss)
        return result
    except (IntegrityError, OperationalError) as exc:
        db.rollback()
        prior = db.scalar(
            select(MaterialLoss).where(MaterialLoss.idempotency_key == payload.idempotency_key)
        )
        if prior is not None:
            _replay(prior, user, request_hash, "team_id", team_id)
            return workflow.material_loss_dict(prior)
        _db_conflict(exc)


def create_separate_feeding(db, team_id, payload, user):
    # Each destination has a real dispatch header. All headers and deductions
    # belong to the same transaction and the same idempotent submission.
    request_hash = fingerprint(payload)
    groups = sorted(payload.feeding_assignments, key=lambda group: group.target.schedule_id)
    with db.begin():
        if actor_team(db, user, team_id).code != WAREHOUSE_TEAM_CODE:
            raise HTTPException(422, "仅库房可以分别投料")
    with db.begin():
        source_serials = {}
        for lot_id in sorted({line.source_transfer_id for line in payload.lines}):
            lot = lock_lot(db, lot_id, team_id)
            source_serials[lot_id] = lot.serial_no.casefold() if lot.serial_no else lot.id
        seen_serials = set()
        items = []
        for index, group in enumerate(groups):
            ids = set(group.source_transfer_ids)
            serials = {source_serials[lot_id] for lot_id in ids}
            if seen_serials & serials:
                raise HTTPException(422, "同一来源流水号投给多个目标时，请使用共投")
            seen_serials.update(serials)
            key = (
                payload.idempotency_key
                if index == 0
                else "feeding:"
                + hashlib.sha256(
                    f"{payload.idempotency_key}:{group.target.schedule_id}".encode()
                ).hexdigest()
            )
            document = payload.model_copy(
                update={
                    "feeding_assignments": None,
                    "feeding_target": group.target,
                    "next_team_id": group.next_team_id,
                    "idempotency_key": key,
                    "lines": [line for line in payload.lines if line.source_transfer_id in ids],
                    "quantity_clearances": [
                        row for row in payload.quantity_clearances if row.source_transfer_id in ids
                    ],
                }
            )
            rows = create_dispatch(db, team_id, document, user, submission_hash=request_hash)
            items.extend(rows["items"])
        return {"items": items}


def create_dispatch(db, team_id, payload, user, *, submission_hash=None):
    from .quantity_adjustments import (
        latest_records,
        record_outbound_clearance,
        record_quantity_change,
        validate_outbound_clearance,
    )
    from .team_business import purpose_snapshot

    require_actor(user, team_id)
    if payload.feeding_assignments:
        try:
            return create_separate_feeding(db, team_id, payload, user)
        except (IntegrityError, OperationalError) as exc:
            _db_conflict(exc)
    external = payload.entry_kind in EXTERNAL_ENTRY_KINDS
    request_hash = submission_hash or fingerprint(payload)
    transaction = nullcontext if submission_hash else db.begin
    try:
        with transaction():
            source = actor_team(db, user, team_id)
            if external:
                require_outbound_actor(user, team_id, payload.entry_kind, team=source)
            prior = db.scalar(
                select(MaterialDispatch).where(
                    MaterialDispatch.idempotency_key == payload.idempotency_key
                )
            )
            if prior is not None:
                _replay(prior, user, request_hash, "source_team_id", team_id)
                return dispatch_dict(db, prior, user)
        # Close the preflight snapshot before waiting for source locks. The
        # recheck below is a fresh snapshot; a missing key must not gap-lock
        # independent submissions. The unique constraint remains the arbiter.
        with transaction():
            # Deterministic lock order also covers a multi-lot submission.
            if payload.inventory_total is not None:
                from .inventory_shipments import candidates

                shipment_rows = candidates(db, team_id, payload.inventory_total.group_id)
                source_ids = {row["id"] for row in shipment_rows}
            else:
                source_ids = {line.source_transfer_id for line in payload.lines}
            lots = {source_id: lock_lot(db, source_id, team_id) for source_id in sorted(source_ids)}
            prior = db.scalar(
                select(MaterialDispatch)
                .where(MaterialDispatch.idempotency_key == payload.idempotency_key)
                .execution_options(populate_existing=True)
            )
            if prior is not None:
                _replay(prior, user, request_hash, "source_team_id", team_id)
                return dispatch_dict(db, prior, user)
            if payload.inventory_total is not None:
                from .inventory_shipments import allocate, snapshot

                # Locking/current reads detect another dispatch or a processing write.
                current_rows = []
                for row in shipment_rows:
                    balance = db.scalar(
                        select(MaterialStockBalance)
                        .where(MaterialStockBalance.transfer_id == row["id"])
                        .with_for_update()
                        .execution_options(populate_existing=True)
                    )
                    current_rows.append(
                        {
                            **row,
                            "quantity": balance.on_hand_quantity,
                            "weight": balance.on_hand_weight,
                            "revision": balance.revision,
                        }
                    )
                if snapshot(current_rows) != payload.inventory_total.revision:
                    raise HTTPException(409, "库存已变化，请刷新可发库存后重新确认")
                allocated = [
                    DispatchLine(**line) for line in allocate(current_rows, payload.inventory_total)
                ]
                payload = payload.model_copy(update={"lines": allocated})
                lots = {
                    line.source_transfer_id: lots[line.source_transfer_id] for line in allocated
                }
            from .inspections import require_clear_lots

            require_clear_lots(db, lots.values())
            employee = workflow.require_team_employee(
                db, source.id, payload.sent_employee_id, "转料人"
            )
            target = None if external else workflow._active_target(db, payload.next_team_id)
            if target is not None and target.id == source.id:
                raise HTTPException(422, "source and target teams must be different")
            feeding_plan = feeding_cursor = None
            feeding_fields = {}
            joint_members = joint_plans = None
            if payload.feeding_target or payload.feeding_targets:
                if source.code != WAREHOUSE_TEAM_CODE:
                    raise HTTPException(422, "仅库房内部转料可以按目标排期投料")
                if any(
                    lot.shared_unallocated
                    or lot.rework_route_id
                    or lot.rework_pending
                    or lot.material_type in SCRAP_MATERIAL_TYPES
                    or (lot.process_route_id and not lot.process_step_complete)
                    for lot in lots.values()
                ):
                    raise HTTPException(
                        422, "废料、未分配共投料或工序未完成的库存不能按目标排期投料"
                    )
                if payload.feeding_targets:
                    if any(lot.receipt_kind == "return" for lot in lots.values()):
                        raise HTTPException(422, "退回库存不能共投")
                    feeding_cursor, joint_members, joint_plans = warehouse_feeding.prepare_joint(
                        db, source, target, payload.feeding_targets, lots.values()
                    )
                    feeding_fields = dict.fromkeys(warehouse_feeding.ORDER_FIELDS)
                else:
                    feeding_plan, feeding_cursor, feeding_fields = warehouse_feeding.prepare(
                        db, source, target, payload.feeding_target, lots.values()
                    )
            clearances = {item.source_transfer_id: item for item in payload.quantity_clearances}
            if (
                len(clearances) != len(payload.quantity_clearances)
                or clearances.keys() - lots.keys()
            ):
                raise HTTPException(422, "每个来源批次只能填写一次清零原因，且必须属于本次出库")
            adjustments = {item.source_transfer_id: item for item in payload.quantity_adjustments}
            if (
                len(adjustments) != len(payload.quantity_adjustments)
                or adjustments.keys() - lots.keys()
            ):
                raise HTTPException(422, "每个来源批次只能登记一次加工件数，且必须属于本次出库")
            for source_id, adjustment in adjustments.items():
                record_quantity_change(
                    db,
                    lots[source_id],
                    adjustment,
                    user,
                    "dispatch-count:"
                    + hashlib.sha256(f"{payload.idempotency_key}:{source_id}".encode()).hexdigest(),
                    fingerprint(adjustment),
                )
            stock_after = {}
            withdrawals = {}
            for source_id, lot in lots.items():
                portions = [line for line in payload.lines if line.source_transfer_id == source_id]
                quantity, weight = (
                    sum(line.quantity for line in portions),
                    sum((line.weight for line in portions), Decimal(0)),
                )
                withdrawals[source_id] = (quantity, weight)
                available = available_locked(db, lot)
                require_unallocated_source(db, lot, available)
                validate_outbound_clearance(
                    lot, quantity, weight, available, clearances.get(source_id)
                )
                stock_after[source_id] = (
                    available[0]
                    - quantity
                    - (clearances[source_id].quantity if source_id in clearances else 0),
                    available[1] - weight,
                )
            for line in payload.lines:
                lot = lots[line.source_transfer_id]
                kind = (
                    line.material_type
                    if "material_type" in line.model_fields_set
                    else lot.material_type
                )
                validate_material_amounts(kind, line.quantity, line.weight)
                sludge_measurement(
                    kind,
                    line.weight,
                    line.sludge_gross_weight,
                    line.sludge_content_percent,
                    source=lot,
                )
                if source.code == WAREHOUSE_TEAM_CODE and kind != lot.material_type:
                    raise HTTPException(422, "库房按原物料转出，不能更改物料类型")
                if external and lot.shared_unallocated and kind not in SCRAP_MATERIAL_TYPES:
                    raise HTTPException(
                        422, "共投料尚未分配流水号，请先登记加工分配，再对外出库或发货"
                    )
                workflow.validate_material_route(
                    lot.material_type, kind, target, payload.entry_kind, payload.notes
                )
                if target is not None:
                    workflow._validate_warehouse_type(target, kind)
            destination = {
                "next_team_id": target.id if target else None,
                "next_team_code": target.code if target else None,
                "next_team_name": target.name if target else None,
                "entry_kind": payload.entry_kind,
                "external_destination": payload.external_destination,
            }
            # The target team lock also protects its purpose configuration.
            from .models import ProcessRoutePolicy
            from .process_routes import dispatch_fields

            policy = db.get(ProcessRoutePolicy, 1)
            route_fields_by_line, purposes = [], []
            purpose_cache = {}
            route_cache = {}
            for line in payload.lines:
                lot = lots[line.source_transfer_id]
                kind = (
                    line.material_type
                    if "material_type" in line.model_fields_set
                    else lot.material_type
                )
                from .process_routes import prepare_dispatch_route

                serial = line.serial_no if line.serial_no is not None else lot.serial_no
                if line.serial_no is not None and lot.serial_no and serial != lot.serial_no:
                    raise HTTPException(422, "出库流水号不能与原批次不一致")
                anonymous = not lot.serial_no and not lot.shared_unallocated
                if (
                    anonymous
                    and lot.material_type not in SCRAP_MATERIAL_TYPES
                    and (source.code != WAREHOUSE_TEAM_CODE or lot.process_route_id)
                ):
                    raise HTTPException(422, "仅未分配流水号的库房来料可在出库时填写流水号")
                route_lot = lot
                if feeding_cursor:
                    serial = feeding_plan.serial_no if feeding_plan else ""
                    route_lot = feeding_cursor
                elif line.shared_serials:
                    from .shared_material import prepare_dispatch

                    route_lot = prepare_dispatch(
                        db, lot, line, source, target, kind, payload.rework_return
                    )
                elif kind not in SCRAP_MATERIAL_TYPES:
                    route_lot = prepare_dispatch_route(
                        db, lot, line, source, serial, anonymous, user
                    )
                route_key = (
                    lot.id,
                    kind,
                    serial,
                    route_lot.process_route_id,
                    bool(joint_members or line.shared_serials),
                )
                if route_key not in route_cache:
                    route_cache[route_key] = dispatch_fields(
                        db, route_lot, target, kind, payload.rework_return, policy
                    )
                fields = route_cache[route_key]
                purpose_id = line.purpose_id
                if fields and target:
                    selected_route = (
                        db.get(ProcessRoute, fields["process_route_id"])
                        if fields.get("process_route_id")
                        else None
                    )
                    step = (
                        selected_route.steps[fields["process_step_index"]]
                        if selected_route
                        else {"purpose_id": purpose_id}
                    )
                    if selected_route and route_lot.shared_unallocated:
                        from .shared_material import execution_step

                        step = execution_step(route_lot, fields["process_step_index"])
                    if step["purpose_id"] is not None:
                        if purpose_id is not None and purpose_id != step["purpose_id"]:
                            raise HTTPException(422, "下序接收业务必须与已发布工艺一致")
                        purpose_id = step["purpose_id"]
                route_fields_by_line.append(fields)
                if purpose_id not in purpose_cache:
                    purpose_cache[purpose_id] = purpose_snapshot(
                        db, target.id if target else None, purpose_id, required=False
                    )
                purposes.append(purpose_cache[purpose_id])
            pooled = bool(feeding_cursor and len(payload.lines) > 1)
            processing = latest_records(db, lots)
            output_lines = payload.lines[:1] if pooled else payload.lines
            if pooled:
                warehouse_feeding.require_matching_materials(payload.lines, lots, processing)
            batch_numbers = next_transfer_batch_numbers(db, len(output_lines))
            submitted_at = utcnow()
            # External exits are final at submission; only internal handoffs wait for receipt.
            completion = (
                {
                    "status": "dispatched",
                    "dispatched_by": actor_name(user),
                    "dispatched_by_user_id": user.id,
                    "dispatched_at": submitted_at,
                    "created_at": submitted_at,
                    "updated_at": submitted_at,
                }
                if external
                else {"status": "pending"}
            )
            dispatch = MaterialDispatch(
                dispatch_no=None,
                source_team_id=source.id,
                **destination,
                notes=payload.notes,
                idempotency_key=payload.idempotency_key,
                request_hash=request_hash,
                created_by=actor_name(user),
                created_by_user_id=user.id,
            )
            db.add(dispatch)
            db.flush()
            items = []
            consumed_locations = {}
            location_names = []
            # Consume every lease before staging transfers. A partial location
            # flush must not run placement hooks against transfers without IDs.
            for line in payload.lines:
                from .warehouse_locations import consume

                lot = lots[line.source_transfer_id]
                kind = (
                    line.material_type
                    if "material_type" in line.model_fields_set
                    else lot.material_type
                )
                location_name = consume(
                    db,
                    target,
                    line,
                    user,
                    identity=(
                        feeding_plan.serial_no if feeding_plan else line.serial_no or lot.serial_no,
                        lot.material_name,
                        kind,
                    ),
                    consumed=consumed_locations,
                    required=True,
                )
                location_names.append(location_name)
            for line_index, (line, batch_no) in enumerate(
                zip(output_lines, batch_numbers, strict=True)
            ):
                lot = lots[line.source_transfer_id]
                kind = (
                    line.material_type
                    if "material_type" in line.model_fields_set
                    else lot.material_type
                )
                location_name = location_names[line_index]
                fields = {field: getattr(lot, field) for field in workflow.DOCUMENT_FIELDS}
                if feeding_cursor:
                    fields.update(feeding_fields)
                elif (
                    not lot.serial_no
                    and not (joint_members or line.shared_serials)
                    and route_fields_by_line[line_index].get("process_route_id")
                ):
                    bound_route = db.get(
                        ProcessRoute, route_fields_by_line[line_index]["process_route_id"]
                    )
                    for field, value in bound_route.source_data.get("receipt_fields", {}).items():
                        if field in fields and field not in {
                            "material_type",
                            "transfer_specification",
                            "delivery_date",
                            "delivery_quantity",
                        }:
                            fields[field] = value["value"] or None

                record = processing.get(lot.id)
                if record and record.after_specification is not None:
                    fields["transfer_specification"] = record.after_specification or None
                if "transfer_specification" in line.model_fields_set:
                    fields["transfer_specification"] = line.transfer_specification or None
                # A split inherits its origin's live requirement, never a second planned quantity.
                fields.update(delivery_date=None, delivery_quantity=None)
                if "material_type" in line.model_fields_set:
                    fields["material_type"] = line.material_type
                from .processing_registration import sent_status

                route_fields = route_fields_by_line[line_index]
                group = None if feeding_cursor else lot.shared_group
                members = joint_members or line.shared_serials
                if members:
                    from .shared_material import create_group

                    group = create_group(db, batch_no, members, feeding_plans=joint_plans)
                    fields.update(
                        customer_code=None, finished_specification=None, finished_quantity=None
                    )
                serial = feeding_plan.serial_no if feeding_plan else line.serial_no or lot.serial_no
                processing_plan_id = feeding_plan.id if feeding_plan else None
                if lot.rework_route_id:
                    processing_plan_id = (
                        lot.processing_schedule_id or lot.rework_route.original_schedule_id
                    )
                transfer = MaterialTransfer(
                    **route_fields,
                    process_route=db.get(ProcessRoute, route_fields["process_route_id"])
                    if route_fields.get("process_route_id")
                    else None,
                    sent_process_step_index=(
                        0
                        if feeding_cursor or members or not lot.serial_no
                        else lot.process_step_index
                    )
                    if route_fields and not payload.rework_return and not lot.rework_pending
                    else None,
                    sent_processing_status=sent_status(lot, record),
                    rework_pending=bool(route_fields.get("rework_route_id"))
                    and not route_fields.get("process_step_complete", False),
                    processing_schedule_id=processing_plan_id,
                    rework_count=lot.rework_count,
                    batch_no=batch_no,
                    serial_no=f"共投-{batch_no}" if members else serial,
                    **fields,
                    **purposes[line_index],
                    shared_group=group,
                    shared_unallocated=bool(members) or lot.shared_unallocated,
                    source_transfer_id=lot.id,
                    dispatch_id=dispatch.id,
                    delivery_origin_id=None if feeding_cursor else lot.delivery_origin_id or lot.id,
                    source_team_id=source.id,
                    source_team_code=source.code,
                    source_team_name=source.name,
                    **destination,
                    quantity=sum(q for q, _ in withdrawals.values()) if pooled else line.quantity,
                    weight=sum(w for _, w in withdrawals.values()) if pooled else line.weight,
                    pooled_feeding=pooled,
                    **completion,
                    notes=payload.notes,
                    sludge_gross_weight=line.sludge_gross_weight,
                    sludge_content_percent=line.sludge_content_percent,
                    warehouse_location=location_name,
                    sent_employee_id=employee.id,
                    sent_employee_name=employee.name,
                    created_by=actor_name(user),
                    created_by_user_id=user.id,
                    history=[],
                )
                if pooled:
                    transfer.feeding_sources = [
                        WarehouseFeedingSource(source=lots[key], quantity=q, weight=w)
                        for key, (q, w) in withdrawals.items()
                    ]
                    for key in ("source_batch_no", "material_shape", "material_description"):
                        if len({getattr(source_lot, key) for source_lot in lots.values()}) > 1:
                            setattr(transfer, key, None)
                    transfer.is_outsourced = any(
                        source_lot.is_outsourced for source_lot in lots.values()
                    )
                    units = {
                        source_lot.outsourced_unit
                        for source_lot in lots.values()
                        if source_lot.is_outsourced
                    }
                    transfer.outsourced_unit = units.pop() if len(units) == 1 else None
                db.add(transfer)
                items.append(transfer)
            # Flush the whole set so repeated sources receive one balance delta.
            db.flush()
            from .production_schedules import associate_dispatch

            if not feeding_cursor:
                associate_dispatch(db, team_id, payload, items)
            for source_id, clearance in clearances.items():
                record_outbound_clearance(
                    db,
                    lots[source_id],
                    clearance,
                    user,
                    f"dispatch:{dispatch.id}:{source_id}",
                    [
                        item.batch_no
                        for item in items
                        if pooled or item.source_transfer_id == source_id
                    ],
                )
            if clearances:
                db.flush()
            # Join in SQL so serial matching keeps the database's collation
            # (including MySQL's case/accent rules), not Python dict equality.
            persisted = {
                row.id: row
                for row in db.execute(
                    select(
                        MaterialTransfer.id,
                        MaterialTransfer.created_at,
                        MaterialTransfer.updated_at,
                        MaterialTransfer.dispatched_at,
                        SerialUrgency,
                    )
                    .select_from(MaterialTransfer)
                    .outerjoin(SerialUrgency, MaterialTransfer.serial_no == SerialUrgency.serial_no)
                    .where(MaterialTransfer.id.in_([item.id for item in items]))
                )
            }
            for transfer in items:
                # Keep database timestamp precision in both response and audit.
                for field in ("created_at", "updated_at", "dispatched_at"):
                    set_committed_value(transfer, field, getattr(persisted[transfer.id], field))
                for field, value in (
                    ("urgency", persisted[transfer.id].SerialUrgency),
                    ("stock_source", lots[transfer.source_transfer_id]),
                    ("dispatch", dispatch),
                    ("source_team", source),
                    ("next_team", target),
                ):
                    set_committed_value(transfer, field, value)
                workflow._record_event(
                    db,
                    transfer,
                    user,
                    "dispatched" if external else "created",
                    flush=False,
                    stock_after=stock_after[transfer.source_transfer_id],
                )
            db.flush()
            # These rows were just created in our transaction; only replays need
            # the locking reread in dispatch_dict to observe concurrent changes.
            result = dispatch_dict(db, dispatch, user, items=items)
        return result
    except (IntegrityError, OperationalError) as exc:
        if submission_hash:
            raise
        db.rollback()
        prior = db.scalar(
            select(MaterialDispatch).where(
                MaterialDispatch.idempotency_key == payload.idempotency_key
            )
        )
        if prior is not None:
            _replay(prior, user, request_hash, "source_team_id", team_id)
            return dispatch_dict(db, prior, user)
        _db_conflict(exc)
