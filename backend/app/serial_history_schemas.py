"""Read contracts for team-local receipt, processing and dispatch history."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict


class HistoryResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")


class HistoryMaterial(HistoryResponse):
    entry_kind: str
    processing_role: str | None
    material_type: str | None
    transfer_specification: str | None


class SerialHistoryEvent(HistoryMaterial):
    id: str
    at: str
    kind: Literal[
        "incoming",
        "opening",
        "outgoing",
        "adjusted",
        "voided",
        "loss",
        "quantity_changed",
        "processing_input",
        "processing_output",
    ]
    batch_no: str
    source_batch_no: str
    source_material_type: str | None
    counterpart: str | None
    quantity: int
    weight: float
    delta_quantity: int
    delta_weight: float
    balance_quantity: int
    balance_weight: float
    status: str


class SerialHistoryGroup(HistoryResponse):
    key: str
    purpose_id: int | None
    name: str
    incoming_quantity: int
    incoming_weight: float
    outgoing_quantity: int
    outgoing_weight: float
    lost_quantity: int
    lost_weight: float
    on_hand_quantity: int
    on_hand_weight: float
    owned_quantity: int
    owned_weight: float
    processing_delta_quantity: int
    processing_delta_weight: float
    baseline_quantity: int
    baseline_weight: float
    events: list[SerialHistoryEvent]


class SerialHistoryLot(HistoryMaterial):
    batch_no: str
    group_key: str
    received_at: str
    from_name: str
    source_batch_no: str | None
    quantity: int
    weight: float
    on_hand_quantity: int
    on_hand_weight: float
    owned_quantity: int
    owned_weight: float
    baseline_quantity: int
    baseline_weight: float
    closing_quantity: int
    closing_weight: float
    last_event_at: str


class SerialHistoryFlow(HistoryResponse):
    id: str
    group_key: str
    direction: Literal["incoming", "outgoing"]
    batch_no: str
    at: str
    from_name: str
    to_name: str
    quantity: int
    weight: float
    status: str
    entry_kind: str


class SerialHistory(HistoryResponse):
    serial_no: str
    team_name: str
    flows: list[SerialHistoryFlow]
    observed_at: str
    closing_at: str
    lots: list[SerialHistoryLot]
    found: bool
    date_from: date | None
    date_to: date | None
    groups: list[SerialHistoryGroup]
    untracked_count: int
    pending_incoming_count: int
