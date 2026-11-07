"""Counterparty amendment input and public response contracts."""

from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .read_schemas import ReadResponse


class AmendmentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1)
    quantity: int = Field(ge=0, le=2_147_483_647)
    weight: Decimal = Field(ge=0, max_digits=17, decimal_places=6)
    notes: str | None = Field(default=None, max_length=2000)
    reason: str = Field(min_length=1, max_length=2000)

    @field_validator("reason")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("请填写修改原因")
        return value.strip()

    @model_validator(mode="after")
    def nonempty(self):
        if self.quantity == 0 and self.weight == 0:
            raise ValueError("数量和重量不能同时为零")
        return self


class AmendmentReject(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(min_length=1, max_length=2000)

    @field_validator("reason")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("请填写拒绝原因")
        return value.strip()


class AmendmentValuesResponse(ReadResponse):
    quantity: int
    weight: float
    notes: str | None


class TransferAmendmentResponse(ReadResponse):
    id: int
    batch_no: str
    serial_no: str
    status: Literal["pending", "approved", "rejected", "cancelled"]
    reason: str
    requester_team_id: int
    requester_team_name: str
    counterparty_team_id: int
    counterparty_team_name: str
    requested_by: str
    created_at: datetime
    resolved_at: datetime | None
    resolved_by: str | None
    response_reason: str | None
    before: AmendmentValuesResponse
    after: AmendmentValuesResponse
    allowed_actions: list[Literal["approve", "reject", "cancel"]]


class TransferAmendmentListResponse(ReadResponse):
    items: list[TransferAmendmentResponse]
    remaining_quantity: int
    remaining_weight: float
    editable: bool
