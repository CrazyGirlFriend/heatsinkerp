"""Responses for the shared employee, processing-task and problem directories."""

from pydantic import BaseModel, ConfigDict


class TeamDirectoryItemResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: int
    team_id: int
    name: str
    active: bool
    version: int


class TeamProcessingTaskResponse(TeamDirectoryItemResponse):
    purpose_id: int | None


class OpeningAuthorizationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool
