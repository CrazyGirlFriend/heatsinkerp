"""Supported material-transfer, authentication and administration contracts."""
from __future__ import annotations
from datetime import datetime
from decimal import Decimal
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

DIRECT_MATERIAL_TYPE_PATTERN = (
    "^(raw_material|finished|semi_finished|finished_surplus|semi_finished_surplus|defective|waste|sludge|scrap_chips)$"
)
SCRAP_MATERIAL_TYPES = ("defective", "waste", "sludge", "scrap_chips")


class APIModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class MaterialTransferDocumentFields(APIModel):
    """Optional document snapshots, independent of product/process master data."""

    material_type: str | None = Field(default=None, pattern=DIRECT_MATERIAL_TYPE_PATTERN)
    source_batch_no: str | None = Field(default=None, max_length=80)
    material_name: str | None = Field(default=None, max_length=160)
    finished_specification: str | None = Field(default=None, max_length=240)
    transfer_specification: str | None = Field(default=None, max_length=240)
    finished_quantity: int | None = Field(default=None, ge=0, le=2_147_483_647)
    customer_code: str | None = Field(default=None, max_length=80)
    technical_requirements: str | None = Field(default=None, max_length=4000)
    product_code: str | None = Field(default=None, max_length=80)
    part_no: str | None = Field(default=None, max_length=80)
    material_shape: str | None = Field(default=None, max_length=80)
    material_description: str | None = Field(default=None, max_length=2000)
    outsourced_unit: str | None = Field(default=None, max_length=160)
    purpose_category: str | None = Field(default=None, max_length=80)
    category_level3: str | None = Field(default=None, max_length=80)
    order_category: str | None = Field(default=None, max_length=80)
    special_process: str | None = Field(default=None, max_length=2000)

    @field_validator(
        "source_batch_no", "material_name", "finished_specification",
        "transfer_specification", "customer_code", "technical_requirements",
        "product_code", "part_no", "material_shape", "material_description",
        "outsourced_unit", "purpose_category", "category_level3", "order_category",
        "special_process",
    )
    @classmethod
    def normalize_document_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


class MaterialTransferCreate(MaterialTransferDocumentFields):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="forbid")

    serial_no: str = Field(min_length=1, max_length=80)
    next_team_id: int = Field(ge=1)
    quantity: int = Field(ge=0, le=2_147_483_647)
    weight: Decimal = Field(ge=0, max_digits=14, decimal_places=3)
    notes: str | None = Field(default=None, max_length=2000)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=100)

    @model_validator(mode="after")
    def validate_amounts(self):
        if self.quantity == 0 and self.weight == 0:
            raise ValueError("quantity or weight must be positive")
        return self

    @field_validator("serial_no")
    @classmethod
    def normalize_serial_no(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("serial_no cannot be blank")
        return value


class MaterialTransferUpdate(MaterialTransferDocumentFields):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="forbid")

    serial_no: str | None = Field(default=None, min_length=1, max_length=80)
    next_team_id: int | None = Field(default=None, ge=1)
    quantity: int | None = Field(default=None, ge=0, le=2_147_483_647)
    weight: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=3)
    notes: str | None = Field(default=None, max_length=2000)
    expected_version: int | None = Field(default=None, ge=1)

    @field_validator("serial_no")
    @classmethod
    def normalize_serial_no(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("serial_no cannot be blank")
        return value

    @model_validator(mode="after")
    def validate_update(self):
        if not self.model_fields_set - {"expected_version"}:
            raise ValueError("at least one field is required")
        for field in self.model_fields_set & {"serial_no", "next_team_id", "quantity", "weight"}:
            if getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class WarehouseReceiptCreate(MaterialTransferDocumentFields):
    """Explicit stock origin; never impersonate an upstream team or ERP event."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="forbid")
    serial_no: str = Field(min_length=1, max_length=80)
    material_name: str = Field(min_length=1, max_length=160)
    material_type: str = Field(pattern=DIRECT_MATERIAL_TYPE_PATTERN)
    quantity: int = Field(ge=0, le=2_147_483_647)
    weight: Decimal = Field(ge=0, max_digits=14, decimal_places=3)
    notes: str = Field(min_length=1, max_length=2000)
    idempotency_key: str = Field(min_length=1, max_length=100)
    receipt_kind: Literal["external", "return"] = "external"
    external_source: str | None = Field(default=None, min_length=1, max_length=240)
    return_dispatch_no: str | None = Field(default=None, min_length=1, max_length=40)

    @field_validator("external_source", "return_dispatch_no")
    @classmethod
    def normalize_source(cls, value):
        if value is not None and not value.strip():
            raise ValueError("来源或关联出库单不能为空白")
        return value.strip() if value is not None else None

    @field_validator("serial_no", "notes", "idempotency_key")
    @classmethod
    def nonblank_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("required text cannot be blank")
        return value.strip()

    @model_validator(mode="after")
    def validate_intake(self):
        if self.receipt_kind == "return" and not self.external_source:
            raise ValueError("外部返料须填写来源单位")
        if self.return_dispatch_no and self.receipt_kind != "return":
            raise ValueError("仅外部返料可关联原出库单")
        if not self.material_name:
            raise ValueError("material_name is required")
        if self.quantity == 0 and self.weight == 0:
            raise ValueError("quantity or weight must be positive")
        return self


class MaterialTransferConfirm(APIModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="forbid")

    idempotency_key: str = Field(min_length=1, max_length=100)
    expected_version: int | None = Field(default=None, ge=1)


class MaterialTransferReject(APIModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1)
    reason: str = Field(min_length=1, max_length=2000)

    @field_validator("reason")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("请填写退回核对原因")
        return value.strip()


class MaterialTransferTeamSnapshot(APIModel):
    id: int
    code: str
    name: str
    # Current directory classification, not an immutable historical snapshot.
    kind: str | None = None


class MaterialTransferEventResponse(APIModel):
    id: int
    action: str
    actor: str
    occurred_at: datetime
    changes: dict[str, dict[str, Any]]


class MaterialTransferResponse(MaterialTransferDocumentFields):
    urgency: dict | None = None
    id: int
    batch_no: str
    barcode_payload: str
    barcode_type: str
    serial_no: str
    entry_kind: str = "transfer"
    external_destination: str | None = None
    receipt_kind: str | None = None
    external_source: str | None = None
    return_dispatch_no: str | None = None
    rejection_reason: str | None = None
    source_team_id: int | None
    source_team: MaterialTransferTeamSnapshot | None
    next_team_id: int | None
    next_team: MaterialTransferTeamSnapshot | None
    quantity: int
    quantity_unit: str
    weight: float
    weight_unit: str
    status: str
    notes: str | None
    created_by: str
    created_by_user_id: int | None
    created_at: datetime
    updated_at: datetime
    received_by: str | None
    received_by_user_id: int | None
    received_at: datetime | None
    dispatched_by: str | None = None
    dispatched_by_user_id: int | None = None
    dispatched_at: datetime | None = None
    voided_by: str | None
    voided_by_user_id: int | None
    voided_at: datetime | None
    locked: bool
    locked_at: datetime | None
    allowed_actions: list[str]
    version: int
    stock_tracked: bool = False
    source_transfer_id: int | None = None
    source_transfer_batch_no: str | None = None
    dispatch_no: str | None = None
    loss_records: list[dict[str, Any]] = Field(default_factory=list)
    history: list[MaterialTransferEventResponse] = Field(default_factory=list)


class MaterialTransferList(APIModel):
    items: list[MaterialTransferResponse]
    total: int
    page: int
    page_size: int


class HealthResponse(APIModel):
    status: str
    database: str


class LoginRequest(APIModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=200)


class TeamCreate(APIModel):
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=240)
    active: bool = True
    sort_order: int = Field(default=0, ge=0, le=1000000)
    kind: str = Field(default="production", pattern="^(production|scrap|warehouse)$")


class TeamUpdate(APIModel):
    code: str | None = Field(default=None, min_length=1, max_length=64)
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=240)
    active: bool | None = None
    sort_order: int | None = Field(default=None, ge=0, le=1000000)
    kind: str | None = Field(default=None, pattern="^(production|scrap|warehouse)$")


class TeamResponse(APIModel):
    id: int
    code: str
    name: str
    description: str | None
    active: bool
    sort_order: int
    kind: str
    created_at: datetime
    updated_at: datetime


class UserCreate(APIModel):
    username: str = Field(min_length=1, max_length=64)
    display_name: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=8, max_length=200)
    role: str = Field(pattern="^(ADMIN|TEAM)$")
    team_id: int | None = Field(default=None, ge=1)
    active: bool = True

    @model_validator(mode="after")
    def validate_team_role(self) -> UserCreate:
        if self.role == "TEAM" and self.team_id is None:
            raise ValueError("TEAM users must have a team_id")
        return self


class UserUpdate(APIModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=80)
    password: str | None = Field(default=None, min_length=8, max_length=200)
    role: str | None = Field(default=None, pattern="^(ADMIN|TEAM)$")
    team_id: int | None = Field(default=None, ge=1)
    active: bool | None = None


class UserResponse(APIModel):
    id: int
    username: str
    display_name: str
    role: str
    team_id: int | None
    team_code: str | None
    team_name: str | None
    active: bool
    created_at: datetime
    updated_at: datetime


class LoginResponse(APIModel):
    access_token: str
    token_type: str
    expires_at: datetime
    user: UserResponse
