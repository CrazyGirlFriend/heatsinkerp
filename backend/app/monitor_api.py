"""Private, read-only health for the monitor; never grants business access."""

import asyncio
import hmac
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select, text

from .config import settings
from .database import AsyncSessionLocal
from .models import NotificationOutbox, utcnow


async def require_monitor(request: Request):
    if not settings.monitor_token_file:
        raise HTTPException(status_code=404, detail="not found")
    try:
        token = (await asyncio.to_thread(Path(settings.monitor_token_file).read_text)).strip()
    except (OSError, UnicodeError):
        raise HTTPException(status_code=503, detail="monitor credential unavailable") from None
    if not 32 <= len(token) <= 256 or not token.isascii() or not token.isalnum():
        raise HTTPException(status_code=503, detail="monitor credential unavailable")
    if not hmac.compare_digest(request.headers.get("authorization", "").encode(), f"Bearer {token}".encode()):
        raise HTTPException(status_code=401, detail="invalid monitor credential")


router = APIRouter(dependencies=[Depends(require_monitor)])


@router.get("/internal/monitor", include_in_schema=False)
async def monitor_status(request: Request):
    service = request.app.state.notifications
    result = {
        "database": "unavailable",
        "notifications": {
            "connection": "connected" if service.transport.ready else "reconnecting",
            "tasks_running": len(service.tasks) == 2 and all(not task.done() for task in service.tasks),
            "pending": None,
            "oldest_pending_seconds": None,
        },
    }
    try:
        async with asyncio.timeout(2):
            async with AsyncSessionLocal() as db:
                await db.execute(text("SELECT 1"))
                pending, oldest = (await db.execute(
                    select(func.count(), func.min(NotificationOutbox.created_at))
                    .where(NotificationOutbox.published_at.is_(None))
                )).one()
                result["database"] = "ok"
                result["notifications"].update(
                    pending=pending,
                    oldest_pending_seconds=max(0, int((utcnow() - oldest).total_seconds())) if oldest else 0,
                )
    except Exception:
        # Do not expose SQL, connection strings, payloads or credentials.
        pass
    return result
