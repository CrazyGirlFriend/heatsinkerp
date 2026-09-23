"""Authenticated SSE snapshots, emitted after inventory transactions commit."""
import asyncio
import json
from time import monotonic

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.security import HTTPAuthorizationCredentials
from starlette.responses import StreamingResponse

from .auth import bearer_scheme, read_auth_context, token_digest
from .database import AsyncSessionLocal
from .factory_overview import factory_overview, live_endpoint
from .inventory_events import InventoryChange, inventory_events
from .inventory_snapshots import SnapshotFrames
from .material_analytics import period
from .models import utcnow
from .observability import record

router = APIRouter(prefix="/api/factory-overview")
HEARTBEAT_SECONDS = 15
snapshot_frames = SnapshotFrames()


def factory_day():
    return period(1, utcnow())[0][0]


async def read_inventory(credentials, *, snapshot=True, view="inventory", change=None):
    # Recheck every caller and release auth connections before an overlapping
    # report is shared. Completed reports are never cached.
    async with AsyncSessionLocal() as db:
        context = await db.run_sync(lambda session: read_auth_context(credentials, session))
        user_id = context.user.id
    if not snapshot:
        return None
    if view == "inventory-changed":
        if change is not None and not (change.inventory or change.directory or change.accounts or user_id in change.user_ids):
            return None
        return message(view, change.payload(user_id) if change is not None else {"changed": True})
    if change is not None and not change.inventory:
        return None

    async def build():
        async with AsyncSessionLocal() as db:
            report = await db.run_sync(live_endpoint if view == "factory-live" else factory_overview)
            started = monotonic()
            frame = message(view, report)
            record("inventory.snapshot.encoded", view=view,
                   duration_ms=round((monotonic() - started) * 1000, 2))
            return frame

    return await snapshot_frames.get(view, lambda: (inventory_events.revision, str(factory_day())), build)


def message(event, data):
    return f"event: {event}\ndata: {json.dumps(jsonable_encoder(data), ensure_ascii=False, separators=(',', ':'))}\n\n"


async def inventory_stream(request, credentials, view="inventory"):
    with inventory_events.subscribe() as changed:
        try:
            change = None
            while True:
                day = factory_day()
                if not request.app.state.site_access_gate.is_unlocked(request):
                    yield message("access-required", {})
                    return
                if not request.app.state.notifications.transport.ready:
                    return  # EOF makes clients show reconnecting, never a false live state.
                # Session-only changes don't make unrelated clients query auth
                # or stock. Heartbeats continue to validate every connection.
                session_only = change is not None and change.sessions and not (change.inventory or change.accounts or change.directory or change.user_ids)
                if not session_only or credentials is None or token_digest(credentials.credentials) in change.sessions:
                    options = {"change": change} if change is not None else {}
                    revision = inventory_events.revision
                    started = monotonic()
                    frame = await read_inventory(credentials, view=view, **options)
                    if frame is not None:
                        record("inventory.frame.ready", view=view, revision=revision,
                               duration_ms=round((monotonic() - started) * 1000, 2))
                        yield frame
                while not changed.is_set():
                    try:
                        await asyncio.wait_for(changed.wait(), HEARTBEAT_SECONDS)
                    except asyncio.TimeoutError:
                        if not request.app.state.site_access_gate.is_unlocked(request):
                            yield message("access-required", {})
                            return
                        # Heartbeats validate access but never poll inventory totals.
                        await read_inventory(credentials, snapshot=False)
                        if not request.app.state.notifications.transport.ready:
                            return
                        # Today's robot totals and rolling ledger periods must
                        # expire at local midnight even if nobody moves stock.
                        if view != "inventory" and factory_day() != day:
                            break
                        yield ": heartbeat\n\n"
                change = changed.take() if changed.is_set() else None
                # A scoped event arriving at midnight must not hide the date
                # rollover from other teams or from today's robot snapshot.
                if change is not None and view != "inventory" and factory_day() != day:
                    change = change.merge(InventoryChange(team_ids=None))
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
    await read_inventory(credentials, snapshot=False)
    if not request.app.state.notifications.transport.ready:
        raise HTTPException(503, "实时通知正在重连，请稍后重试", headers={"Retry-After": "3"})
    return StreamingResponse(inventory_stream(request, credentials, view), media_type="text/event-stream",
        headers={"Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no"})


@router.get("/live/stream")
async def live_stream_endpoint(request: Request, credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    return await stream_response(request, credentials, "factory-live")


@router.get("/changes")
async def changes_endpoint(request: Request, credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    # Invalidate filtered ledgers without sending unbounded business lists.
    return await stream_response(request, credentials, "inventory-changed")
