"""One failed inspection, several team replies, and an explicit QC-leader decision."""

from datetime import timezone
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import exists, func, select
from sqlalchemy.exc import IntegrityError, OperationalError

from . import inspections
from . import material_stock as stock
from .auth import actor_name
from .material_transfer_workflow import _require_team_actor
from .models import (
    InspectionFeedbackEvent as Event,
)
from .models import (
    InspectionFeedbackTeam as Member,
)
from .models import (
    MaterialInspection as Inspection,
)
from .models import (
    MaterialTransfer,
    MaterialTransferEvent,
    Team,
    utcnow,
)
from .record_filters import RecordFilters
from .team_constants import INSPECTION_TEAM_CODE


class FeedbackWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=0)
    notes: str = Field(default="", max_length=2000)
    idempotency_key: str = Field(min_length=1, max_length=100)

    @field_validator("idempotency_key")
    @classmethod
    def key(cls, value):
        if not value.strip():
            raise ValueError("提交标识不能为空")
        return value.strip()


class Decision(FeedbackWrite):
    disposition: Literal[
        "pending", "rework", "shipment", "transfer", "reallocate", "scrap", "other"
    ]
    status: Literal["pending", "processing", "closed"]
    involved_team_ids: list[int] = Field(min_length=1, max_length=50)
    release_legacy_hold: bool = False


def is_qc(user):
    return user.role == "TEAM" and user.team and user.team.code == INSPECTION_TEAM_CODE


def visible(user):
    if user.role == "ADMIN" or is_qc(user):
        return True
    return exists().where(Member.inspection_id == Inspection.id, Member.team_id == user.team_id)


def issue(db, issue_id, user, *, lock=False):
    stmt = select(Inspection).where(
        Inspection.id == issue_id,
        Inspection.parent_id.is_(None),
        Inspection.failed_quantity > 0,
        visible(user),
    )
    if lock:
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    row = db.scalar(stmt)
    if row is None:
        raise HTTPException(404, "质量反馈不存在或不属于当前班组")
    return row


def summaries(db, rows):
    ids = [r.id for r, _, _ in rows]
    members = {}
    if ids:
        replied = exists().where(
            Event.inspection_id == Member.inspection_id,
            Event.team_id == Member.team_id,
            Event.kind == "reply",
        )
        for issue_id, team_id, name, done in db.execute(
            select(Member.inspection_id, Member.team_id, Team.name, replied)
            .join(Team, Team.id == Member.team_id)
            .where(Member.inspection_id.in_(ids))
            .order_by(Member.team_id)
        ):
            members.setdefault(issue_id, []).append(
                dict(team_id=team_id, name=name, replied=bool(done))
            )
    return [
        dict(inspections.record_dict(row, lot, team), involved_teams=members.get(row.id, []))
        for row, lot, team in rows
    ]


def list_records(
    db,
    user,
    *,
    team_id=None,
    query=None,
    kind=None,
    status=None,
    date_from=None,
    date_to=None,
    page=1,
    page_size=20,
):
    conditions = [Inspection.parent_id.is_(None), Inspection.failed_quantity > 0, visible(user)]
    conditions += RecordFilters(date_from=date_from, date_to=date_to).dates(Inspection.checked_at)
    if team_id:
        conditions.append(
            exists().where(Member.inspection_id == Inspection.id, Member.team_id == team_id)
        )
    if kind:
        conditions.append(Inspection.kind == kind)
    if status:
        conditions.append(Inspection.feedback_status == status)
    if query and query.strip():
        conditions.append(
            stock.literal_query(
                query,
                [
                    MaterialTransfer.serial_no,
                    MaterialTransfer.batch_no,
                    MaterialTransfer.material_name,
                    Inspection.notes,
                ],
            )
        )
    stmt = (
        select(Inspection, MaterialTransfer, Team)
        .join(MaterialTransfer, MaterialTransfer.id == Inspection.source_transfer_id)
        .join(Team, Team.id == Inspection.team_id)
        .where(*conditions)
    )
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    pending = (
        db.scalar(
            select(func.count()).select_from(
                stmt.where(Inspection.feedback_status != "closed").subquery()
            )
        )
        or 0
    )
    rows = db.execute(
        stmt.order_by(Inspection.checked_at.desc(), Inspection.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return dict(
        items=summaries(db, rows),
        total=total,
        pending_count=pending,
        page=page,
        page_size=page_size,
    )


def detail(db, issue_id, user):
    row = issue(db, issue_id, user)
    result = summaries(
        db, [(row, db.get(MaterialTransfer, row.source_transfer_id), db.get(Team, row.team_id))]
    )[0]
    result["events"] = [
        dict(
            id=e.id,
            kind=e.kind,
            team_id=e.team_id,
            team_name=name,
            actor=e.actor,
            notes=e.notes,
            details=e.details or {},
            occurred_at=e.occurred_at.replace(tzinfo=timezone.utc).isoformat(),
        )
        for e, name in db.execute(
            select(Event, Team.name)
            .join(Team, Team.id == Event.team_id)
            .where(Event.inspection_id == row.id)
            .order_by(Event.id)
        )
    ]
    result["rechecks"] = [
        inspections.record_dict(r, lot, team)
        for r, lot, team in db.execute(
            select(Inspection, MaterialTransfer, Team)
            .join(MaterialTransfer, MaterialTransfer.id == Inspection.source_transfer_id)
            .join(Team, Team.id == Inspection.team_id)
            .where(Inspection.parent_id == row.id)
            .order_by(Inspection.checked_at.desc(), Inspection.id.desc())
        )
    ]
    return result


def write(db, issue_id, payload, user, *, decision=False):
    team = _require_team_actor(user)
    if decision and not is_qc(user):
        raise HTTPException(403, "仅检验班组长可决定处理方式、结束问题及解除历史锁定")
    if not decision and not payload.notes.strip():
        raise HTTPException(422, "请填写本班组反馈")
    digest = stock.fingerprint(payload)
    kind = "decision" if decision else "reply"

    def replay(event):
        stock._replay(event, user, digest, "team_id")
        if event.inspection_id != issue_id or event.kind != kind:
            raise HTTPException(409, "提交标识已用于其他反馈")

    try:
        with db.begin():
            row = issue(db, issue_id, user, lock=True)
            prior = db.scalar(select(Event).where(Event.idempotency_key == payload.idempotency_key))
            if prior:
                replay(prior)
            else:
                if row.feedback_version != payload.expected_version:
                    raise HTTPException(409, "质量反馈已更新，请刷新后重试")
                details = {}
                if decision:
                    if len(set(payload.involved_team_ids)) != len(payload.involved_team_ids):
                        raise HTTPException(422, "问题涉及班组不能重复")
                    if payload.status == "closed" and payload.disposition == "pending":
                        raise HTTPException(422, "请明确处理方式后再结束问题")
                    for team_id in payload.involved_team_ids:
                        target = db.get(Team, team_id)
                        if target is None or not target.active:
                            raise HTTPException(422, "问题涉及班组不存在或已停用")
                    members = list(db.scalars(select(Member).where(Member.inspection_id == row.id)))
                    old_ids = {m.team_id for m in members}
                    for member in members:
                        if member.team_id not in payload.involved_team_ids:
                            db.delete(member)
                    db.add_all(
                        [
                            Member(inspection_id=row.id, team_id=i)
                            for i in payload.involved_team_ids
                            if i not in old_ids
                        ]
                    )
                    details = dict(
                        disposition=payload.disposition,
                        status=payload.status,
                        involved_team_ids=payload.involved_team_ids,
                        previous_involved_team_ids=sorted(old_ids),
                        released_legacy_hold=payload.release_legacy_hold,
                    )
                    row.disposition = payload.disposition
                    row.feedback_status = payload.status
                    row.decision_notes = payload.notes.strip()
                    if payload.release_legacy_hold:
                        if not row.blocks_outbound or row.released_at:
                            raise HTTPException(409, "该问题没有待解除的历史巡检锁定")
                        row.released_at = utcnow()
                else:
                    if not db.get(Member, (row.id, team.id)):
                        raise HTTPException(403, "只能填写本班组涉及问题的反馈")
                    if row.feedback_status == "closed":
                        raise HTTPException(409, "问题已结束，需检验班组长重新打开后反馈")
                    if row.feedback_status == "pending":
                        row.feedback_status = "processing"
                row.feedback_version += 1
                event = Event(
                    inspection_id=row.id,
                    team_id=team.id,
                    kind=kind,
                    notes=payload.notes.strip(),
                    details=details,
                    actor=actor_name(user),
                    actor_user_id=user.id,
                    idempotency_key=payload.idempotency_key,
                    request_hash=digest,
                )
                db.add(event)
                db.add(
                    MaterialTransferEvent(
                        transfer_id=row.source_transfer_id,
                        action="quality_feedback",
                        actor=actor_name(user),
                        actor_user_id=user.id,
                        occurred_at=utcnow(),
                        changes={
                            "quality_feedback": {
                                "before": None,
                                "after": dict(
                                    issue_id=row.id,
                                    kind=kind,
                                    notes=payload.notes.strip(),
                                    **details,
                                ),
                            }
                        },
                    )
                )
                db.flush()
        return detail(db, issue_id, user)
    except (IntegrityError, OperationalError) as exc:
        db.rollback()
        prior = db.scalar(select(Event).where(Event.idempotency_key == payload.idempotency_key))
        if prior:
            replay(prior)
            return detail(db, issue_id, user)
        stock._db_conflict(exc)
