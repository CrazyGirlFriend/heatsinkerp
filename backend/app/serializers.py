"""Directory/account snapshots for the supported API."""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Any
from .models import Team, User


def _utc(value: datetime) -> datetime:
    """Mark database UTC-naive values as UTC for unambiguous JSON (`Z`)."""
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def team_dict(team: Team) -> dict[str, Any]:
    return {
        "id": team.id,
        "code": team.code,
        "name": team.name,
        "description": team.description,
        "active": team.active,
        "sort_order": team.sort_order,
        "kind": team.kind,
        "created_at": _utc(team.created_at),
        "updated_at": _utc(team.updated_at),
    }


def user_dict(user: User) -> dict[str, Any]:
    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "role": user.role,
        "team_id": user.team_id,
        "team_code": user.team.code if user.team else None,
        "team_name": user.team.name if user.team else None,
        "active": user.active,
        "created_at": _utc(user.created_at),
        "updated_at": _utc(user.updated_at),
    }
