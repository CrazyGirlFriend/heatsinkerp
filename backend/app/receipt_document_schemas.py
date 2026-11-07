"""Supplemental warehouse originals and their parsed, reviewable fields."""

from typing import Literal

from .process_route_read_schemas import (
    RouteOrderDocumentResponse,
    RouteSourceDataResponse,
    RouteStepResponse,
)
from .read_schemas import ReadResponse


class ParsedReceiptProcessResponse(RouteSourceDataResponse):
    serial_nos: list[str]
    steps: list[RouteStepResponse]


class ReceiptDocumentResponse(ReadResponse):
    id: int
    kind: Literal["process", "drawing", "order"]
    filename: str
    size_bytes: int
    sha256: str
    parsed: ParsedReceiptProcessResponse | RouteOrderDocumentResponse | ReadResponse
    transfer_id: int | None
    created_at: str
    confirmed_at: str | None


class ReceiptDocumentsResponse(ReadResponse):
    items: list[ReceiptDocumentResponse]
