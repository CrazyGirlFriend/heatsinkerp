"""Whole outbound document contracts; line details reuse transfer schemas."""

from datetime import datetime
from typing import Literal

from .read_schemas import PageResponse, ReadResponse
from .schemas import MaterialTransferResponse, MaterialTransferTeamSnapshot


class MaterialBatchesResponse(ReadResponse):
    items: list[MaterialTransferResponse]


class MaterialDispatchSummaryResponse(MaterialBatchesResponse):
    dispatch_no: str
    source_team_id: int
    entry_kind: Literal["transfer", "warehouse_outbound", "inspection_shipment"]
    external_destination: str | None
    next_team: MaterialTransferTeamSnapshot | None
    created_by: str
    created_at: datetime
    notes: str | None
    status: Literal["pending", "partial", "received", "voided", "dispatched"]
    total_quantity: int
    total_weight: float
    line_count: int


class MaterialDispatchResponse(MaterialDispatchSummaryResponse):
    id: int
    barcode_payload: str
    barcode_type: Literal["CODE128"]
    source_team: MaterialTransferTeamSnapshot | None
    revision: str
    pending_line_count: int
    allowed_actions: list[Literal["confirm", "confirm_outbound"]]
    locked: bool
    confirmed_by: str | None
    confirmed_by_user_id: int | None
    confirmed_at: datetime | None


MaterialDispatchPageResponse = PageResponse[
    MaterialDispatchResponse | MaterialDispatchSummaryResponse
]
