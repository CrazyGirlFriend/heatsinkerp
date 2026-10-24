"""Shared route-review contracts for draft editing and first warehouse intake."""

from pydantic import BaseModel, ConfigDict, Field, field_validator


class StepWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sequence_no: int = Field(ge=0, le=999)
    name: str = Field(max_length=120)
    instructions: str = Field(max_length=10000)
    planned_days: str = Field(default="", max_length=80)
    planned_quantity: str = Field(default="", max_length=80)
    team_id: int | None = Field(default=None, ge=1)
    processing_task_id: int | None = Field(default=None, ge=1)
    purpose_id: int | None = Field(default=None, ge=1)
    serial_nos: list[str] = Field(default_factory=list, max_length=30)
    split_here: bool = False
    source_row: str | None = Field(default=None, max_length=30)
    team_name: str | None = Field(default=None, max_length=120)


class RouteWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=160)
    serial_nos: list[str] = Field(min_length=1, max_length=30)
    steps: list[StepWrite] = Field(min_length=1, max_length=100)
    review_note: str = Field(default="", max_length=2000)
    version: int = Field(ge=1)

    @field_validator("title")
    @classmethod
    def title_nonblank(cls, value):
        if not value.strip():
            raise ValueError("请填写派工名称")
        return value.strip()

    @field_validator("serial_nos")
    @classmethod
    def serials(cls, value):
        result = [item.strip() for item in value]
        if any(not item or len(item) > 80 for item in result) or len(
            set(item.casefold() for item in result)
        ) != len(result):
            raise ValueError("流水号须唯一且不超过80字")
        return result


class RouteIntakeWrite(RouteWrite):
    id: int = Field(ge=1)
