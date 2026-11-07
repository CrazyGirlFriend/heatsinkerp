"""Shared read contracts; paging and physical stock amounts have one definition."""

from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict

Item = TypeVar("Item")


class ReadResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PageResponse(ReadResponse, Generic[Item]):
    items: list[Item]
    total: int
    page: int
    page_size: int


class SharedSerialResponse(ReadResponse):
    serial_no: str
    process_route_id: int | None = None
    process_route_version: int | None = None
    customer_code: str | None = None
    finished_specification: str | None = None
    delivery_date: str | None = None
    delivery_quantity: int | None = None
    planned_weight: float | None = None
    planned_quantity: int | None = None
    planned_specification: str | None = None


class SharedMaterialResponse(ReadResponse):
    shared_group_id: int | None
    shared_unallocated: bool
    # Provenance is appended only to groups that belong to shared material.
    shared_origin_batch_no: str | None = None
    shared_serials: list[SharedSerialResponse] | None = None


class StockBalanceResponse(ReadResponse):
    received_quantity: int
    received_weight: float
    dispatched_quantity: int
    dispatched_weight: float
    reserved_quantity: int
    reserved_weight: float
    in_transit_quantity: int
    in_transit_weight: float
    lost_quantity: int
    lost_weight: float
    on_hand_quantity: int
    on_hand_weight: float
    available_quantity: int
    available_weight: float
    scrap_quantity: int
    scrap_weight: float
    scrap_available_quantity: int
    scrap_available_weight: float
    owned_quantity: int
    owned_weight: float
    external_pending_quantity: int
    external_pending_weight: float
    shortage_quantity: int
    shortage_weight: float
    adjusted_quantity: int
    adjusted_weight: float
