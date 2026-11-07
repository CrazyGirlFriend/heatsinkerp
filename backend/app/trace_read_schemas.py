"""Serial lookup and trace projections, including shared-lot provenance."""

from datetime import datetime
from typing import Literal

from .analytics_read_schemas import AmountResponse
from .process_route_read_schemas import RouteStepResponse
from .processing_read_schemas import QuantityAdjustmentResponse
from .read_schemas import ReadResponse
from .schemas import MaterialTransferResponse


class MaterialSuggestionDetailsResponse(ReadResponse):
    material_name: str | None = None
    finished_specification: str | None = None
    customer_code: str | None = None
    product_code: str | None = None
    part_no: str | None = None
    technical_requirements: str | None = None


class MaterialSuggestionResponse(ReadResponse):
    value: str
    details: MaterialSuggestionDetailsResponse
    source_batch_no: str


class MaterialSuggestionsResponse(ReadResponse):
    items: list[MaterialSuggestionResponse]


class SerialInventoryRowResponse(ReadResponse):
    team_id: int
    team_name: str
    material_name: str
    material_type: str
    shared_unallocated: bool
    stock_quantity: int
    stock_weight: float
    incoming_quantity: int
    incoming_weight: float


class SerialInventoryResponse(ReadResponse):
    serial_no: str
    items: list[SerialInventoryRowResponse]
    untracked_count: int
    as_of: str


class SerialInventoryBatchResponse(AmountResponse):
    id: int
    batch_no: str
    material_name: str
    material_type: str
    shared_unallocated: bool
    transfer_specification: str | None
    rework_pending: bool
    rework_count: int
    team_id: int
    location: Literal["stock", "incoming"]
    inspection_hold_id: int | None


class TraceSiblingOutputResponse(AmountResponse):
    batch_no: str
    serial_no: str | None
    at: datetime


class TraceBatchResponse(MaterialTransferResponse):
    sent_process_step_index: int | None
    on_hand_quantity: int | None
    on_hand_weight: float | None
    owned_quantity: int | None
    owned_weight: float | None
    processing_delta_weight: float
    weight_root_transfer_id: int | None = None
    weight_difference: float | None = None
    other_processing_outputs: list[TraceSiblingOutputResponse]
    context_only: bool
    inspection_hold_id: int | None
    inspection_status: Literal["held", "failed", "passed"] | None
    inspection_scope: Literal["sample", "full"] | None
    inspection_sample_quantity: int | None
    inspection_failed_quantity: int | None
    inspection_source_batch_no: str | None
    inspection_checked_at: datetime | None
    inspection_inspector: str | None


class TraceRouteResponse(ReadResponse):
    id: int
    route_kind: Literal["normal", "rework"]
    steps: list[RouteStepResponse]


class TraceTotalsResponse(ReadResponse):
    on_hand: AmountResponse
    in_transit: AmountResponse
    external_pending: AmountResponse
    dispatched: AmountResponse
    lost: AmountResponse


class TraceSharedPositionResponse(AmountResponse):
    team_id: int
    team_name: str
    origin_batch_no: str
    material_type: str | None
    serials: list[str]


class TracePositionResponse(AmountResponse):
    team_id: int
    team_name: str
    batch_count: int


class TraceMaterialHoldingResponse(AmountResponse):
    material_type: str | None


class TraceHoldingResponse(ReadResponse):
    team_id: int
    team_code: str
    team_name: str
    material_types: list[TraceMaterialHoldingResponse]


class MaterialTraceResponse(ReadResponse):
    serial_no: str
    query_kind: Literal["serial", "batch", "shared"]
    focus_batch_id: int | None
    items: list[TraceBatchResponse]
    process_routes: list[TraceRouteResponse]
    processing_records: list[QuantityAdjustmentResponse]
    processing_delta_weight: float
    weight_difference: float
    max_weight_difference: float
    reallocations: list[MaterialTransferResponse]
    shortage: AmountResponse
    observed_at: str
    totals: TraceTotalsResponse
    shared_totals: TraceTotalsResponse
    shared_positions: list[TraceSharedPositionResponse]
    shared_group_view: bool
    positions: list[TracePositionResponse]
    holdings: list[TraceHoldingResponse]
    untracked_count: int
