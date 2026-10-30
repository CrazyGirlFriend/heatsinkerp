"""Delivery commitments are separate from stock movements and customer due dates."""

from datetime import datetime, timezone
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ScheduleSource(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_transfer_id: int = Field(ge=1)
    quantity: int | None = Field(default=None, gt=0, le=2_147_483_647)
    weight: Decimal | None = Field(default=None, gt=0, max_digits=17, decimal_places=6)

    @model_validator(mode="after")
    def amounts(self):
        if self.quantity is None and self.weight is None:
            raise ValueError("请填写该批次分配的计划件数或重量")
        return self


class ScheduleNode(BaseModel):
    model_config = ConfigDict(extra="forbid")
    process_route_id: int | None = Field(default=None, ge=1)
    process_step_index: int | None = Field(default=None, ge=0)
    team_id: int = Field(ge=1)
    next_team_id: int | None = Field(default=None, ge=1)
    external_destination: str | None = Field(default=None, max_length=240)
    due_at: datetime
    target_quantity: int | None = Field(default=None, gt=0, le=2_147_483_647)
    target_weight: Decimal | None = Field(default=None, gt=0, max_digits=17, decimal_places=6)
    completion_basis: Literal["quantity", "weight", "both"] | None = None
    notes: str | None = Field(default=None, max_length=2000)
    sources: list[ScheduleSource] = Field(default_factory=list, max_length=100)

    @field_validator("notes", "external_destination")
    @classmethod
    def optional_text(cls, value):
        return value.strip() or None if value is not None else None

    @field_validator("due_at")
    @classmethod
    def hour(cls, value):
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("交货时间须包含明确时区")
        if value.minute or value.second or value.microsecond:
            raise ValueError("交货时间请精确到整点小时")
        return value.astimezone(timezone.utc).replace(tzinfo=None)

    @model_validator(mode="after")
    def validate_plan(self):
        if (self.next_team_id is None) == (self.external_destination is None):
            raise ValueError("请选择接收班组或对外去向")
        if self.next_team_id == self.team_id:
            raise ValueError("交货班组和接收班组不能相同")
        if self.target_quantity is None and self.target_weight is None:
            raise ValueError("请填写计划交货件数或重量")
        if self.completion_basis is None:
            object.__setattr__(
                self,
                "completion_basis",
                "quantity" if self.target_quantity is not None else "weight",
            )
        if self.completion_basis in ("quantity", "both") and self.target_quantity is None:
            raise ValueError("按件数判定交货须填写计划件数")
        if self.completion_basis in ("weight", "both") and self.target_weight is None:
            raise ValueError("按重量判定交货须填写计划重量")
        if len({source.source_transfer_id for source in self.sources}) != len(self.sources):
            raise ValueError("同一批次请合并分配数量后填写一次")
        for field, target in (("quantity", self.target_quantity), ("weight", self.target_weight)):
            total = sum((getattr(source, field) or 0 for source in self.sources), 0)
            if total and (target is None or total > target):
                raise ValueError("批次分配量不能超过本节点的计划交货量")
        return self


class ScheduleCreate(ScheduleNode):
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=100)
    serial_no: str = Field(min_length=1, max_length=80)
    predecessor_id: int | None = Field(default=None, ge=1)
    sequence_no: int = Field(default=1, ge=1, le=9999)

    @field_validator("serial_no")
    @classmethod
    def trim(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("内容不能仅为空格")
        return value


class CustomerBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    batch_number: int = Field(ge=1, le=100)
    due_at: datetime
    target_quantity: int = Field(gt=0, le=2_147_483_647)

    @field_validator("due_at")
    @classmethod
    def hour(cls, value):
        return ScheduleNode.hour(value)


class ScheduleTaskCreate(BaseModel):
    final_due_at: datetime | None = None

    @field_validator("final_due_at")
    @classmethod
    def final_hour(cls, value):
        return ScheduleNode.hour(value) if value is not None else None

    model_config = ConfigDict(extra="forbid")
    idempotency_key: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=160)
    serial_no: str = Field(min_length=1, max_length=80)
    notes: str | None = Field(default=None, max_length=2000)
    business_person_id: int | None = Field(default=None, ge=1)
    business_person_ids: list[int] = Field(default_factory=list, max_length=100)
    nodes: list[ScheduleNode] = Field(min_length=1, max_length=50)

    @field_validator("title", "serial_no", "idempotency_key")
    @classmethod
    def trim(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("内容不能仅为空格")
        return value

    @field_validator("notes")
    @classmethod
    def optional_text(cls, value):
        return value.strip() or None if value is not None else None

    @model_validator(mode="after")
    def route(self):
        for previous, current in zip(self.nodes, self.nodes[1:], strict=False):
            if previous.next_team_id != current.team_id:
                raise ValueError("前一节点的接收班组须与下一节点的交货班组一致")
        return self


class ScheduleUpdate(ScheduleCreate):
    expected_version: int = Field(ge=1)


class ScheduleCommitmentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1)
    due_at: datetime
    target_quantity: int | None = Field(default=None, gt=0, le=2_147_483_647)
    target_weight: Decimal | None = Field(default=None, gt=0, max_digits=17, decimal_places=6)
    completion_basis: Literal["quantity", "weight", "both"]
    notes: str | None = Field(default=None, max_length=2000)


class ScheduleTaskUpdate(BaseModel):
    delivery_batches: list[CustomerBatch] = Field(default_factory=list, max_length=100)
    final_due_at: datetime | None = None

    @field_validator("final_due_at")
    @classmethod
    def final_hour(cls, value):
        return ScheduleNode.hour(value) if value is not None else None

    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=160)
    notes: str | None = Field(default=None, max_length=2000)
    business_person_id: int | None = Field(default=None, ge=1)
    business_person_ids: list[int] = Field(default_factory=list, max_length=100)

    @field_validator("title")
    @classmethod
    def trim(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("标题不能仅为空格")
        return value

    @field_validator("notes")
    @classmethod
    def optional_text(cls, value):
        return value.strip() or None if value is not None else None


class ScheduleCancel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1)
    reason: str = Field(default="", max_length=2000)


class ScheduleInventoryQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    team_id: int = Field(ge=1)
    group_ids: list[int] = Field(default_factory=list, max_length=100)
    source_transfer_ids: list[int] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def ids(self):
        if not self.group_ids and not self.source_transfer_ids:
            raise ValueError("请选择库存行或批次")
        if any(value <= 0 for value in self.group_ids + self.source_transfer_ids):
            raise ValueError("批次编号无效")
        return self


class BusinessPersonWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=80)
    active: bool = True
    expected_version: int | None = Field(default=None, ge=1)

    @field_validator("name")
    @classmethod
    def trim(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("请填写业务人员姓名")
        return value
