"""Shared chart amounts and factory stock projections."""

from typing import Literal

from .read_schemas import ReadResponse, StockBalanceResponse
from .serial_urgency_schemas import UrgencyResponse


class AmountResponse(ReadResponse):
    quantity: int
    weight: float


class ChartAmountResponse(AmountResponse):
    # Populated aggregates retain their bucket key; empty buckets have only amounts.
    key: str | None = None


class ChartPointResponse(AmountResponse):
    key: str
    label: str | None = None


class NamedAmountResponse(AmountResponse):
    name: str


class PendingAmountResponse(AmountResponse):
    batches: int


class StockProcessingResponse(AmountResponse):
    state: Literal[
        "unregistered",
        "partial",
        "complete",
        "rework",
        "registered",
        "not_required",
        "not_applicable",
    ]
    batch_count: int


class FactoryStockRowResponse(ReadResponse):
    team_id: int | None
    team_code: str
    team_name: str
    active: bool
    amounts: dict[str, AmountResponse]
    total: AmountResponse | None


class FactoryStockMatrixResponse(ReadResponse):
    materials: list[NamedAmountResponse]
    rows: list[FactoryStockRowResponse]
    total: AmountResponse


class FactoryTeamResponse(ReadResponse):
    id: int | None
    code: str
    name: str
    active: bool
    balance: StockBalanceResponse | None
    serial_count: int | None
    urgent_serial_count: int | None
    pending_incoming: PendingAmountResponse | None
    processing: list[StockProcessingResponse] | None


class FactoryFlowsResponse(ReadResponse):
    inbound: ChartAmountResponse
    outbound: ChartAmountResponse
    shipment: ChartAmountResponse
    internal: ChartAmountResponse
    loss: ChartAmountResponse


class FactoryTrendResponse(FactoryFlowsResponse):
    key: str


class FactoryWaitingAgeResponse(ReadResponse):
    key: str
    label: str
    internal: ChartAmountResponse
    external: ChartAmountResponse


class StockRankingResponse(ReadResponse):
    quantity: list[ChartPointResponse]
    weight: list[ChartPointResponse]


class FactoryRecentBatchResponse(AmountResponse):
    batch_no: str
    entry_kind: Literal[
        "transfer",
        "warehouse_receipt",
        "warehouse_outbound",
        "inspection_shipment",
        "opening_stock",
        "serial_reallocation",
        "rework_split",
    ]
    source_id: int | None
    target_id: int | None
    source_name: str | None
    target_name: str | None
    external_destination: str | None
    status: Literal["pending", "received", "dispatched", "partial", "voided"]
    line_count: int
    urgent_serial_count: int
    serial_count: int
    material_count: int
    material_name: str | None
    waiting_since: str | None
    updated_at: str
    received_at: str | None


class StockAttentionResponse(AmountResponse):
    transfer_id: int
    batch_no: str
    serial_no: str | None
    team_id: int
    team_name: str
    received_at: str


class PendingAttentionResponse(AmountResponse):
    id: int
    batch_no: str
    serial_no: str | None
    source_team_name: str | None
    next_team_name: str | None
    external_destination: str | None
    created_at: str


class FactoryOverviewResponse(ReadResponse):
    as_of: str
    days: int
    teams: list[FactoryTeamResponse]
    totals: StockBalanceResponse
    pending: PendingAmountResponse
    period_totals: FactoryFlowsResponse
    trend: list[FactoryTrendResponse]
    material_types: list[ChartPointResponse]
    stock_age: list[ChartPointResponse]
    waiting_age: list[FactoryWaitingAgeResponse]
    legacy_received_count: int
    material_ranking: StockRankingResponse
    serial_ranking: StockRankingResponse
    recent_batches: list[FactoryRecentBatchResponse]
    stock_matrix: FactoryStockMatrixResponse
    stock_attention: list[StockAttentionResponse]
    pending_attention: list[PendingAttentionResponse]


class SerialSummaryResponse(StockBalanceResponse):
    serial_no: str
    material_name: str | None
    material_type: str | None
    transfer_specification: str | None
    finished_specification: str | None
    source_batch_no: str | None
    customer_code: str | None
    product_code: str | None
    finished_quantity: int | None
    material_name_count: int
    material_type_count: int
    transfer_specification_count: int
    finished_specification_count: int
    source_batch_no_count: int
    customer_code_count: int
    product_code_count: int
    finished_quantity_count: int
    last_activity_at: str | None
    urgency: UrgencyResponse
    pending_incoming_quantity: int
    pending_incoming_weight: float
    pending_outgoing_quantity: int
    pending_outgoing_weight: float


class TeamTrendResponse(ReadResponse):
    key: str
    incoming: ChartAmountResponse
    outgoing: ChartAmountResponse
    loss: ChartAmountResponse


class TeamWaitingAgeResponse(ReadResponse):
    key: str
    label: str
    incoming: ChartAmountResponse
    outgoing: ChartAmountResponse


class TeamPeersResponse(ReadResponse):
    incoming: list[ChartPointResponse]
    outgoing: list[ChartPointResponse]


class MaterialAnalyticsResponse(ReadResponse):
    team_id: int
    days: Literal[7, 30]
    metric: Literal["quantity", "weight"]
    as_of: str
    trend: list[TeamTrendResponse]
    stock_ranking: list[ChartPointResponse]
    material_types: list[ChartPointResponse]
    materials: list[ChartPointResponse]
    loss_ranking: list[ChartPointResponse]
    stock_age: list[ChartPointResponse]
    waiting_age: list[TeamWaitingAgeResponse]
    peers: TeamPeersResponse
