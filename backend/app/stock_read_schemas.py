"""Physical lot selection, balances and inventory operations read contracts."""

from datetime import date, datetime
from typing import Literal

from .analytics_read_schemas import AmountResponse, StockProcessingResponse
from .read_schemas import PageResponse, ReadResponse, StockBalanceResponse
from .schemas import MaterialTransferResponse
from .serial_urgency_schemas import UrgencyResponse

ProcessingState = Literal[
    "registered",
    "partial",
    "complete",
    "unregistered",
    "rework",
    "pending",
    "cleared",
    "not_applicable",
]


class StockPositionResponse(AmountResponse):
    location_id: int
    name: str


class StockBatchResponse(StockBalanceResponse):
    transfer: MaterialTransferResponse
    inspection_hold_id: int | None
    processing_state: ProcessingState
    current_specification: str | None
    weight_root_transfer_id: int | None = None
    weight_difference: float | None = None
    sludge_available_gross_weight: float | None = None
    warehouse_positions: list[StockPositionResponse] | None = None
    physical_quantity: int | None = None
    physical_weight: float | None = None
    unassigned_quantity: int | None = None
    unassigned_weight: float | None = None


class StockPageResponse(PageResponse[StockBatchResponse]):
    as_of: str


class StockMovementsResponse(PageResponse[MaterialTransferResponse]):
    as_of: str


class MaterialBalanceResponse(StockBalanceResponse):
    material_name: str | None


class MaterialTypeBalanceResponse(StockBalanceResponse):
    material_type: str | None


class TeamPendingResponse(AmountResponse):
    count: int
    batch_count: int | None = None


class CurrentStockResponse(ReadResponse):
    serial_count: int
    unnumbered_batch_count: int
    processing: list[StockProcessingResponse]


class TeamWorkPeriodResponse(ReadResponse):
    key: Literal["today", "week", "month"]
    date_from: date
    date_to: date
    processed_count: int
    completed_count: int


class TeamWorkOrdersResponse(ReadResponse):
    mode: Literal["processing", "handling"]
    in_progress_count: int
    overdue_count: int | None
    periods: list[TeamWorkPeriodResponse]


class TeamMaterialOverviewResponse(ReadResponse):
    team_id: int
    as_of: str
    totals: StockBalanceResponse
    material_types: list[MaterialTypeBalanceResponse]
    materials: list[MaterialBalanceResponse]
    pending_incoming: TeamPendingResponse
    legacy_received_count: int
    current_stock: CurrentStockResponse | None = None
    work_orders: TeamWorkOrdersResponse | None = None


class MaterialLossResponse(AmountResponse):
    id: int
    loss_no: str
    team_id: int
    source_transfer_id: int
    batch_no: str
    serial_no: str | None
    material_name: str | None
    urgency: UrgencyResponse
    reason: str
    created_by: str
    created_at: datetime


class ShipmentStockItemResponse(AmountResponse):
    id: int
    batch_no: str


class ShipmentStockResponse(AmountResponse):
    revision: str
    items: list[ShipmentStockItemResponse]


class OpeningStockStateResponse(ReadResponse):
    enabled: bool
    completed: bool
    has_stock_history: bool
    can_submit: bool
    items: list[MaterialTransferResponse]


class OpeningStockResultResponse(ReadResponse):
    id: int
    count: int
    items: list[MaterialTransferResponse]
