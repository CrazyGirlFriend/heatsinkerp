"""Bounded diagnostic metadata; never serialize exception messages or request data."""

from __future__ import annotations

import json
import logging
import time
import traceback
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

request_id: ContextVar[str | None] = ContextVar("request_id", default=None)


@dataclass
class DatabaseTiming:
    sql_count: int = 0
    sql_ms: float = 0

    def fields(self):
        return {"sql_count": self.sql_count, "sql_ms": round(self.sql_ms, 2)}


database_timing: ContextVar[DatabaseTiming | None] = ContextVar("database_timing", default=None)


@contextmanager
def measure_database():
    timing = DatabaseTiming()
    token = database_timing.set(timing)
    try:
        yield timing
    finally:
        database_timing.reset(token)


def instrument_database(engine):
    """Measure driver waits without logging SQL, parameters or returned data."""
    from sqlalchemy import event

    def before(_connection, _cursor, _statement, _parameters, context, _many):
        timing = database_timing.get()
        if timing is not None:
            timing.sql_count += 1
            context._heatsink_timing = (timing, time.monotonic())

    def finish(context):
        measured = getattr(context, "_heatsink_timing", None)
        if measured is not None:
            timing, started = measured
            timing.sql_ms += (time.monotonic() - started) * 1000
            context._heatsink_timing = None

    event.listen(engine, "before_cursor_execute", before)
    event.listen(engine, "after_cursor_execute", lambda _c, _cu, _s, _p, ctx, _m: finish(ctx))
    event.listen(engine, "handle_error", lambda error: finish(error.execution_context))


logger = logging.getLogger("heatsink.application")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(handler)
logger.setLevel(logging.INFO)
logger.propagate = False


def record(event: str, *, error: Exception | None = None, **fields: object) -> None:
    """Call with static event names and explicitly selected metadata only."""
    payload = {
        "time": datetime.now(timezone.utc).isoformat(),
        "event": event,
        "request_id": request_id.get(),
        **fields,
    }
    if error is not None:
        # Trace locations are useful; messages, source lines and locals may hold
        # SQL parameters, credentials or business data and must stay out of logs.
        payload["error_type"] = type(error).__name__
        payload["frames"] = [
            {"file": Path(frame.filename).name, "line": frame.lineno, "function": frame.name}
            for frame in traceback.extract_tb(error.__traceback__)[-12:]
        ]
    logger.log(logging.ERROR if error is not None else logging.INFO, json.dumps(payload))


class RequestLogMiddleware:
    """Pure ASGI: forward every SSE chunk immediately, with no body buffering."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        # Generate locally: untrusted headers must not inject secrets into logs.
        correlation = uuid4().hex
        token = request_id.set(correlation)
        timing = DatabaseTiming()
        database_token = database_timing.set(timing)
        started = time.monotonic()
        status = 499
        response_started = False
        is_stream = False
        first_body_ms = None

        async def tracked_send(message: Message) -> None:
            nonlocal status, response_started, is_stream, first_body_ms
            if message["type"] == "http.response.start":
                status = message["status"]
                response_started = True
                is_stream = any(
                    key.lower() == b"content-type" and value.startswith(b"text/event-stream")
                    for key, value in message.get("headers", [])
                )
                message = dict(message)
                message["headers"] = [
                    (key, value)
                    for key, value in message.get("headers", [])
                    if key.lower() != b"x-request-id"
                ] + [(b"x-request-id", correlation.encode("ascii"))]
            elif (
                message["type"] == "http.response.body"
                and message.get("body")
                and first_body_ms is None
            ):
                first_body_ms = round((time.monotonic() - started) * 1000, 2)
            await send(message)

        try:
            await self.app(scope, receive, tracked_send)
        except Exception as exc:
            record("request.failed", error=exc)
            if response_started:
                # Uvicorn must close an interrupted stream. Suppress the original
                # exception chain so its logger cannot expose database arguments.
                raise RuntimeError("Response stream interrupted; see request diagnostics") from None
            await JSONResponse({"detail": "Internal server error"}, status_code=500)(
                scope, receive, tracked_send
            )
        finally:
            route = scope.get("route")
            record(
                "request.completed",
                method=scope["method"],
                route=getattr(route, "path", "<unmatched>"),
                status=status,
                duration_ms=round((time.monotonic() - started) * 1000, 2),
                is_stream=is_stream,
                first_body_ms=first_body_ms,
                **timing.fields(),
            )
            database_timing.reset(database_token)
            request_id.reset(token)
