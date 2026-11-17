"""Health contract for the live data refresh transport."""

from typing import Literal

from .read_schemas import ReadResponse


class NotificationStatusResponse(ReadResponse):
    connection: Literal["connected", "reconnecting"]
    pending: int
    oldest_pending_seconds: int
