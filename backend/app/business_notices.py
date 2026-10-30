"""One inbox over the existing transactional rework and schedule messages."""

from typing import Literal

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_, exists, func, literal, select, union_all
from sqlalchemy.orm import Session

from .async_api import AsyncAPIRouter
from .auth import get_current_user
from .database import get_db
from .models import (
    MaterialTransfer,
    ProcessRoute,
    ProductionSchedule,
    ProductionScheduleEvent,
    ReworkNotice,
    ReworkNoticeRead,
    ScheduleNotice,
    ScheduleNoticeRead,
    Team,
    User,
    utcnow,
)
from .production_schedules import iso
from .schedule_notices import insert_once

router = AsyncAPIRouter(prefix="/api/business-notices", tags=["business notices"])
Source = Literal["schedule", "rework"]
MODELS = {
    "schedule": (ScheduleNotice, ScheduleNoticeRead),
    "rework": (ReworkNotice, ReworkNoticeRead),
}


def scope(user, notice):
    if user.role == "ADMIN":
        return []
    if user.role == "TEAM" and user.team_id:
        return [notice.team_id == user.team_id]
    raise HTTPException(403, "仅班组长和系统管理员可查看消息")


def visible_notice(db, user, source, notice_id):
    model, _ = MODELS[source]
    notice = db.scalar(select(model).where(model.id == notice_id, *scope(user, model)))
    if notice is None:
        raise HTTPException(404, "消息不存在")
    return notice


def event_for(db, notice):
    """Resolve the immutable revision, never mistake a later edit for this message."""
    parts = notice.event_key.split(":")
    if parts[0] == "plan":
        return db.scalar(
            select(ProductionScheduleEvent)
            .where(
                ProductionScheduleEvent.schedule_id == int(parts[1]),
                ProductionScheduleEvent.action == parts[3],
                ProductionScheduleEvent.after["version"].as_integer() == int(parts[2]),
            )
            .order_by(ProductionScheduleEvent.id)
            .limit(1)
        )
    if parts[0] == "task":
        return db.scalar(
            select(ProductionScheduleEvent)
            .join(ProductionSchedule, ProductionSchedule.id == ProductionScheduleEvent.schedule_id)
            .where(
                ProductionSchedule.task_id == int(parts[1]),
                ProductionScheduleEvent.action == "task_updated",
                ProductionScheduleEvent.after["task_version"].as_integer() == int(parts[2]),
            )
            .order_by(ProductionScheduleEvent.id)
            .limit(1)
        )
    return None


def schedule_location(db, notice):
    event = event_for(db, notice)
    parts = notice.event_key.split(":")
    if event:
        return dict(schedule_id=event.schedule_id, event_id=event.id, batch_id=None), event
    return dict(
        schedule_id=notice.schedule_id,
        event_id=None,
        batch_id=int(parts[1]) if parts[0] == "batch" else None,
    ), None


def schedule_message(notice, event):
    if not event or event.before is None:
        return notice.message
    before, after = event.before, event.after
    labels = {
        "due_at": "交期",
        "final_due_at": "最终交期",
        "target_quantity": "数量",
        "target_weight": "重量",
    }
    changes = [label for key, label in labels.items() if before.get(key) != after.get(key)]
    if before.get("batches") != after.get("batches"):
        old = {row["batch_number"]: row for row in before.get("batches", [])}
        new = {row["batch_number"]: row for row in after.get("batches", [])}
        batches = sorted(
            number for number in old.keys() | new.keys() if old.get(number) != new.get(number)
        )
        changes = ["第 " + "、".join(map(str, batches)) + " 批计划"]
    if not changes:
        return notice.message
    return ("上游：" if notice.kind == "upstream" else "") + "、".join(changes) + "已调整"


@router.get("")
def inbox(
    page: int = Query(1, ge=1),
    unread_only: bool = False,
    category: Literal["all", "schedule", "rework"] = "all",
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    queries = []
    latest = {}
    for source, (notice, receipt) in MODELS.items():
        filters = scope(user, notice)
        latest[source] = db.scalar(select(func.max(notice.id)).where(*filters)) or 0
        queries.append(
            select(
                literal(source).label("source"),
                notice.id,
                notice.created_at,
                receipt.read_at,
            )
            .outerjoin(receipt, and_(receipt.notice_id == notice.id, receipt.user_id == user.id))
            .where(*filters)
        )
    all_rows = union_all(*queries).subquery()
    unread = db.scalar(
        select(func.count()).select_from(all_rows).where(all_rows.c.read_at.is_(None))
    )
    filters = []
    if category != "all":
        filters.append(all_rows.c.source == category)
    if unread_only:
        filters.append(all_rows.c.read_at.is_(None))
    total = db.scalar(select(func.count()).select_from(all_rows).where(*filters))
    rows = db.execute(
        select(all_rows)
        .where(*filters)
        .order_by(all_rows.c.created_at.desc(), all_rows.c.source, all_rows.c.id.desc())
        .offset((page - 1) * 20)
        .limit(20)
    ).all()
    notices = {
        source: {
            n.id: n
            for n in db.scalars(
                select(model).where(model.id.in_([r.id for r in rows if r.source == source]))
            )
        }
        for source, (model, _) in MODELS.items()
    }
    teams = {
        t.id: t
        for t in db.scalars(
            select(Team).where(
                Team.id.in_({n.team_id for group in notices.values() for n in group.values()})
            )
        )
    }
    plans = {
        p.id: p
        for p in db.scalars(
            select(ProductionSchedule).where(
                ProductionSchedule.id.in_([n.schedule_id for n in notices["schedule"].values()])
            )
        )
    }
    routes = {
        r.id: r
        for r in db.scalars(
            select(ProcessRoute).where(
                ProcessRoute.id.in_([n.route_id for n in notices["rework"].values()])
            )
        )
    }
    lots = {
        lot.id: lot
        for lot in db.scalars(
            select(MaterialTransfer).where(
                MaterialTransfer.id.in_([r.rework_source_transfer_id for r in routes.values()])
            )
        )
    }
    items = []
    # Only the visible page is hydrated. The union handles sorting/counts/pagination in SQL.
    for source, notice_id, created, read_at in rows:
        notice = notices[source][notice_id]
        team = teams[notice.team_id]
        batch_no = None
        if source == "schedule":
            plan = plans[notice.schedule_id]
            serial = plan.serial_no
            message = schedule_message(
                notice,
                event_for(db, notice)
                if notice.kind in ("changed", "upstream", "final_due")
                else None,
            )
        else:
            route = routes[notice.route_id]
            lot = lots[route.rework_source_transfer_id]
            serial = route.serial_nos[0] if route.serial_nos else ""
            message = route.request_reason
            batch_no = lot.batch_no
        items.append(
            dict(
                id=notice_id,
                source=source,
                kind=notice.kind,
                serial_no=serial,
                message=message,
                batch_no=batch_no,
                team_name=team.name,
                created_at=iso(created),
                read_at=iso(read_at),
            )
        )
    return dict(items=items, total=total, unread=unread, latest=latest)


@router.get("/{source}/{notice_id}/target")
def target(
    source: Source,
    notice_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    notice = visible_notice(db, user, source, notice_id)
    if source == "rework":
        # The existing reader enforces draft access and resolves superseded instructions.
        from .rework_notices import notice_route

        route = notice_route(notice_id, user, db)
        return dict(
            href=f"/process-routes?rework_notice={notice_id}",
            section="problem" if notice.kind == "requested" else "steps",
            route=route,
            step_index=next(
                (i for i, step in enumerate(route["steps"]) if step["team_id"] == notice.team_id), 0
            ),
        )
    location, _ = schedule_location(db, notice)
    team = db.get(Team, notice.team_id)
    href = (
        f"/dispatch-schedules?schedule_id={location['schedule_id']}"
        if team.kind == "dispatch"
        else f"/team-workspaces/{notice.team_id}?tab=delivery-schedule&schedule_id={location['schedule_id']}"
    )
    return dict(
        href=href,
        section="plan-review" if notice.kind == "review" else None,
        **location,
    )


class ReadAll(BaseModel):
    schedule: int = Field(ge=0)
    rework: int = Field(ge=0)


@router.post("/read-all", status_code=204)
def read_all(
    payload: ReadAll, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    with db.begin():
        for source, (notice, receipt) in MODELS.items():
            filters = scope(user, notice)
            cursor = 0
            while ids := list(
                db.scalars(
                    select(notice.id)
                    .where(
                        *filters,
                        notice.id > cursor,
                        notice.id <= getattr(payload, source),
                        ~exists(
                            select(receipt.notice_id).where(
                                receipt.notice_id == notice.id, receipt.user_id == user.id
                            )
                        ),
                    )
                    .order_by(notice.id)
                    .limit(500)
                )
            ):
                cursor = ids[-1]
                insert_once(
                    db,
                    receipt,
                    [dict(user_id=user.id, notice_id=id, read_at=utcnow()) for id in ids],
                    "user_id",
                )


@router.post("/{source}/{notice_id}/read", status_code=204)
def mark_read(
    source: Source,
    notice_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    with db.begin():
        notice = visible_notice(db, user, source, notice_id)
        insert_once(
            db,
            MODELS[source][1],
            dict(user_id=user.id, notice_id=notice.id, read_at=utcnow()),
            "user_id",
        )
