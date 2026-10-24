"""Team tasks and completed operations along one local physical-stock path."""

from fastapi import HTTPException
from sqlalchemy import literal, or_, select

from .models import MaterialQuantityAdjustment as Work
from .models import MaterialTransfer as Transfer
from .models import Team, TeamProcessingTask


def completed_work(team_id, lot_ids, *, local=True, name="processing_task_ancestors"):
    """Remaining children skip their creating operation, retaining earlier tasks.

    A normal receipt starts a new team workflow; only processing and internal
    order reassignment carry local task completion forward.
    """
    path = (
        select(
            Transfer.id.label("lot_id"),
            Transfer.id.label("ancestor_id"),
            Transfer.source_transfer_id,
            Transfer.entry_kind,
            Transfer.processing_role,
            Transfer.source_team_id,
            literal(True).label("include_work"),
        )
        .where(Transfer.id.in_(lot_ids), Transfer.next_team_id == team_id)
        .cte(name, recursive=True)
    )
    path = path.union(
        select(
            path.c.lot_id,
            Transfer.id,
            Transfer.source_transfer_id,
            Transfer.entry_kind,
            Transfer.processing_role,
            Transfer.source_team_id,
            or_(
                path.c.entry_kind != "processing_output",
                path.c.processing_role != "remaining",
            ),
        )
        .join(path, Transfer.id == path.c.source_transfer_id)
        .where(
            *(
                [
                    path.c.entry_kind.in_(("processing_output", "serial_reallocation", "rework_split")),
                    path.c.source_team_id == team_id,
                    Transfer.next_team_id == team_id,
                ]
                if local
                else []
            )
        )
    )
    return (
        select(
            path.c.lot_id, Work.id.label("work_id"), Work.processing_task_id, Work.processing_date
        )
        .join(Work, Work.source_transfer_id == path.c.ancestor_id)
        .where(
            path.c.include_work.is_(True),
            Work.team_id == team_id,
            Work.processing_status.is_not(None),
            ~Work.idempotency_key.like("outbound-clear:%"),
            or_(
                path.c.ancestor_id != path.c.lot_id,
                Work.processing_status == "complete",
            ),
        )
    )


def context(db, team_id, lot_id):
    tasks = list(
        db.scalars(select(TeamProcessingTask).where(TeamProcessingTask.team_id == team_id))
    )
    completed = {
        row.processing_task_id
        for row in db.execute(completed_work(team_id, [lot_id]))
        if row.processing_task_id is not None
    }
    lot = db.get(Transfer, lot_id)
    history = completed_work(team_id, [lot_id], local=not lot.rework_pending).subquery()
    previous = db.scalars(
        select(Work).where(Work.id.in_(select(history.c.work_id))).order_by(Work.id.desc())
    )
    rework_records = [
        {
            "processing_task_id": record.processing_task_id,
            "processing_task_name": record.processing_task_name,
            "purpose_id": record.purpose_id,
            "purpose_name": record.purpose_name,
            "rework_of_id": record.id,
            "process_route_id": record.process_route_id,
            "process_step_index": record.process_step_index,
            "process_step_name": record.process_step_name,
            "process_step_instructions": record.process_step_instructions,
        }
        for record in previous
    ]
    return {
        "task_required": bool(tasks),
        "completed_task_ids": sorted(completed),
        "allowed_task_ids": [task.id for task in tasks if task.active and task.id not in completed],
        "rework_task_records": rework_records,
    }


def can_continue(team_id, lot_ids):
    """SQL predicate used before pagination, so totals and candidate pages agree."""
    history = completed_work(team_id, lot_ids).subquery()
    done = (
        select(history.c.work_id)
        .where(
            history.c.lot_id == Transfer.id,
            history.c.processing_task_id == TeamProcessingTask.id,
        )
        .correlate(Transfer, TeamProcessingTask)
        .exists()
    )
    return (
        select(TeamProcessingTask.id)
        .where(
            TeamProcessingTask.team_id == team_id,
            TeamProcessingTask.active.is_(True),
            ~done,
        )
        .correlate(Transfer)
        .exists()
    )


def snapshot(db, lot, payload, prior_work=None):
    # Settings changes lock Team too, including the "no tasks configured" case.
    db.scalar(select(Team).where(Team.id == lot.next_team_id).with_for_update())
    history = list(db.execute(completed_work(lot.next_team_id, [lot.id])))
    if payload.processing_date and any(
        row.processing_date and row.processing_date > payload.processing_date for row in history
    ):
        raise HTTPException(422, "加工日期不能早于本批前道任务日期")
    if prior_work is not None:
        if (
            payload.processing_task_id is not None
            and payload.processing_task_id != prior_work.processing_task_id
        ) or (payload.purpose_id is not None and payload.purpose_id != prior_work.purpose_id):
            raise HTTPException(422, "返工须沿用原加工记录的业务和任务")
        return {
            "processing_task_id": prior_work.processing_task_id,
            "processing_task_name": prior_work.processing_task_name,
            "purpose_id": prior_work.purpose_id,
            "purpose_name": prior_work.purpose_name,
        }
    task = None
    if payload.processing_task_id is not None:
        task = db.scalar(
            select(TeamProcessingTask)
            .where(TeamProcessingTask.id == payload.processing_task_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if task is None or task.team_id != lot.next_team_id or not task.active:
            raise HTTPException(422, "请选择本班组启用的加工任务")
        if payload.processing_mode is None:
            raise HTTPException(422, "任务加工须填写实际加工日期与完成量")
    elif (
        db.scalar(
            select(TeamProcessingTask.id)
            .where(TeamProcessingTask.team_id == lot.next_team_id)
            .limit(1)
        )
        is not None
    ):
        raise HTTPException(422, "请选择加工任务；无可用任务时请联系班组长")
    if (
        payload.work_kind != "rework"
        and task
        and not lot.process_route_id
        and any(row.processing_task_id == task.id for row in history)
    ):
        raise HTTPException(409, "本批已完成该任务，再次执行请登记返工")
    from .team_business import purpose_snapshot

    purpose = (
        {"purpose_id": lot.purpose_id, "purpose_name": lot.purpose_name}
        if payload.purpose_id is None and task is None
        else purpose_snapshot(
            db, lot.next_team_id, payload.purpose_id or lot.purpose_id, required=task is not None
        )
    )
    if purpose["purpose_id"] is None:
        purpose["purpose_name"] = lot.purpose_name
    return {
        "processing_task_id": task.id if task else None,
        "processing_task_name": task.name if task else None,
        **purpose,
    }
