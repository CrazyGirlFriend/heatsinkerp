"""Processing history and form context share the same recorded-work contract."""

from datetime import datetime
from typing import Literal

from .process_route_read_schemas import RouteExecutionContextResponse
from .read_schemas import PageResponse, ReadResponse, SharedMaterialResponse
from .schedule_read_schemas import ScheduleResponse
from .stock_read_schemas import ProcessingState


class ProcessingOutputResponse(ReadResponse):
    id: int
    batch_no: str
    serial_no: str | None = None
    shared_unallocated: bool = False
    role: Literal["remaining", "produced", "scrap"]
    quantity: int
    weight: float
    material_type: str
    transfer_specification: str | None
    sludge_gross_weight: float | None = None
    sludge_content_percent: float | None = None
    on_hand_quantity: int | None = None
    on_hand_weight: float | None = None
    in_transit_quantity: int | None = None
    in_transit_weight: float | None = None
    owned_quantity: int | None = None
    owned_weight: float | None = None


class QuantityAdjustmentResponse(ReadResponse):
    id: int
    source_transfer_id: int
    production_schedule_id: int | None
    process_route_id: int | None
    process_step_index: int | None
    process_step_name: str | None
    process_step_instructions: str | None
    before_quantity: int
    after_quantity: int
    delta_quantity: int
    weight: float
    reason: str
    processor_name: str | None
    processor_employee_id: int | None
    processing_task_id: int | None
    processing_task_name: str | None
    purpose_id: int | None
    purpose_name: str | None
    processing_date: str | None
    processing_mode: Literal["unit", "split"] | None
    work_kind: Literal["initial", "rework"]
    rework_of_id: int | None
    rework_round: int
    input_quantity: int | None
    input_weight: float | None
    completed_quantity: int | None
    completed_weight: float | None
    scrap_quantity: int | None
    scrap_weight: float | None
    operation_kind: Literal["outbound_clearance", "processing"]
    processing_status: Literal["partial", "complete"] | None
    before_specification: str | None
    after_specification: str | None
    after_weight: float | None
    outputs: list[ProcessingOutputResponse] | None
    created_by: str
    created_at: datetime


class ReworkTaskRecordResponse(ReadResponse):
    rework_of_id: int
    process_route_id: int | None = None
    process_step_index: int | None = None
    process_step_name: str | None
    process_step_instructions: str | None = None
    processing_task_id: int | None = None
    processing_task_name: str | None
    purpose_id: int | None = None
    purpose_name: str | None = None


class ReworkInspectionReference(ReadResponse):
    id: int
    kind: Literal["patrol", "inspection"]
    checked_at: datetime


class QuantityAdjustmentContextResponse(
    PageResponse[QuantityAdjustmentResponse], SharedMaterialResponse
):
    rework_inspections: list[ReworkInspectionReference]
    process_route: RouteExecutionContextResponse | None
    processing_schedules: list[ScheduleResponse]
    production_schedule_id: int | None
    production_schedule_locked: bool
    source_transfer_id: int
    batch_no: str
    serial_no: str
    material_name: str | None
    material_type: str | None
    purpose_name: str | None
    purpose_id: int | None
    task_required: bool
    completed_task_ids: list[int]
    allowed_task_ids: list[int]
    rework_task_records: list[ReworkTaskRecordResponse]
    quantity: int
    weight: float
    processing_status: Literal["partial", "complete"] | None
    processor_options: list[str]
    processing_mode: Literal["unit", "split"]
    origin_processing_record: QuantityAdjustmentResponse | None
    rework_of_id: int | None
    rework_route_id: int | None
    rework_round: int | None
    rework_route_ready: bool
    rework_pending: bool
    rework_count: int
    weight_root_transfer_id: int | None = None
    weight_difference: float | None = None
    transfer_specification: str | None
    revision: int
    as_of: datetime


class ProcessingRecordResponse(QuantityAdjustmentResponse, SharedMaterialResponse):
    serial_no: str
    batch_no: str
    material_name: str | None
    material_type: str | None
    on_hand_quantity: int
    on_hand_weight: float
    in_transit_quantity: int
    in_transit_weight: float
    owned_quantity: int
    owned_weight: float
    processing_state: ProcessingState


class RecordedWorkMetricsResponse(ReadResponse):
    record_count: int
    input_quantity: int
    input_weight: float
    completed_quantity: int
    completed_weight: float
    scrap_quantity: int
    scrap_weight: float
    rework_quantity: int
    rework_weight: float
    rework_record_count: int
    work_quantity: int
    work_weight: float


class ProcessingDailyResponse(RecordedWorkMetricsResponse):
    team_id: int
    team_name: str
    processing_date: str
    processor_employee_id: int
    processor_name: str
    processing_mode: Literal["unit", "split"]
    process_route_id: int | None
    process_step_index: int | None
    process_step_name: str | None
    processing_task_id: int | None
    processing_task_name: str | None
    purpose_id: int | None
    purpose_name: str | None


class ProcessingSummaryResponse(RecordedWorkMetricsResponse):
    employee_day_count: int
    daily_group_count: int
    unreported_count: int


class ProcessingFilterOptionResponse(ReadResponse):
    id: int
    name: str | None


class ProcessingRecordPageResponse(PageResponse[ProcessingRecordResponse]):
    summary: ProcessingSummaryResponse
    processors: list[ProcessingFilterOptionResponse]
    processing_tasks: list[ProcessingFilterOptionResponse]
    as_of: datetime
