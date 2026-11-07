"""Factory dashboard contracts, including historical delivery and yield reads."""

from typing import Literal

from .analytics_read_schemas import AmountResponse, FactoryStockMatrixResponse
from .read_schemas import ReadResponse

YieldStatus = Literal["complete", "in_progress", "needs_review"]


class DashboardSerialResponse(ReadResponse):
    serial_no: str
    created_at: str


class ShipmentSeriesResponse(DashboardSerialResponse):
    values: list[int | None]


class ShipmentsResponse(ReadResponse):
    dates: list[str]
    series: list[ShipmentSeriesResponse]


class MaterialYieldResponse(ReadResponse):
    material: str
    input_weight: float
    output_weight: float
    rate: float | None
    completed_count: int
    active_count: int


class SerialYieldResponse(ReadResponse):
    serial_no: str
    material: str
    input_weight: float
    output_weight: float
    lost_weight: float
    current_weight: float
    processing_delta_weight: float
    weight_difference: float
    max_weight_difference: float
    reallocated_in_weight: float
    reallocated_out_weight: float
    shared_allocated_weight: float
    rate: float | None
    status: YieldStatus


class TeamYieldResponse(ReadResponse):
    team_id: int
    team_name: str
    input_weight: float
    output_weight: float
    lost_weight: float
    current_weight: float
    processing_delta_weight: float
    weight_difference: float
    max_weight_difference: float
    reallocated_out_weight: float
    rate: float | None
    status: YieldStatus


class TeamYieldsResponse(ReadResponse):
    items: list[TeamYieldResponse]


class DashboardStockDetailResponse(AmountResponse):
    team_id: int
    team_name: str
    serial_no: str
    material: str
    material_type: str | None
    transfer_specification: str | None
    processing_role: Literal["remaining", "produced", "scrap"] | None


class InstallmentResponse(ReadResponse):
    label: str
    due_date: str
    quantity: int


class LegacyDeliveryPlanResponse(ReadResponse):
    serial_no: str
    version: int
    installments: list[InstallmentResponse]


class DeliveryResponse(InstallmentResponse):
    source_batch_no: str | None
    legacy: bool
    serial_no: str
    index: int
    shipped: int
    remaining: int
    completed_on: str | None
    status: Literal["on_time", "late_complete", "overdue", "pending"]
    overdue_days: int


class AttentionSerialResponse(ReadResponse):
    serial_no: str
    materials: list[str]
    teams: list[str]
    reasons: list[str]
    age_days: int
    overdue_days: int
    remaining: int | None


class DashboardDeliveryResponse(ReadResponse):
    on_time_rate: float | None
    due_count: int
    overdue_count: int
    upcoming_count: int
    items: list[DeliveryResponse]
    total: int


class FactoryDashboardResponse(ReadResponse):
    as_of: str
    today: str
    stock: FactoryStockMatrixResponse
    yields: list[MaterialYieldResponse]
    delivery: DashboardDeliveryResponse
    shipping: ShipmentsResponse
    serial_count: int
    attention: list[AttentionSerialResponse]
    legacy_count: int
