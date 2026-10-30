"""Schedule ownership is independent of system administration."""

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
    if not is_dispatch(user):
        raise HTTPException(403, "仅调度班组可以管理排期")
    return user


def require_unlocked(task):
    if task.cancelled_at:
        raise HTTPException(409, "排期已删除")
    if task.locked_at:
        raise HTTPException(409, "订单已锁定，请联系调度解锁后修改")


def require_planner(user, plan):
    if is_dispatch(user):
        return
    if not (
        user.role == "TEAM"
        and user.active
        and user.team_id == plan.team_id
        and user.team
        and user.team.active
        and user.team.kind in ("production", "warehouse")
    ):
        raise HTTPException(403, "仅本班组长或调度可以安排交期")
