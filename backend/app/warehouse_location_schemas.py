"""Warehouse location catalogue, occupants and bounded reservation responses."""

from typing import Literal

from .read_schemas import PageResponse, ReadResponse, SharedMaterialResponse
from .stock_read_schemas import StockBatchResponse


class WarehouseOccupantResponse(SharedMaterialResponse):
    location_id: int
    id: int
    batch_no: str
    serial_no: str
    material_name: str | None
    material_type: str | None
    status: str
    created_at: str
    received_at: str | None
    quantity: int
    weight: float
    available_quantity: int
    available_weight: float


class WarehouseLocationResponse(ReadResponse):
    id: int
    team_id: int
    name: str
    active: bool
    version: int
    status: Literal["occupied", "locked", "available", "disabled"]
    draft_locked: bool
    has_stock: bool
    batches: list[WarehouseOccupantResponse]


class WarehouseLocationPage(PageResponse[WarehouseLocationResponse]):
    team_id: int


class WarehouseLeaseResponse(ReadResponse):
    id: int
    name: str
    key: str
    expires_at: str
    hold_until: str


class WarehouseCatalogRow(ReadResponse):
    key: str
    location: WarehouseLocationResponse | None
    stock: StockBatchResponse | None


class WarehouseCatalogPage(PageResponse[WarehouseCatalogRow]):
    pass
