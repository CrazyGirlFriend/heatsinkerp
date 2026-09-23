"""Administrator-only notification health; never exposes message payloads."""

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import require_admin
from .database import get_db
from .models import NotificationOutbox, utcnow

router = APIRouter(prefix="/api/notifications", dependencies=[Depends(require_admin)])


@router.get("/status")
async def notification_status(request: Request, db: AsyncSession = Depends(get_db)):
    pending, oldest = (
        await db.execute(
            select(func.count(), func.min(NotificationOutbox.created_at)).where(
                NotificationOutbox.published_at.is_(None)
            )
        )
    ).one()
    return {
        "connection": "connected"
        if request.app.state.notifications.transport.ready
        else "reconnecting",
        "pending": pending,
        "oldest_pending_seconds": max(0, int((utcnow() - oldest).total_seconds())) if oldest else 0,
    }
