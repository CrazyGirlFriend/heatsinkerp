"""Historical serial urgency response contract."""

from pydantic import BaseModel, ConfigDict


class UrgencyResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    urgent: bool
    reason: str | None
    version: int
    updated_by: str | None
    updated_at: str | None
