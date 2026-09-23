"""Bounded shared JSON for authenticated, read-only team workspace endpoints."""

import json
from collections.abc import Callable
from typing import Literal

from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session
from starlette.responses import Response

from .database import SessionLocal
from .inventory_events import inventory_events
from .inventory_snapshots import SnapshotFrames
from .material_analytics import period
from .models import utcnow

team_read_frames = SnapshotFrames(views=None, capacity=64)


def team_read_response(
    view: Literal["team-overview", "team-inventory"],
    team_id: int,
    build: Callable[[Session], dict],
    filters: str = "",
) -> Response:
    # Route dependencies authenticate every request before this function runs.
    # Builders use their own short read transaction: waiters retain no auth DB
    # connection, ORM instance or permission-dependent response in the cache.
    def frame():
        with SessionLocal() as db:
            return json.dumps(
                jsonable_encoder(build(db)), ensure_ascii=False, separators=(",", ":")
            )

    body = team_read_frames.get(
        (view, team_id, filters),
        lambda: (inventory_events.revision, str(period(1, utcnow())[0][0])),
        frame,
    )
    return Response(body, media_type="application/json", headers={"Cache-Control": "no-store"})
