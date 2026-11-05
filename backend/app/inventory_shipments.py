"""Inspection shipment totals, allocated under the ordinary dispatch transaction."""

import hashlib
from decimal import Decimal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import or_, select

from .models import MaterialStockBalance, MaterialTransfer
from .schemas import SCRAP_MATERIAL_TYPES


class ShipmentTotal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    group_id: int = Field(ge=1)
    revision: str = Field(pattern="^[a-f0-9]{64}$")
    quantity: int = Field(ge=0, le=2_147_483_647)
    weight: Decimal = Field(ge=0, max_digits=17, decimal_places=6)

    @model_validator(mode="after")
    def nonempty(self):
        if not self.quantity and not self.weight:
            raise ValueError("请填写发货件数或重量")
        return self


def candidates(db, team_id, group_id):
    from .inspections import hold_column

    mt, balance = MaterialTransfer, MaterialStockBalance
    anchor = db.scalar(
        select(mt).where(
            mt.id == group_id,
            mt.next_team_id == team_id,
            mt.status == "received",
            mt.stock_tracked.is_(True),
        )
    )
    if anchor is None:
        raise HTTPException(404, "未找到本班组库存")
    # Pool like material across upstream batches, without mixing serials or specifications.
    identity = ["serial_no", "material_name", "material_type", "transfer_specification"]
    return list(
        db.execute(
            select(
                mt.id,
                mt.batch_no,
                mt.received_at,
                balance.on_hand_quantity.label("quantity"),
                balance.on_hand_weight.label("weight"),
                balance.revision,
            )
            .join(balance, balance.transfer_id == mt.id)
            .where(
                mt.next_team_id == team_id,
                mt.status == "received",
                mt.stock_tracked.is_(True),
                *(getattr(mt, key).is_not_distinct_from(getattr(anchor, key)) for key in identity),
                mt.material_type.not_in(SCRAP_MATERIAL_TYPES),
                mt.shared_unallocated.is_(False),
                mt.rework_pending.is_(False),
                hold_column(mt.id).is_(None),
                or_(mt.process_route_id.is_(None), mt.process_step_complete.is_(True)),
                or_(balance.on_hand_quantity > 0, balance.on_hand_weight > 0),
            )
            .order_by(mt.received_at, mt.id)
        ).mappings()
    )


def snapshot(rows):
    value = [(r["id"], r["revision"], r["quantity"], str(r["weight"])) for r in rows]
    return hashlib.sha256(repr(value).encode()).hexdigest()


def preview(db, team_id, group_id, user):
    from .material_stock import require_outbound_actor

    require_outbound_actor(user, team_id, "inspection_shipment")
    rows = candidates(db, team_id, group_id)
    return {
        "revision": snapshot(rows),
        "quantity": sum(max(0, row["quantity"]) for row in rows),
        "weight": float(sum((max(Decimal(0), row["weight"]) for row in rows), Decimal(0))),
        "items": [
            {
                "id": row["id"],
                "batch_no": row["batch_no"],
                "quantity": max(0, row["quantity"]),
                "weight": float(max(Decimal(0), row["weight"])),
            }
            for row in rows
        ],
    }


def allocate(rows, total):
    """FIFO for each independently measured amount; no rounding or invented loss."""
    if total.quantity > sum(max(0, r["quantity"]) for r in rows) or total.weight > sum(
        (max(Decimal(0), r["weight"]) for r in rows), Decimal(0)
    ):
        raise HTTPException(409, "发货量超过可发库存，请刷新后核对")
    quantity, weight, lines = total.quantity, total.weight, []
    for row in rows:
        q, w = min(quantity, max(0, row["quantity"])), min(weight, max(Decimal(0), row["weight"]))
        if q or w:
            lines.append({"source_transfer_id": row["id"], "quantity": q, "weight": w})
            quantity, weight = quantity - q, weight - w
    if len(lines) > 100:
        raise HTTPException(422, "单次发货涉及超过 100 个来源批次，请分次提交")
    return lines
