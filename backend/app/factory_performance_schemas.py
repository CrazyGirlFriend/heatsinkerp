"""Production, quality and issue metrics returned by the factory report."""

from typing import Literal

from .read_schemas import ReadResponse


class ProductionMetricsResponse(ReadResponse):
    record_count: int
    initial_record_count: int
    rework_record_count: int
    completed_quantity: int
    completed_weight: float
    rework_quantity: int
    rework_weight: float
    work_quantity: int
    work_weight: float


class ProductionScopeResponse(ProductionMetricsResponse):
    scope_id: int
    team_id: int
    team_name: str
    serial_no: str
    material_name: str | None
    purpose_name: str | None
    processing_task_name: str | None
    process_route_id: int | None
    process_step_index: int | None
    process_step_name: str | None


class ProductionTrendResponse(ProductionMetricsResponse):
    date: str


class TeamProductionResponse(ProductionMetricsResponse):
    team_id: int
    team_name: str


class ProductionReportResponse(ReadResponse):
    totals: ProductionMetricsResponse
    scope: ProductionScopeResponse | None
    scopes: list[ProductionScopeResponse]
    trend: list[ProductionTrendResponse]


class ProductionActivityResponse(ReadResponse):
    totals: ProductionMetricsResponse
    trend: list[ProductionTrendResponse]
    teams: list[TeamProductionResponse]


class QualityMetricsResponse(ReadResponse):
    record_count: int
    checked_quantity: int
    passed_quantity: int
    failed_quantity: int
    pass_rate: float | None


class QualityBasisResponse(ReadResponse):
    kind: Literal["patrol", "inspection"]
    scope: Literal["sample", "full"]
    phase: Literal["first", "recheck"]


class MaterialQualityResponse(QualityMetricsResponse, QualityBasisResponse):
    material_name: str | None


class GroupQualityResponse(MaterialQualityResponse):
    team_id: int
    team_name: str


class QualityTrendResponse(MaterialQualityResponse):
    date: str


class QualityReportResponse(ReadResponse):
    groups: list[GroupQualityResponse]
    materials: list[MaterialQualityResponse]
    trend: list[QualityTrendResponse]


class IssueSummaryResponse(ReadResponse):
    total: int
    pending: int
    processing: int
    closed: int
    unresolved: int


class ProblemFrequencyResponse(ReadResponse):
    problem_type_id: int | None
    name: str
    issue_count: int
    unresolved_count: int


class TeamIssueResponse(ReadResponse):
    team_id: int
    team_name: str
    issue_count: int
    unresolved_count: int


class IssueTrendResponse(ReadResponse):
    date: str
    total: int
    unresolved: int


class IssueReportResponse(ReadResponse):
    summary: IssueSummaryResponse
    problems: list[ProblemFrequencyResponse]
    teams: list[TeamIssueResponse]
    trend: list[IssueTrendResponse]


class PerformanceTeamResponse(ReadResponse):
    id: int
    code: str
    name: str
    active: bool


class FactoryPerformanceResponse(ReadResponse):
    period: Literal["day", "week", "month"]
    period_dates: list[str]
    date_from: str
    date_to: str
    generated_at: str
    teams: list[PerformanceTeamResponse]
    production: ProductionReportResponse
    quality: QualityReportResponse
    issues: IssueReportResponse
    activity: ProductionActivityResponse | None = None
