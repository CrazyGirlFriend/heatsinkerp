"""External serial input and public integration-settings contracts."""

from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator

from .read_schemas import ReadResponse
from .schemas import MaterialDocumentFields


class MainSystemDocument(MaterialDocumentFields):
    model_config = ConfigDict(
        extra="forbid",
        strict=True,
        json_schema_extra={"required": list(MaterialDocumentFields.model_fields)},
    )
    material_name: str = Field(min_length=1, max_length=160)

    @model_validator(mode="after")
    def complete_snapshot(self):
        # Missing keys are not the same as explicitly unknown (null) values.
        if set(type(self).model_fields) != self.model_fields_set:
            raise ValueError("all document keys must be present; use null for unknown values")
        if not self.material_name:
            raise ValueError("material_name cannot be blank")
        return self


class MainSystemSerial(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    schema_version: Literal["1.0"]
    serial_no: str = Field(min_length=1, max_length=80, strict=True)
    revision: str = Field(min_length=1, max_length=100, strict=True)
    updated_at: AwareDatetime
    active: bool = Field(strict=True)
    document: MainSystemDocument

    @model_validator(mode="after")
    def nonblank_identity(self):
        if self.serial_no != self.serial_no.strip() or not self.revision.strip():
            raise ValueError(
                "serial_no and revision must be nonblank; serial_no must not have outer spaces"
            )
        return self


class MainSystemLookup(MainSystemSerial):
    snapshot_hash: str


class ConfigurationSave(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = Field(strict=True)
    base_url: str = Field(max_length=500)
    token: str = Field(default="", max_length=4096, repr=False)
    timeout_seconds: float = Field(ge=0.1, le=30, multiple_of=0.1)
    expected_version: int = Field(ge=0)

    @field_validator("base_url")
    @classmethod
    def clean_url(cls, value):
        return value.strip().rstrip("/")


class ConfigurationTest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    serial_no: str = Field(min_length=1, max_length=80)
    expected_version: int = Field(ge=0)


class MainSystemConfigurationResponse(ReadResponse):
    enabled: bool
    base_url: str
    timeout_seconds: float
    has_token: bool
    version: int
    source: Literal["database", "environment"]
    key_ready: bool
    allowed_origins: list[str]
    updated_by: str | None
    updated_at: str | None
    last_test_at: str | None
    last_test_ok: bool | None
    last_test_message: str | None


class MainSystemLookupResponse(ReadResponse):
    schema_version: Literal["1.0"]
    serial_no: str
    revision: str
    updated_at: str
    active: bool
    document: MainSystemDocument
    snapshot_hash: str


class ConfigurationTestResponse(ReadResponse):
    ok: bool
    message: str
    tested_at: str
    data: MainSystemLookupResponse | None
