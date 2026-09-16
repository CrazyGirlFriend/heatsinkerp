"""Authenticated SSE snapshots, emitted after inventory transactions commit."""
import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.security import HTTPAuthorizationCredentials
from starlette.concurrency import run_in_threadpool
from starlette.responses import StreamingResponse

from .auth import bearer_scheme, get_auth_context
from .database import SessionLocal
from .factory_overview import factory_overview, live_endpoint
from .inventory_events import inventory_events
from .material_analytics import period
from .models import utcnow

router = APIRouter(prefix="/api/factory-overview")
HEARTBEAT_SECONDS = 15


def factory_day():
    return period(1, utcnow())[0][0]


def read_inventory(credentials, *, snapshot=True, view="inventory"):
    # Do not hold a database connection or request-scoped session while waiting.
    with SessionLocal() as db:
        get_auth_context(credentials, db)
        if not snapshot:
            return None
        if view == "inventory-changed":
            return {"changed": True}
        return live_endpoint(db) if view == "factory-live" else factory_overview(db)


def message(event, data):
    return f"event: {event}\ndata: {json.dumps(jsonable_encoder(data), ensure_ascii=False, separators=(',', ':'))}\n\n"


async def inventory_stream(request, credentials, view="inventory"):
    with inventory_events.subscribe() as changed:
        try:
            while True:
                changed.clear()
                day = factory_day()
                if not request.app.state.site_access_gate.is_unlocked(request):
                    yield message("access-required", {})
                    return
                report = await run_in_threadpool(read_inventory, credentials, view=view)
                yield message(view, report)
                while not changed.is_set():
                    try:
                        await asyncio.wait_for(changed.wait(), HEARTBEAT_SECONDS)
                    except asyncio.TimeoutError:
                        if not request.app.state.site_access_gate.is_unlocked(request):
                            yield message("access-required", {})
                            return
                        # Heartbeats validate access but never poll inventory totals.
                        await run_in_threadpool(read_inventory, credentials, snapshot=False)
                        # Today's robot totals and rolling ledger periods must
                        # expire at local midnight even if nobody moves stock.
                        if view != "inventory" and factory_day() != day:
                            break
                        yield ": heartbeat\n\n"
        except HTTPException as exc:
            if exc.status_code != 401:
                raise
            yield message("auth-expired", {})


@router.get("/stream")
async def inventory_endpoint(request: Request, credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    return await stream_response(request, credentials, "inventory")


async def stream_response(request, credentials, view):
    # Reject invalid credentials as HTTP 401 before opening the stream, without
    # a yielded request dependency retaining a DB session for its lifetime.
    await run_in_threadpool(read_inventory, credentials, snapshot=False)
    return StreamingResponse(inventory_stream(request, credentials, view), media_type="text/event-stream",
        headers={"Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no"})


@router.get("/live/stream")
async def live_stream_endpoint(request: Request, credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    return await stream_response(request, credentials, "factory-live")


@router.get("/changes")
async def changes_endpoint(request: Request, credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    # Invalidate filtered ledgers without sending unbounded business lists.
    return await stream_response(request, credentials, "inventory-changed")
