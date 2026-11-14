"""Notification contracts shared by inboxes and their business destinations."""

from typing import Literal

from pydantic import BaseModel, Field

from .process_route_read_schemas import ProcessRouteDetailResponse
from .read_schemas import PageResponse, ReadResponse

NoticeSource = Literal["schedule", "rework", "transfer", "quality"]
ScheduleNoticeKind = Literal[
    "new",
    "changed",
    "cancelled",
    "upstream",
    "final_due",
    "due_soon",
    "overdue",
    "returned",
    "locked",
    "unlocked",
]
ReworkNoticeKind = Literal["requested", "ready"]
TransferNoticeKind = Literal[
    "amendment_requested", "amendment_approved", "amendment_rejected", "amendment_cancelled"
]


class BusinessNoticeReadAll(BaseModel):
    schedule: int = Field(ge=0)
    rework: int = Field(ge=0)
    transfer: int = Field(default=0, ge=0)
    quality: int = Field(default=0, ge=0)


class ScheduleNoticeReadAll(BaseModel):
    through_id: int = Field(ge=0)


class NoticeMessageResponse(ReadResponse):
    id: int
    message: str
    serial_no: str
    team_name: str
    created_at: str
    read_at: str | None


class BusinessNoticeResponse(NoticeMessageResponse):
    source: NoticeSource
    kind: ScheduleNoticeKind | ReworkNoticeKind | TransferNoticeKind | Literal["quality_reported"]
    batch_no: str | None
    amendment_id: int | None = None
    amendment_status: Literal["pending", "approved", "rejected", "cancelled"] | None = None
    action_required: bool | None = None


class NoticeCursorsResponse(ReadResponse):
    schedule: int
    rework: int
    transfer: int
    quality: int


class BusinessNoticePageResponse(ReadResponse):
    items: list[BusinessNoticeResponse]
    total: int
    unread: int
    latest: NoticeCursorsResponse


class NoticeTargetResponse(ReadResponse):
    href: str
    section: Literal["problem", "steps", "amendment", "quality"] | None
    amendment_id: int | None = None
    schedule_id: int | None = None
    event_id: int | None = None
    batch_id: int | None = None
    step_index: int | None = None
    route: ProcessRouteDetailResponse | None = None


class ScheduleNoticeResponse(NoticeMessageResponse):
    kind: ScheduleNoticeKind
    href: str


class ScheduleNoticePageResponse(ReadResponse):
    items: list[ScheduleNoticeResponse]
    total: int
    unread: int
    latest_id: int


class ReworkNoticeResponse(ReadResponse):
    id: int
    kind: ReworkNoticeKind
    route_id: int
    state: Literal["draft", "published"]
    serial_no: str
    batch_no: str
    problem: str | None
    submitting_team: str
    submitted_by: str | None
    engineering_employee_name: str | None
    created_at: str
    read_at: str | None


class ReworkNoticePageResponse(PageResponse[ReworkNoticeResponse]):
    unread: int


class NoticeReadResponse(ReadResponse):
    read_at: str


class NotificationStatusResponse(ReadResponse):
    connection: Literal["connected", "reconnecting"]
    pending: int
    oldest_pending_seconds: int
