"""Read-only company-system adapter. Never accepts a URL or credential from a client."""
from __future__ import annotations

import hashlib
import json
import socket
from http.client import HTTPException as HTTPTransportError
from typing import Literal
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
from uuid import uuid4

from fastapi import HTTPException
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, ValidationError, model_validator

from .config import settings
from .schemas import MaterialTransferDocumentFields


class MainSystemDocument(MaterialTransferDocumentFields):
    model_config = ConfigDict(extra="forbid", strict=True,
                              json_schema_extra={"required": list(MaterialTransferDocumentFields.model_fields)})
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
            raise ValueError("serial_no and revision must be nonblank; serial_no must not have outer spaces")
        return self


class MainSystemLookup(MainSystemSerial):
    snapshot_hash: str


def snapshot_hash(record: MainSystemSerial) -> str:
    value = record.model_dump(mode="json")
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     separators=(",", ":")).encode()).hexdigest()


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def fetch_serial(serial_no: str, *, connection=None) -> MainSystemSerial:
    from .main_system_configuration import effective_settings
    connection = connection or effective_settings(settings)
    if not connection.main_system_base_url:
        raise HTTPException(503, "main system integration is not configured")
    url = connection.main_system_base_url + "/api/integration/v1/serial-materials?" + urlencode({"serial_no": serial_no})
    request = Request(url, headers={
        "Authorization": "Bearer " + connection.main_system_token,
        "Accept": "application/json", "X-Request-ID": str(uuid4()),
    })
    # Credentials only go to the configured origin, never to redirected hosts
    # or environment-configured proxies. Default HTTPS certificate validation stays on.
    opener = build_opener(ProxyHandler({}), NoRedirects())
    try:
        with opener.open(request, timeout=connection.main_system_timeout_seconds) as response:
            if response.status != 200 or response.headers.get_content_type() != "application/json":
                raise HTTPException(502, "main system returned an invalid response")
            raw = response.read(65_537)
            if len(raw) > 65_536:
                raise HTTPException(502, "main system response exceeds 64 KiB")
    except HTTPError as exc:
        status = exc.code
        exc.close()
        if status == 404:
            raise HTTPException(404, "serial number not found in main system") from None
        if status == 401:
            raise HTTPException(502, "main system credentials were rejected") from None
        if status == 403:
            raise HTTPException(502, "main system credentials lack read permission") from None
        if status == 429:
            raise HTTPException(503, "main system is busy; retry later") from None
        # Never reflect upstream HTML, URLs or auth diagnostics into the browser.
        raise HTTPException(502, "main system request failed") from None
    except (TimeoutError, socket.timeout):
        raise HTTPException(504, "main system request timed out") from None
    except URLError as exc:
        if isinstance(exc.reason, (TimeoutError, socket.timeout)):
            raise HTTPException(504, "main system request timed out") from None
        raise HTTPException(502, "main system is unavailable") from None
    except (OSError, HTTPTransportError):
        raise HTTPException(502, "main system connection failed") from None
    try:
        record = MainSystemSerial.model_validate_json(raw)
    except (ValidationError, ValueError):
        raise HTTPException(502, "main system response does not match the serial-material contract") from None
    if record.serial_no != serial_no:
        raise HTTPException(502, "main system returned a different serial number")
    return record
