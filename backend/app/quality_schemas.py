"""Inspection and quality feedback contracts, separate from transactions."""

from datetime import date, datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .process_route_read_schemas import ReworkProgressResponse, RouteExecutionContextResponse
from .read_schemas import PageResponse, ReadResponse

Disposition = Literal["pending", "rework", "shipment", "transfer", "reallocate", "scrap", "other"]


ProblemCategory = Literal[
    "坑",
    "划伤",
    "磕伤",
    "塌",
    "雕坏",
    "切坏",
    "磨坏",
    "修毛刺",
    "异物",
    "缺肉",
    "崩边",
    "打标坏",
    "露钼",
    "分层",
    "露铜",
    "喷砂",
    "料不平",
    "凸起",
    "轧坏",
    "外委",
]
RepairColumn = Literal["研磨", "退火", "雕刻", "轧板", "线切割", "喷砂", "脏", "外委", "修毛刺"]
ReportTemplate = Literal["FACTORY-QC", "QC-SANDBLAST", "QC-DEBURR"]


class FailureLine(BaseModel):
    model_config = ConfigDict(extra="forbid")
    category: ProblemCategory
    quantity: int = Field(gt=0, le=2147483647, strict=True)
    disposition: Literal["scrap", "rework"]
    repair_team_id: int | None = Field(default=None, ge=1)
    repair_column: RepairColumn | None = None

    @model_validator(mode="after")
    def destination(self):
        if (self.disposition == "rework") != (self.repair_team_id is not None):
            raise ValueError("返修须选择返修班组，判废无需指定班组")
        if self.disposition == "scrap" and self.repair_column:
            raise ValueError("判废无需填写返修明细")
        return self


class RecordedFailureLine(FailureLine):
    repair_team_name: str | None = None


class InspectionResults(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sample_quantity: int = Field(gt=0, le=2147483647)
    failed_quantity: int = Field(ge=0, le=2147483647)
    scope: Literal["sample", "full"] = "sample"
    methods: list[Literal["visual", "microscope"]] = Field(min_length=1, max_length=2)
    items: list[Literal["appearance", "dimension", "weight"]] = Field(min_length=1, max_length=3)
    dimension_result: str = Field(default="", max_length=2000)
    weight_result: str = Field(default="", max_length=2000)
    failure_lines: list[FailureLine] = Field(default_factory=list, max_length=100)
    involved_team_ids: list[int] = Field(default_factory=list, max_length=50)
    problem_type_ids: list[int] = Field(default_factory=list, max_length=50)
    notes: str = Field(default="", max_length=2000)
    parent_id: int | None = Field(default=None, ge=1)

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
        legacy_patrol = getattr(self, "kind", None) == "patrol" and self.parent_id is None
        if (
            legacy_patrol
            and self.failed_quantity
            and not (self.involved_team_ids and self.problem_type_ids)
        ):
            raise ValueError("历史巡检须选择问题和涉及班组")
        if (
            not legacy_patrol
            and sum(line.quantity for line in self.failure_lines) != self.failed_quantity
        ):
            raise ValueError("各问题类别件数合计须等于不合格件数")
        if not self.failed_quantity and self.involved_team_ids:
            raise ValueError("没有不合格物料时无需指定问题班组")
        if len(set(self.problem_type_ids)) != len(self.problem_type_ids) or any(
            i < 1 for i in self.problem_type_ids
        ):
            raise ValueError("检验问题不能重复或无效")
        if not self.failed_quantity and self.problem_type_ids:
            raise ValueError("没有不合格物料时无需选择检验问题")
        return self


class InspectionCreate(InspectionResults):
    source_transfer_id: int = Field(ge=1)
    expected_revision: int = Field(ge=0)
    inspector_employee_id: int = Field(ge=1)
    checked_at: datetime
    kind: Literal["patrol", "inspection"] = "patrol"
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


class FeedbackWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    team_id: int | None = Field(default=None, ge=1)
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
    involved_team_ids: list[int] = Field(max_length=50)
    release_legacy_hold: bool = False


class InspectionSourceResponse(ReadResponse):
    is_outsourced: bool = False
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
    failure_lines: list[RecordedFailureLine] = Field(default_factory=list)
    is_outsourced: bool = False
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


class PendingRepairResponse(ReadResponse):
    id: int
    batch_no: str


class QualityFeedbackDetailResponse(QualityFeedbackResponse):
    pending_repairs: list[PendingRepairResponse] = Field(default_factory=list)
    events: list[FeedbackEventResponse]
    rechecks: list[InspectionRecordResponse]


class TeamProblemResponse(ReadResponse):
    """A team report is the rework request itself, not a fabricated inspection."""

    id: int
    kind: Literal["team_report"]
    serial_no: str
    batch_no: str
    source_transfer_id: int
    material_name: str | None
    team_id: int
    team_name: str
    checked_at: str
    notes: str
    failed_quantity: int
    weight: float
    created_by: str
    involved_teams: list[FeedbackTeamResponse]
    feedback_status: Literal["pending", "processing", "closed"]
    disposition: Literal["rework"]
    route_state: Literal["draft", "published"]
    rework_round: int
    rework_progress: ReworkProgressResponse


class ProcessingQualityResponse(ReadResponse):
    id: int
    kind: Literal["processing"]
    feedback_status: Literal["recorded"]
    serial_no: str
    batch_no: str
    team_id: int
    team_name: str
    checked_at: datetime
    processing_date: date
    processor_name: str
    failed_quantity: int
    failed_weight: float
    notes: str


class QualityFeedbackPageResponse(
    PageResponse[QualityFeedbackResponse | TeamProblemResponse | ProcessingQualityResponse]
):
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
