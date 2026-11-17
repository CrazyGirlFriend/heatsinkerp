"""Administrators and dispatch own schedule management."""

from fastapi import Depends, HTTPException

from .auth import get_current_user
from .team_constants import DISPATCH_TEAM_CODE


def is_dispatch(user):
    return bool(
        user.role == "TEAM"
        and user.active
        and user.team
        and user.team.active
        and user.team.kind == "dispatch"
        and user.team.code == DISPATCH_TEAM_CODE
    )


async def require_dispatch(user=Depends(get_current_user)):
    require_planner(user)
    return user


def require_active_task(task):
    if task.cancelled_at:
        raise HTTPException(409, "排期已删除")


def require_planner(user):
    if not (user.active and user.role == "ADMIN") and not is_dispatch(user):
        raise HTTPException(403, "仅管理员和调度班组可以管理排期")
