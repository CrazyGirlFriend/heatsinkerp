"""Classified physical stock shared by team and all-factory inventory views."""

from typing import Literal

from .process_route_read_schemas import RouteExecutionContextResponse
from .read_schemas import PageResponse, SharedMaterialResponse, StockBalanceResponse
from .serial_urgency_schemas import UrgencyResponse


class InventoryGroupResponse(StockBalanceResponse, SharedMaterialResponse):
    group_id: int
    serial_no: str
    process_route_id: int | None
    rework_route_id: int | None
    process_step_index: int | None
    process_step_complete: bool
    material_name: str
    transfer_specification: str
    material_type: str
    processing_role: Literal["remaining", "produced", "scrap"] | None
    processing_group: Literal["unregistered", "registered", "partial", "complete"]
    processing_state: Literal[
        "not_required",
        "not_applicable",
        "rework",
        "mixed",
        "partial",
        "complete",
        "registered",
        "unregistered",
        "pending",
        "cleared",
    ]
    rework_pending: bool
    rework_count: int
    purpose_id: int | None
    purpose_name: str
    receipt_source: Literal["external", "return", "internal", "opening", "processing", "rework"]
    source_team_id: int | None
    external_source: str
    source_name: str | None
    batch_count: int
    current_batch_count: int
    oldest_received_at: str | None
    stock_age_started_at: str | None
    stock_age_basis: Literal["received"] | None
    stock_age_hours: float | None
    last_activity_at: str | None
    processing_registered_batch_count: int
    processing_unregistered_batch_count: int
    processing_partial_batch_count: int
    processing_complete_batch_count: int
    processing_registered_quantity: int
    processing_registered_weight: float
    processing_unregistered_quantity: int
    processing_unregistered_weight: float
    inspection_hold_count: int
    customer_code: str | None
    customer_code_count: int
    product_code: str | None
    product_code_count: int
    source_batch_no: str | None
    source_batch_no_count: int
    finished_specification: str | None
    finished_specification_count: int
    finished_quantity: int | None
    finished_quantity_count: int
    rework_round: int | None
    rework_route_ready: bool | None
    process_route: RouteExecutionContextResponse | None
    weight_difference: float
    max_weight_difference: float
    urgency: UrgencyResponse


class TeamInventoryPageResponse(PageResponse[InventoryGroupResponse]):
    as_of: str


class FactoryInventoryGroupResponse(InventoryGroupResponse):
    team_id: int
    team_name: str
    team_code: str


class FactoryInventoryPageResponse(PageResponse[FactoryInventoryGroupResponse]):
    as_of: str
