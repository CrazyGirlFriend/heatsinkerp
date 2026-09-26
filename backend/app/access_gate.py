"""An optional server-enforced shared access gate in front of account login."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import secrets
import time
from collections import OrderedDict
from threading import Lock

from fastapi import APIRouter, Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from .config import Settings


ACCESS_COOKIE_NAME = "heatsink_site_access"
ACCESS_TTL_SECONDS = 12 * 60 * 60
ACCESS_EXEMPT_PATHS = frozenset(
    {"/api/access/status", "/api/access/unlock", "/api/access/lock", "/health", "/api/health"}
)
NO_STORE_HEADERS = {"Cache-Control": "no-store"}
MAX_UNLOCK_BODY_BYTES = 4096


class UnlockRateLimiter:
    """Bounded, process-local attempt limits; never trusts forwarded IP headers.

    A successful unlock resets that client's failures. A separate overall limit
    caps both memory use and attempts from a large number of different clients.
    Multiple application workers would each have their own limits.
    """

    def __init__(
        self,
        *,
        attempts_per_client: int = 10,
        window_seconds: int = 300,
        global_attempts: int = 300,
        max_clients: int = 4096,
    ) -> None:
        self.attempts_per_client = attempts_per_client
        self.window_seconds = window_seconds
        self.global_attempts = global_attempts
        self.max_clients = max_clients
        self._clients: OrderedDict[str, tuple[float, int]] = OrderedDict()
        self._global_started_at: float | None = None
        self._global_count = 0
        self._lock = Lock()

    def reserve(self, client: str) -> int | None:
        """Reserve an attempt or return the number of seconds until retry."""
        now = time.monotonic()
        with self._lock:
            while self._clients:
                _, (started_at, _) = next(iter(self._clients.items()))
                if started_at + self.window_seconds > now:
                    break
                self._clients.popitem(last=False)

            if (
                self._global_started_at is None
                or self._global_started_at + self.window_seconds <= now
            ):
                self._global_started_at = now
                self._global_count = 0
            if self._global_count >= self.global_attempts:
                return max(1, math.ceil(self._global_started_at + self.window_seconds - now))

            existing = self._clients.get(client)
            if existing is None:
                if len(self._clients) >= self.max_clients:
                    oldest_started_at = next(iter(self._clients.values()))[0]
                    return max(1, math.ceil(oldest_started_at + self.window_seconds - now))
                existing = (now, 0)
            started_at, count = existing
            if count >= self.attempts_per_client:
                return max(1, math.ceil(started_at + self.window_seconds - now))

            self._clients[client] = (started_at, count + 1)
            self._global_count += 1
        return None

    def clear_client(self, client: str) -> None:
        with self._lock:
            self._clients.pop(client, None)


class SiteAccessGate:
    def __init__(self, config: Settings) -> None:
        self.enabled = bool(config.site_access_password)
        self.secure_cookie = config.site_access_secure_cookie
        self._password_digest = hashlib.sha256(
            config.site_access_password.encode("utf-8")
        ).digest()
        # Bind issued cookies to BOTH configuration values. Rotating either
        # password or signing secret invalidates every previously issued cookie.
        self._signing_key = hmac.digest(
            config.site_access_secret.encode("utf-8"),
            b"heatsink:site-access:key:v1\0" + config.site_access_password.encode("utf-8"),
            "sha256",
        )
        self.limiter = UnlockRateLimiter()

    def matches_password(self, password: str) -> bool:
        actual = hashlib.sha256(password.encode("utf-8")).digest()
        return hmac.compare_digest(actual, self._password_digest)

    def _signature(self, payload: str) -> str:
        return base64.urlsafe_b64encode(
            hmac.digest(self._signing_key, payload.encode("ascii"), "sha256")
        ).decode("ascii").rstrip("=")

    def issue_cookie(self) -> str:
        issued_at = int(time.time())
        payload = ".".join(
            (
                "v1",
                str(issued_at),
                str(issued_at + ACCESS_TTL_SECONDS),
                secrets.token_urlsafe(16),
            )
        )
        return f"{payload}.{self._signature(payload)}"

    def is_unlocked(self, request: Request) -> bool:
        if not self.enabled:
            return True
        token = request.cookies.get(ACCESS_COOKIE_NAME)
        if not token or len(token) > 512:
            return False
        try:
            version, issued_value, expires_value, nonce, signature = token.split(".")
            issued_at, expires_at = int(issued_value), int(expires_value)
            payload = f"{version}.{issued_value}.{expires_value}.{nonce}"
            if version != "v1" or not nonce:
                return False
            if not hmac.compare_digest(signature, self._signature(payload)):
                return False
        except (ValueError, TypeError, UnicodeError):
            return False
        now = int(time.time())
        return (
            0 <= issued_at <= now
            and expires_at - issued_at == ACCESS_TTL_SECONDS
            and now < expires_at
        )


class SiteAccessMiddleware:
    def __init__(self, app: ASGIApp, gate: SiteAccessGate) -> None:
        self.app = app
        self.gate = gate

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] == "http"
            and self.gate.enabled
            and scope["method"] != "OPTIONS"
            and scope["path"] not in ACCESS_EXEMPT_PATHS
            and not self.gate.is_unlocked(Request(scope))
        ):
            response = JSONResponse(
                {"code": "site_access_required", "detail": "请先输入访问口令"},
                status_code=423,
                headers=NO_STORE_HEADERS,
            )
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)


def create_access_router(gate: SiteAccessGate) -> APIRouter:
    router = APIRouter(prefix="/api/access", tags=["site access"])

    @router.get("/status")
    async def access_status(request: Request) -> JSONResponse:
        return JSONResponse(
            {"enabled": gate.enabled, "unlocked": gate.is_unlocked(request)},
            headers=NO_STORE_HEADERS,
        )

    @router.post("/unlock")
    async def unlock(request: Request) -> JSONResponse:
        if not gate.enabled:
            return JSONResponse({"enabled": False, "unlocked": True}, headers=NO_STORE_HEADERS)

        client = request.client.host if request.client else "unknown"
        retry_after = gate.limiter.reserve(client)
        if retry_after is not None:
            return JSONResponse(
                {"detail": "尝试次数过多，请稍后再试"},
                status_code=429,
                headers={**NO_STORE_HEADERS, "Retry-After": str(retry_after)},
            )

        # Read a bounded body and use a fixed error instead of validation errors
        # that could echo a user's submitted password into response bodies.
        body = bytearray()
        async for chunk in request.stream():
            if len(body) + len(chunk) > MAX_UNLOCK_BODY_BYTES:
                return JSONResponse(
                    {"detail": "请输入有效的访问口令"},
                    status_code=400,
                    headers=NO_STORE_HEADERS,
                )
            body.extend(chunk)
        try:
            payload = json.loads(body)
            password = payload.get("password") if isinstance(payload, dict) else None
            valid = isinstance(password, str) and gate.matches_password(password)
        except (ValueError, TypeError, UnicodeError):
            valid = False
        if not valid:
            return JSONResponse(
                {"detail": "访问口令不正确"}, status_code=401, headers=NO_STORE_HEADERS
            )

        gate.limiter.clear_client(client)
        response = JSONResponse({"enabled": True, "unlocked": True}, headers=NO_STORE_HEADERS)
        response.set_cookie(
            ACCESS_COOKIE_NAME,
            gate.issue_cookie(),
            max_age=ACCESS_TTL_SECONDS,
            httponly=True,
            secure=gate.secure_cookie,
            samesite="lax",
            path="/",
        )
        return response

    @router.post("/lock")
    async def lock() -> JSONResponse:
        response = JSONResponse(
            {"enabled": gate.enabled, "unlocked": not gate.enabled},
            headers=NO_STORE_HEADERS,
        )
        response.delete_cookie(
            ACCESS_COOKIE_NAME,
            path="/",
            httponly=True,
            secure=gate.secure_cookie,
            samesite="lax",
        )
        return response

    return router
