"""Shared safe HTTP client for verification scripts; no legacy business checks."""
from __future__ import annotations
import copy
import json
from dataclasses import dataclass
from email.message import Message
from http.cookiejar import CookieJar
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPCookieProcessor, HTTPRedirectHandler, ProxyHandler, Request, build_opener

MAX_RESPONSE_BYTES = 4 * 1024 * 1024


class SmokeFailure(Exception):
    """Only fixed, non-sensitive diagnostics may be included in this exception."""


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


@dataclass
class ApiResponse:
    status: int
    headers: Message
    body: Any


class ApiClient:
    def __init__(self, base_url: str, *, timeout: float = 15.0):
        self.base_url = base_url
        self.timeout = timeout
        self.cookies = CookieJar()
        self.opener = build_opener(
            ProxyHandler({}), NoRedirects(), HTTPCookieProcessor(self.cookies)
        )

    def clone_cookies(self) -> ApiClient:
        clone = ApiClient(self.base_url, timeout=self.timeout)
        for cookie in self.cookies:
            clone.cookies.set_cookie(copy.copy(cookie))
        return clone

    def request(
        self,
        method: str,
        path: str,
        *,
        payload: dict[str, Any] | None = None,
        bearer: str | None = None,
    ) -> ApiResponse:
        headers = {"Accept": "application/json", "Cache-Control": "no-cache"}
        body = None
        if payload is not None:
            headers["Content-Type"] = "application/json"
            body = json.dumps(payload).encode("utf-8")
        if bearer:
            headers["Authorization"] = f"Bearer {bearer}"
        request = Request(self.base_url + path, data=body, headers=headers, method=method)
        try:
            try:
                response = self.opener.open(request, timeout=self.timeout)
            except HTTPError as error:
                response = error
            with response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
                if len(raw) > MAX_RESPONSE_BYTES:
                    raise SmokeFailure("API response exceeded the safety size limit")
                try:
                    parsed = json.loads(raw) if raw else None
                except (ValueError, UnicodeError):
                    parsed = None
                return ApiResponse(response.code, response.headers, parsed)
        except (URLError, OSError, TimeoutError):
            raise SmokeFailure("Network request failed; check connectivity and TLS") from None


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SmokeFailure(message)


def expect_status(response: ApiResponse, expected: int, label: str) -> None:
    require(
        response.status == expected,
        f"{label}: expected HTTP {expected}, received HTTP {response.status}",
    )


def validate_base_url(value: str) -> str:
    try:
        parsed = urlsplit(value)
        require(parsed.scheme in {"http", "https"}, "Base URL must use HTTP or HTTPS")
        require(bool(parsed.hostname), "Base URL must include a hostname")
        require(parsed.username is None and parsed.password is None, "Base URL cannot contain credentials")
        require(not parsed.query and not parsed.fragment, "Base URL cannot contain a query or fragment")
        require(parsed.path in {"", "/"}, "Base URL must refer to the site root")
        require(not any(ord(char) <= 32 or ord(char) == 127 for char in value), "Base URL contains invalid characters")
        # Accessing port also validates malformed or out-of-range port values.
        parsed.port
    except ValueError:
        raise SmokeFailure("Base URL is invalid") from None
    return value.rstrip("/")
