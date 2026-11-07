"""Administrative serial urgency request and response contracts."""

from pydantic import BaseModel, ConfigDict, Field


class UrgencyUpdate(BaseModel):
    serial_no: str = Field(min_length=1, max_length=80)
    urgent: bool
    reason: str | None = Field(default=None, max_length=500)
    expected_version: int = Field(ge=0)


class UrgencyResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    urgent: bool
    reason: str | None
    version: int
    updated_by: str | None
    updated_at: str | None
