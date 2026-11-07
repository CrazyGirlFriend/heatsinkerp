"""Direct rework source selection and return to the normal route."""

from .analytics_read_schemas import AmountResponse
from .process_route_read_schemas import RouteExecutionContextResponse
from .read_schemas import ReadResponse


class ReworkSourceResponse(AmountResponse):
    id: int
    serial_no: str
    batch_no: str


class ReworkResumeResponse(ReadResponse):
    current: RouteExecutionContextResponse | None
