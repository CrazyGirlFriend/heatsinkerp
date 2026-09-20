"""Explicit live-board contract shared by REST validation and SSE snapshots."""

from typing import Literal

from pydantic import BaseModel, ConfigDict


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Amount(Contract):
    quantity: int
    weight: float


class PendingAmount(Amount):
    batches: int


class ChartPoint(Amount):
    key: str


class MaterialBalance(Contract):
    received_quantity: int | None
    received_weight: float | None
    dispatched_quantity: int | None
    dispatched_weight: float | None
    reserved_quantity: int | None
    reserved_weight: float | None
    in_transit_quantity: int | None
    in_transit_weight: float | None
    lost_quantity: int | None
    lost_weight: float | None
    on_hand_quantity: int | None
    on_hand_weight: float | None
    available_quantity: int | None
    available_weight: float | None
    scrap_quantity: int | None
    scrap_weight: float | None
    scrap_available_quantity: int | None
    scrap_available_weight: float | None


class LiveTransfer(Amount):
    batch_no: str
    serial_no: str
    source_id: int | None
    target_id: int
    source_name: str | None
    updated_at: str


class LiveTeam(Contract):
    id: int | None
    code: str
    name: str
    active: bool
    balance: MaterialBalance | None
    serial_count: int | None
    urgent_serial_count: int | None
    pending_incoming: PendingAmount | None
    incoming: int | None
    outgoing: int | None
    pending_transfers: list[LiveTransfer]
    material_types: list[ChartPoint]


class LiveBatch(Amount):
    batch_no: str
    entry_kind: Literal[
        "transfer",
        "warehouse_receipt",
        "opening_stock",
        "warehouse_outbound",
        "inspection_shipment",
    ]
    status: Literal["pending", "received", "dispatched", "partial", "voided"]
    source_id: int | None
    target_id: int | None
    source_name: str | None
    target_name: str | None
    external_destination: str | None
    line_count: int
    urgent_serial_count: int
    serial_count: int
    material_count: int
    material_name: str | None
    waiting_since: str | None
    updated_at: str


class LiveLink(Contract):
    source_id: int
    target_id: int
    pending_batches: int
    confirmed_batches: int
    pending_quantity: int
    pending_weight: float


class Today(Contract):
    outgoing_quantity: int
    received_batches: int


class FactoryLiveResponse(Contract):
    as_of: str
    totals: MaterialBalance
    pending: PendingAmount
    legacy_received_count: int
    teams: list[LiveTeam]
    recent_batches: list[LiveBatch]
    links: list[LiveLink]
    material_stock: list[ChartPoint]
    material_types: list[ChartPoint]
    internal_pending: PendingAmount
    today: Today
