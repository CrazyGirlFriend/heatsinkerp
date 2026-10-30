"""Transactional schedule messages, with independent receipts for each account."""

from datetime import timedelta

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_, exists, func, select
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from .async_api import AsyncAPIRouter
from .auth import get_current_user
from .database import get_db
from .models import (
    ProductionSchedule as Plan,
)
from .models import (
    ProductionScheduleBatch as Batch,
)
from .models import (
    ScheduleNotice as Notice,
)
from .models import (
    ScheduleNoticeRead as Read,
)
from .models import (
    Team,
    User,
    utcnow,
)
from .production_schedules import LOCAL_ZONE, iso, progress_table
from .team_constants import WAREHOUSE_TEAM_CODE

router = AsyncAPIRouter(prefix="/api/schedule-notices", tags=["schedule notices"])


def insert_once(db, model, values, key):
    # Both supported databases handle simultaneous polls without a duplicate receipt.
    if db.bind.dialect.name == "mysql":
        stmt = mysql_insert(model).values(values)
        stmt = stmt.on_duplicate_key_update(**{key: getattr(stmt.inserted, key)})
    else:
        stmt = sqlite_insert(model).values(values).on_conflict_do_nothing()
    db.execute(stmt)


def add_notice(db, plan, kind, message, key, now=None, *, team_id=None):
    insert_once(
        db,
        Notice,
        dict(
            event_key=key,
            schedule_id=plan.id,
            team_id=team_id or plan.team_id,
            kind=kind,
            message=message,
            created_at=now or utcnow(),
        ),
        "event_key",
    )


def date_text(value):
    from datetime import timezone

    return value.replace(tzinfo=timezone.utc).astimezone(LOCAL_ZONE).strftime("%m-%d %H:%M")


def notify_change(db, plan, action, before, after):
    labels = {
        "created": ("new", "新增排期，请安排批次"),
        "updated": ("changed", "交货计划已调整"),
        "batches_updated": ("changed", "分批计划已调整"),
        "cancelled": ("cancelled", "排期已取消"),
        "order_locked": ("locked", "调度已锁定订单"),
        "order_unlocked": ("unlocked", "调度已解锁订单，可以提交交期调整"),
        "plan_returned": ("returned", "交期计划已退回，请修改后重新提交"),
    }
    if action == "plan_submitted":
        from .team_constants import DISPATCH_TEAM_CODE

        dispatch_id = db.scalar(
            select(Team.id).where(Team.code == DISPATCH_TEAM_CODE, Team.active.is_(True))
        )
        if dispatch_id:
            name = db.get(Team, plan.team_id).name
            add_notice(
                db,
                plan,
                "review",
                f"{name}已提交交期计划，请确认",
                f"plan:{plan.id}:{plan.version}:{action}",
                team_id=dispatch_id,
            )
        return
    if action not in labels:
        return
    changed = {k for k in after if k != "version" and (before or {}).get(k) != after[k]}
    if before is not None and not changed and action not in ("order_locked", "order_unlocked"):
        return
    kind, message = labels[action]
    if action == "batches_updated" and (before or {}).get("planning_state") in (
        "submitted",
        "revision_pending",
    ):
        message = "调度已确认本班组交期计划"
    if action == "plan_returned":
        message += "：" + after.get("reason", "")[:180]
    key = f"plan:{plan.id}:{plan.version}:{action}"
    add_notice(db, plan, kind, message, key)
    # Only explicitly linked next nodes receive upstream changes, not every team.
    if before and changed & {
        "due_at",
        "batches",
        "cancelled_at",
        "target_quantity",
        "target_weight",
    }:
        team_name = db.get(Team, plan.team_id).name
        for successor in db.scalars(
            select(Plan).where(Plan.predecessor_id == plan.id, Plan.cancelled_at.is_(None))
        ):
            add_notice(
                db,
                successor,
                "upstream",
                f"上游{team_name}排期已调整，请核对本班组计划",
                f"{key}:to:{successor.id}",
            )


def notify_final_due(db, task):
    seen = set()
    for plan in db.scalars(
        select(Plan)
        .where(Plan.task_id == task.id, Plan.cancelled_at.is_(None))
        .order_by(Plan.sequence_no, Plan.id)
    ):
        if plan.team_id in seen:
            continue
        seen.add(plan.team_id)
        add_notice(
            db,
            plan,
            "final_due",
            f"调度已调整订单交期，请核对分批安排；最终交期 {date_text(task.final_due_at)}",
            f"task:{task.id}:{task.version}:team:{plan.team_id}",
        )


def scope(user):
    if user.role == "ADMIN":
        return []
    if user.role == "TEAM" and user.team_id:
        return [Notice.team_id == user.team_id]
    raise HTTPException(403, "仅班组长和系统管理员可查看消息")


def refresh_deadlines(db, user, now=None):
    """Poll while the app is visible; opening after absence also catches overdue work.

    Keyset chunks bound the progress aggregation; no fixed page cap can starve
    later work. Historical notices are retained as messages, not current status.
    """
    scope(user)
    now = now or utcnow()
    for batched in (False, True):
        target = Batch if batched else Plan
        query = select(target, Plan) if batched else select(Plan, Plan)
        if batched:
            query = query.join(Plan, Plan.id == Batch.schedule_id)
        else:
            query = query.where(
                Plan.planning_state.in_(("confirmed", "revision_pending")),
                ~exists(select(Batch.id).where(Batch.schedule_id == Plan.id)),
            )
        query = query.join(Team, Team.id == Plan.team_id).where(
            Plan.cancelled_at.is_(None),
            Team.active.is_(True),
            Team.code != WAREHOUSE_TEAM_CODE,
            target.due_at <= now + timedelta(hours=24),
        )
        if user.role != "ADMIN":
            query = query.where(Plan.team_id == user.team_id)
        cursor = 0
        while rows := db.execute(
            query.where(target.id > cursor).order_by(target.id).limit(200)
        ).all():
            cursor = rows[-1][0].id
            pending = []
            for item, plan in rows:
                kind = "overdue" if item.due_at < now else "due_soon"
                key = f"{'batch' if batched else 'node'}:{item.id}:{item.due_at.isoformat()}:{kind}"
                pending.append((item, plan, kind, key))
            existing = set(
                db.scalars(
                    select(Notice.event_key).where(
                        Notice.event_key.in_([key for _, _, _, key in pending])
                    )
                )
            )
            pending = [row for row in pending if row[3] not in existing]
            if not pending:
                continue
            progress = progress_table(
                plan_ids=list({p.id for _, p, _, _ in pending}), batches=batched
            )
            completed = set(
                db.scalars(
                    select(progress.c.schedule_id).where(progress.c.completed_at.is_not(None))
                )
            )
            for item, plan, kind, key in pending:
                if item.id in completed:
                    continue
                batch_label = f"第 {item.batch_number} 批" if batched else "本班组"
                message = f"{batch_label}{'已过交期' if kind == 'overdue' else '即将到交期'} · {date_text(item.due_at)}"
                add_notice(db, plan, kind, message, key, now)


@router.post("/refresh", status_code=204)
def refresh(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    with db.begin():
        refresh_deadlines(db, user)


@router.get("")
def inbox(
    page: int = Query(default=1, ge=1),
    unread_only: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    filters = scope(user)
    read = and_(Read.notice_id == Notice.id, Read.user_id == user.id)
    base = select(Notice.id).outerjoin(Read, read).where(*filters)
    unread = db.scalar(
        select(func.count()).select_from(base.where(Read.notice_id.is_(None)).subquery())
    )
    latest = db.scalar(select(func.max(Notice.id)).where(*filters)) or 0
    if unread_only:
        filters = [*filters, Read.notice_id.is_(None)]
    total = (
        db.scalar(select(func.count()).select_from(base.where(Read.notice_id.is_(None)).subquery()))
        if unread_only
        else db.scalar(select(func.count()).select_from(base.subquery()))
    )
    rows = db.execute(
        select(Notice, Read.read_at, Plan.serial_no, Team.name)
        .join(Plan, Plan.id == Notice.schedule_id)
        .join(Team, Team.id == Notice.team_id)
        .outerjoin(Read, read)
        .where(*filters)
        .order_by(Notice.id.desc())
        .offset((page - 1) * 20)
        .limit(20)
    )
    return dict(
        items=[
            dict(
                id=n.id,
                kind=n.kind,
                message=n.message,
                serial_no=serial,
                team_name=team,
                created_at=iso(n.created_at),
                read_at=iso(read_at),
                href=f"/team-workspaces/{n.team_id}?tab=delivery-schedule&schedule_id={n.schedule_id}",
            )
            for n, read_at, serial, team in rows
        ],
        total=total,
        unread=unread,
        latest_id=latest,
    )


class ReadAll(BaseModel):
    through_id: int = Field(ge=0)


@router.post("/read-all", status_code=204)
def read_all(
    payload: ReadAll, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    with db.begin():
        filters = scope(user)
        cursor = 0
        while ids := list(
            db.scalars(
                select(Notice.id)
                .where(
                    *filters,
                    Notice.id > cursor,
                    Notice.id <= payload.through_id,
                    ~exists(
                        select(Read.notice_id).where(
                            Read.notice_id == Notice.id, Read.user_id == user.id
                        )
                    ),
                )
                .order_by(Notice.id)
                .limit(500)
            )
        ):
            cursor = ids[-1]
            insert_once(
                db,
                Read,
                [dict(user_id=user.id, notice_id=id, read_at=utcnow()) for id in ids],
                "user_id",
            )


@router.post("/{notice_id}/read", status_code=204)
def mark_read(
    notice_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    with db.begin():
        item = db.scalar(select(Notice.id).where(Notice.id == notice_id, *scope(user)))
        if item is None:
            raise HTTPException(404, "消息不存在")
        insert_once(db, Read, dict(user_id=user.id, notice_id=item, read_at=utcnow()), "user_id")
