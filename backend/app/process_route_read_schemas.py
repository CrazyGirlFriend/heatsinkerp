"""Engineering read contracts, including unreviewed imports and rework rounds.

Read steps intentionally do not reuse write validators: an imported sequence of
-1 is a review issue the UI must display, not an invalid response to discard.
"""

from typing import Literal

from .read_schemas import PageResponse, ReadResponse
from .team_business_schemas import TeamDirectoryItemResponse, TeamProcessingTaskResponse


class RouteStepResponse(ReadResponse):
    sequence_no: int
    name: str
    instructions: str
    planned_days: str
    planned_quantity: str
    team_id: int | None
    team_name: str | None = None
    processing_task_id: int | None = None
    purpose_id: int | None = None
    serial_nos: list[str]
    split_here: bool
    source_row: str | None = None


class RouteDrawingResponse(ReadResponse):
    id: int
    filename: str
    size_bytes: int
    sha256: str


class RouteMaterialFieldResponse(ReadResponse):
    value: str | int | float
    label: str
    source_row: str
    source_label: str
    source_kind: Literal["word", "excel", "manual"] | None = None
    source_filename: str | None = None
    parsed_value: str | int | float | None = None
    alternative: "RouteMaterialFieldResponse | None" = None


class RouteOrderDocumentResponse(ReadResponse):
    filename: str
    sheet: str
    headers: list[str]
    values: list[str]
    display_values: list[str] | None = None
    serial_no: str
    receipt_fields: dict[str, RouteMaterialFieldResponse]
    warnings: list[str]


class MaterialConfirmationResponse(ReadResponse):
    fingerprint: str
    by: str
    at: str


class RouteSourceDataResponse(ReadResponse):
    tables: list[list[list[str]]]
    issues: list[str]
    original_steps: list[RouteStepResponse] | None = None
    receipt_fields: dict[str, RouteMaterialFieldResponse] | None = None
    word_fields: dict[str, RouteMaterialFieldResponse] | None = None
    order_document: RouteOrderDocumentResponse | None = None
    review_required: bool | None = None
    material_confirmation: MaterialConfirmationResponse | None = None
    field_warnings: list[str] | None = None


class ReworkProblemTeamResponse(ReadResponse):
    id: int
    name: str


class ReworkRequestResponse(ReadResponse):
    source_transfer_id: int
    batch_no: str
    team_id: int
    team_name: str
    quantity: int
    weight: float
    reason: str
    requesting_team_id: int | None
    requesting_team_name: str | None
    requested_by: str | None
    rework_of_id: int
    original_schedule_id: int | None
    original_task_id: int | None
    inspection_id: int | None
    inspection_kind: Literal["patrol", "inspection"] | None
    inspector_name: str | None
    problem_names: list[str]
    problem_notes: str
    dimension_result: str
    weight_result: str
    problem_teams: list[ReworkProblemTeamResponse]
    execution_team_names: list[str]
    round: int
    resume_route_id: int | None
    resume_step_index: int | None
    resume_step_name: str | None
    resume_team_id: int
    can_modify: bool | None = None


class ReworkInspectionResponse(ReadResponse):
    id: int
    batch_no: str
    scope: Literal["sample", "full"]
    sample_quantity: int
    failed_quantity: int
    inspector_name: str
    checked_at: str


class ReworkProgressResponse(ReadResponse):
    quantity: int
    completed_quantity: int
    passed_quantity: int
    state: Literal["awaiting_route", "processing", "awaiting_inspection", "passed", "failed"]
    inspections: list[ReworkInspectionResponse]


class ProcessRouteMetadataResponse(ReadResponse):
    id: int
    title: str
    route_kind: Literal["normal", "rework"]
    missing_documents: list[str]
    rework_request: ReworkRequestResponse | None
    filename: str
    state: Literal["draft", "published"]
    version: int
    parent_id: int | None
    serial_nos: list[str]
    created_by: str
    created_by_user_id: int | None
    engineering_employee_id: int | None
    engineering_employee_name: str | None
    modified_employee_id: int | None
    modified_employee_name: str | None
    created_at: str
    updated_at: str | None
    published_at: str | None


class RouteExecutionLabelsResponse(ReadResponse):
    tasks: dict[int, str]
    purposes: dict[int, str]


class ProcessRouteDetailResponse(ProcessRouteMetadataResponse):
    steps: list[RouteStepResponse]
    source_data: RouteSourceDataResponse
    review_note: str | None
    source_sha256: str
    execution_labels: RouteExecutionLabelsResponse
    drawings: list[RouteDrawingResponse]


class RouteStepSummaryResponse(ReadResponse):
    sequence_no: int
    name: str
    team_id: int | None


class ProcessRouteSummaryResponse(ProcessRouteMetadataResponse):
    material_name: str
    step_summary: list[RouteStepSummaryResponse]
    drawings: list[RouteDrawingResponse]
    rework_batch_no: str | None = None
    rework_quantity: int | None = None
    rework_weight: float | None = None
    rework_progress: ReworkProgressResponse | None = None


class ProcessRoutePageResponse(PageResponse[ProcessRouteSummaryResponse]):
    pending_rework_count: int
    enforced_after: str | None


class ProcessRouteParseResponse(ReadResponse):
    title: str
    filename: str
    serial_nos: list[str]
    steps: list[RouteStepResponse]
    source_data: RouteSourceDataResponse


class RouteExecutionContextResponse(ReadResponse):
    can_resume: bool
    id: int
    route_kind: Literal["normal", "rework"]
    execution_serial: str | None
    rework_of_id: int | None
    title: str
    version: int
    step_index: int
    sequence_no: int
    step_name: str
    instructions: str
    team_id: int
    processing_task_id: int | None
    purpose_id: int | None
    complete: bool
    split_here: bool
    next_team_id: int | None
    next_purpose_id: int | None
    available: bool | None = None


class LotRouteResponse(ReadResponse):
    current: RouteExecutionContextResponse | None
    route: ProcessRouteDetailResponse | None


class ReworkRoundResponse(ReadResponse):
    route_id: int
    state: Literal["draft", "published"]
    engineering_employee_name: str | None
    request: ReworkRequestResponse
    progress: ReworkProgressResponse
    steps: list[RouteStepResponse]


class RouteExecutionOptionsResponse(ReadResponse):
    tasks: list[TeamProcessingTaskResponse]
    purposes: list[TeamDirectoryItemResponse]


class BoundRouteResponse(ReadResponse):
    bound: int
    route_id: int


class RouteDispatchOrderResponse(ReadResponse):
    task_id: int
    document: RouteOrderDocumentResponse
