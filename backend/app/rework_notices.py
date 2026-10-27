"""Team-scoped rework messages. Reading is independent from processing a problem."""

from fastapi import Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .async_api import AsyncAPIRouter
from .auth import get_current_user
from .database import get_db
from .models import MaterialTransfer, ProcessRoute, ReworkNotice, Team, User, utcnow
from .team_constants import ENGINEERING_TEAM_CODE

router = AsyncAPIRouter(prefix="/api/rework-notices", dependencies=[Depends(get_current_user)])


def notify_engineering(db, route):
    team_id = db.scalar(
        select(Team.id).where(Team.code == ENGINEERING_TEAM_CODE, Team.active.is_(True))
    )
    if team_id is not None:
        db.add(ReworkNotice(team_id=team_id, route_id=route.id, kind="requested"))


def notify_ready(db, route):
    if route.route_kind != "rework":
        return
    lot = db.get(MaterialTransfer, route.rework_source_transfer_id)
    recipients = {route.requesting_team_id, lot.next_team_id}
    for team_id in recipients - {None}:
        db.add(ReworkNotice(team_id=team_id, route_id=route.id, kind="ready"))


def require_team_access(user, team_id):
    if user.role != "ADMIN" and (user.role != "TEAM" or user.team_id != team_id):
        raise HTTPException(403, "只能查看本班组消息")


@router.get("")
def list_notices(
    team_id: int = Query(ge=1),
    page: int = Query(1, ge=1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_team_access(user, team_id)
    where = ReworkNotice.team_id == team_id
    total = db.scalar(select(func.count()).select_from(ReworkNotice).where(where))
    unread = db.scalar(
        select(func.count()).select_from(ReworkNotice).where(where, ReworkNotice.read_at.is_(None))
    )
    rows = db.execute(
        select(ReworkNotice, ProcessRoute, MaterialTransfer.batch_no)
        .join(ProcessRoute, ProcessRoute.id == ReworkNotice.route_id)
        .join(MaterialTransfer, MaterialTransfer.id == ProcessRoute.rework_source_transfer_id)
        .where(where)
        .order_by(ReworkNotice.id.desc())
        .offset((page - 1) * 20)
        .limit(20)
    )
    return {
        "total": total,
        "unread": unread,
        "page": page,
        "page_size": 20,
        "items": [
            dict(
                id=notice.id,
                kind=notice.kind,
                route_id=route.id,
                state=route.state,
                serial_no=route.serial_nos[0] if route.serial_nos else "",
                batch_no=batch_no,
                problem=route.request_reason,
                submitting_team=route.requesting_team_name or "来源未记录",
                submitted_by=route.requested_by,
                engineering_employee_name=route.engineering_employee_name,
                created_at=notice.created_at.isoformat() + "Z",
                read_at=notice.read_at.isoformat() + "Z" if notice.read_at else None,
            )
            for notice, route, batch_no in rows
        ],
    }


@router.get("/{notice_id}/route")
def notice_route(
    notice_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    from .process_route_api import document
    from .process_routes import require_route_reader

    notice = db.get(ReworkNotice, notice_id)
    if notice is None:
        raise HTTPException(404, "消息不存在")
    require_team_access(user, notice.team_id)
    route = db.get(ProcessRoute, notice.route_id)
    lot = db.get(MaterialTransfer, route.rework_source_transfer_id)
    # A revised instruction must not send a team back to a superseded route.
    if lot.rework_route_id:
        route = db.get(ProcessRoute, lot.rework_route_id)
    require_route_reader(route, user)
    return document(route, db=db)


@router.post("/{notice_id}/read")
def mark_read(
    notice_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    with db.begin():
        notice = db.scalar(
            select(ReworkNotice).where(ReworkNotice.id == notice_id).with_for_update()
        )
        if notice is None:
            raise HTTPException(404, "消息不存在")
        require_team_access(user, notice.team_id)
        if notice.read_at is None:
            notice.read_at = utcnow()
        return {"read_at": notice.read_at.isoformat() + "Z"}
