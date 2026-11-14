"""Delivery read contracts. Dates and progress come from the existing query services."""

from typing import Literal

from pydantic import JsonValue

from .process_route_read_schemas import RouteOrderDocumentResponse, RouteStepResponse
from .read_schemas import PageResponse, ReadResponse

ScheduleStatus = Literal[
    "pending", "today", "overdue", "completed", "completed_late", "cancelled", "not_assessed"
]
CompletionBasis = Literal["quantity", "weight", "both"]
PlanningState = Literal["pending", "submitted", "revision_pending", "confirmed"]


class CustomerDeliveryBatchResponse(ReadResponse):
    batch_number: int
    due_at: str
    target_quantity: int


class ScheduleSourceResponse(ReadResponse):
    source_transfer_id: int
    batch_no: str
    material_name: str
    quantity: int | None
    weight: float | None


class ScheduleBatchProposalResponse(ReadResponse):
    id: int | None = None
    batch_number: int
    due_at: str
    target_quantity: int | None
    # Pending proposals retain JSON-mode decimal strings until confirmed.
    target_weight: str | float | None
    upstream_batch_ids: list[int]
    planned_start_at: str | None = None


class ScheduleBatchResponse(ReadResponse):
    id: int
    batch_number: int
    planned_start_at: str | None
    due_at: str
    target_quantity: int | None
    target_weight: float | None
    upstream_batch_ids: list[int]
    status: ScheduleStatus
    warnings: list[str]
    dispatched_quantity: int
    dispatched_weight: float
    received_quantity: int
    received_weight: float
    completed_at: str | None


class ScheduleStockResponse(ReadResponse):
    on_hand_quantity: int
    on_hand_weight: float
    pending_quantity: int
    pending_weight: float
    batch_count: int
    rework_quantity: int


class ScheduleLinkedBatchResponse(ReadResponse):
    source_transfer_id: int
    batch_no: str
    material_name: str
    quantity: int
    weight: float
    received_at: str | None
    status: str


class ScheduleRouteLinkResponse(ReadResponse):
    state: Literal["unlinked", "linked", "changed"]
    latest_route_id: int | None


class ScheduleDeliveryResponse(ReadResponse):
    id: int
    schedule_batch_id: int | None
    batch_no: str
    source_transfer_id: int | None
    quantity: int
    weight: float
    status: str
    counts_toward_delivery: bool
    transferred_at: str | None
    received_at: str | None


class ScheduleEventResponse(ReadResponse):
    id: int
    action: str
    actor: str
    occurred_at: str
    # Historical snapshots are versioned business documents, not current write payloads.
    before: dict[str, JsonValue] | None
    after: dict[str, JsonValue] | None


class ScheduleResponse(ReadResponse):
    id: int
    task_id: int
    task_no: str
    task_title: str
    process_route_id: int | None
    process_step_index: int | None
    serial_no: str
    team_id: int
    next_team_id: int | None
    external_destination: str | None
    predecessor_id: int | None
    sequence_no: int
    due_at: str
    target_quantity: int | None
    target_weight: float | None
    completion_basis: CompletionBasis
    notes: str | None
    planned_start_at: str | None
    team_name: str
    assessment_enabled: bool
    initial_due_at: str
    batches: list[ScheduleBatchResponse]
    planning_state: PlanningState
    pending_batches: list[ScheduleBatchProposalResponse] | None
    order_locked: bool
    delivery_batches: list[CustomerDeliveryBatchResponse]
    final_due_at: str | None
    next_team_name: str | None
    version: int
    cancelled_at: str | None
    created_at: str
    updated_at: str
    completed_at: str | None
    status: ScheduleStatus
    processed_quantity: int
    dispatched_quantity: int
    dispatched_weight: float
    received_quantity: int
    received_weight: float
    remaining_quantity: int | None
    remaining_weight: float | None
    sources: list[ScheduleSourceResponse]
    linked_batches: list[ScheduleLinkedBatchResponse]
    linked_batch_count: int
    material_name: str | None
    stock: ScheduleStockResponse
    quality_held: bool
    execution_state: Literal[
        "cancelled",
        "completed",
        "stock_dispatched",
        "partial",
        "ready",
        "pending_receipt",
        "waiting_material",
    ]
    route_link: ScheduleRouteLinkResponse | None = None


class ScheduleDetailResponse(ScheduleResponse):
    deliveries: list[ScheduleDeliveryResponse]
    history: list[ScheduleEventResponse]


class SchedulePersonResponse(ReadResponse):
    id: int
    name: str


class BusinessPersonResponse(SchedulePersonResponse):
    active: bool
    version: int


class ScheduleLocationResponse(ReadResponse):
    team_id: int
    team_name: str
    quantity: int
    weight: float
    pending_quantity: int
    pending_weight: float
    batch_count: int
    quality_held: bool


class ScheduleReworkResponse(ReadResponse):
    route_id: int
    route_version: int
    schedule_id: int
    batch_no: str
    problem: str
    quantity: int
    completed_quantity: int
    state: Literal["awaiting_route", "processing", "processed"]


class ScheduleTaskResponse(ReadResponse):
    id: int
    task_no: str
    title: str
    serial_no: str
    business_person_id: int | None
    business_person_name: str | None
    business_people: list[SchedulePersonResponse]
    notes: str | None
    delivery_batches: list[CustomerDeliveryBatchResponse]
    locked_at: str | None
    cancelled_at: str | None
    version: int
    created_at: str
    updated_at: str
    final_due_at: str | None
    status: ScheduleStatus
    nodes: list[ScheduleResponse]
    locations: list[ScheduleLocationResponse]
    shared_source: bool
    reworks: list[ScheduleReworkResponse]
    route_changed: bool


class ScheduleTaskDetailResponse(ScheduleTaskResponse):
    order_document: RouteOrderDocumentResponse | None


class ScheduleShipmentResponse(ReadResponse):
    id: int
    batch_no: str
    team_name: str | None
    quantity: int
    weight: float
    shipped_at: str | None


class ScheduleSerialProgressResponse(ReadResponse):
    serial_no: str
    tasks: list[ScheduleTaskResponse]
    planned_quantity: int | None
    shipped_quantity: int
    shipped_weight: float
    last_shipped_at: str | None
    shipment_count: int
    shipments: list[ScheduleShipmentResponse]


class SchedulePeriodResponse(ReadResponse):
    completed: int
    completed_late: int
    overdue: int


class ScheduleOverviewResponse(ReadResponse):
    as_of: str
    date_from: str
    date_to: str
    period: SchedulePeriodResponse
    assessed_count: int
    on_time_rate: float | None
    overdue_count: int
    today_count: int
    attention: list[ScheduleResponse]


class ScheduleSourceOptionResponse(ReadResponse):
    source_transfer_id: int
    batch_no: str
    serial_no: str
    material_name: str
    material_type: str
    quantity: int
    weight: float
    on_hand_quantity: int
    on_hand_weight: float
    received_at: str | None


class ScheduleCandidateResponse(ReadResponse):
    source_transfer_id: int
    schedules: list[ScheduleResponse]


class ScheduleCandidatesResponse(ReadResponse):
    items: list[ScheduleCandidateResponse]


class InventoryScheduleSummaryResponse(ReadResponse):
    applicable: bool
    count: int
    due_at: str | None
    status: ScheduleStatus | Literal["unplanned", "not_applicable"]
    overdue_count: int
    items: list[ScheduleResponse]
    items_truncated: bool


class InventoryGroupSchedulesResponse(InventoryScheduleSummaryResponse):
    group_id: int


class InventorySourceSchedulesResponse(InventoryScheduleSummaryResponse):
    source_transfer_id: int


class InventorySchedulesResponse(ReadResponse):
    groups: list[InventoryGroupSchedulesResponse]
    sources: list[InventorySourceSchedulesResponse]


class ScheduleSerialOptionResponse(ReadResponse):
    serial_no: str
    task_count: int


class ScheduleRouteOptionResponse(ReadResponse):
    id: int
    title: str
    version: int
    steps: list[RouteStepResponse]
    serial_nos: list[str]
    execution_serial: str | None
    published_at: str


class ReworkScheduleOptionResponse(ReadResponse):
    id: int
    team_name: str
    due_at: str


class ScheduleReworkOptionResponse(ReadResponse):
    route_id: int
    route_version: int
    problem: str
    batch_no: str
    plans: list[ReworkScheduleOptionResponse]


SchedulePageResponse = PageResponse[ScheduleResponse]
ScheduleTaskPageResponse = PageResponse[ScheduleTaskResponse]
ScheduleSourcePageResponse = PageResponse[ScheduleSourceOptionResponse]
ScheduleSerialPageResponse = PageResponse[ScheduleSerialOptionResponse]
BusinessPersonPageResponse = PageResponse[BusinessPersonResponse]
