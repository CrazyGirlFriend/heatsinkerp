"""Inspection and quality feedback contracts, separate from transactions."""

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .process_route_read_schemas import RouteExecutionContextResponse
from .read_schemas import PageResponse, ReadResponse

Disposition = Literal["pending", "rework", "shipment", "transfer", "reallocate", "scrap", "other"]


class InspectionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_transfer_id: int = Field(ge=1)
    expected_revision: int = Field(ge=0)
    inspector_employee_id: int = Field(ge=1)
    checked_at: datetime
    sample_quantity: int = Field(gt=0, le=2147483647)
    failed_quantity: int = Field(ge=0, le=2147483647)
    kind: Literal["patrol", "inspection"] = "patrol"
    scope: Literal["sample", "full"] = "sample"
    methods: list[Literal["visual", "microscope"]] = Field(min_length=1, max_length=2)
    items: list[Literal["appearance", "dimension", "weight"]] = Field(min_length=1, max_length=3)
    dimension_result: str = Field(default="", max_length=2000)
    weight_result: str = Field(default="", max_length=2000)
    involved_team_ids: list[int] = Field(default_factory=list, max_length=50)
    problem_type_ids: list[int] = Field(default_factory=list, max_length=50)
    notes: str = Field(default="", max_length=2000)
    parent_id: int | None = Field(default=None, ge=1)
    idempotency_key: str = Field(min_length=1, max_length=100)

    @field_validator("idempotency_key")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("提交标识不能为空")
        return value.strip()

    @field_validator("checked_at")
    @classmethod
    def timestamp(cls, value):
        if value.tzinfo is None:
            raise ValueError("检查时间须带时区")
        return value.astimezone(timezone.utc)

    @model_validator(mode="after")
    def counts(self):
        if self.failed_quantity > self.sample_quantity:
            raise ValueError("不合格件数不能超过检查件数")
        if len(set(self.methods)) != len(self.methods) or len(set(self.items)) != len(self.items):
            raise ValueError("检查手段和项目不能重复")
        if len(set(self.involved_team_ids)) != len(self.involved_team_ids) or any(
            i < 1 for i in self.involved_team_ids
        ):
            raise ValueError("问题涉及班组不能重复或无效")
        if self.failed_quantity and not self.parent_id and not self.involved_team_ids:
            raise ValueError("请选择问题涉及班组")
        if not self.failed_quantity and self.involved_team_ids:
            raise ValueError("没有不合格物料时无需指定问题班组")
        if len(set(self.problem_type_ids)) != len(self.problem_type_ids) or any(
            i < 1 for i in self.problem_type_ids
        ):
            raise ValueError("检验问题不能重复或无效")
        if self.failed_quantity and not self.problem_type_ids:
            raise ValueError("请选择检验问题")
        if not self.failed_quantity and self.problem_type_ids:
            raise ValueError("没有不合格物料时无需选择检验问题")
        return self


class FeedbackWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=0)
    notes: str = Field(default="", max_length=2000)
    idempotency_key: str = Field(min_length=1, max_length=100)

    @field_validator("idempotency_key")
    @classmethod
    def key(cls, value):
        if not value.strip():
            raise ValueError("提交标识不能为空")
        return value.strip()


class Decision(FeedbackWrite):
    disposition: Disposition
    status: Literal["pending", "processing", "closed"]
    involved_team_ids: list[int] = Field(min_length=1, max_length=50)
    release_legacy_hold: bool = False


class InspectionSourceResponse(ReadResponse):
    source_transfer_id: int
    team_id: int
    serial_no: str
    batch_no: str
    material_name: str | None
    specification: str | None
    quantity: int
    revision: int
    hold_id: int | None
    processing_status: str | None


class InspectionProblemResponse(ReadResponse):
    id: int
    name: str


class InspectionRecordResponse(ReadResponse):
    id: int
    process_step: RouteExecutionContextResponse | None
    source_transfer_id: int
    team_id: int
    team_name: str
    serial_no: str
    batch_no: str
    material_name: str | None
    specification: str | None
    inspector_employee_id: int
    inspector_name: str
    processing_record_id: int | None
    processor_name: str | None
    checked_at: str
    batch_quantity: int
    sample_quantity: int
    passed_quantity: int
    failed_quantity: int
    status: Literal["pending", "released", "passed", "failed"]
    kind: Literal["patrol", "inspection"]
    scope: Literal["sample", "full"]
    methods: list[Literal["visual", "microscope"]]
    items: list[Literal["appearance", "dimension", "weight"]]
    dimension_result: str
    weight_result: str
    blocks_outbound: bool
    feedback_status: Literal["pending", "processing", "closed"]
    disposition: Disposition
    decision_notes: str
    feedback_version: int
    quality_issue_id: int | None
    notes: str
    problems: list[InspectionProblemResponse]
    parent_id: int | None
    released_at: str | None
    created_by: str


class FeedbackTeamResponse(ReadResponse):
    team_id: int
    name: str
    replied: bool


class QualityFeedbackResponse(InspectionRecordResponse):
    involved_teams: list[FeedbackTeamResponse]


class FeedbackDecisionResponse(ReadResponse):
    disposition: Disposition | None = None
    status: Literal["pending", "processing", "closed"] | None = None
    involved_team_ids: list[int] | None = None
    previous_involved_team_ids: list[int] | None = None
    released_legacy_hold: bool | None = None


class FeedbackEventResponse(ReadResponse):
    id: int
    kind: Literal["reply", "decision"]
    team_id: int
    team_name: str
    actor: str
    notes: str
    details: FeedbackDecisionResponse
    occurred_at: str


class QualityFeedbackDetailResponse(QualityFeedbackResponse):
    events: list[FeedbackEventResponse]
    rechecks: list[InspectionRecordResponse]


class QualityFeedbackPageResponse(PageResponse[QualityFeedbackResponse]):
    pending_count: int


class QualityReworkStockResponse(ReadResponse):
    id: int
    batch_no: str
    serial_no: str
    team_name: str
    quantity: int
    weight: float


InspectionPageResponse = PageResponse[InspectionRecordResponse]
InspectionSourcePageResponse = PageResponse[InspectionSourceResponse]
