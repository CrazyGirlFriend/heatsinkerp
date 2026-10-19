"""Rework consumes the same physical stock, with separate immutable work facts."""

from fastapi import HTTPException
from sqlalchemy import select

from .material_lineage import relatives
from .models import MaterialQuantityAdjustment as Work


def previous_work(db, lot):
    path = relatives([lot.id], ancestors=True, name="rework_ancestors")
    return db.scalar(
        select(Work)
        .where(
            Work.source_transfer_id.in_(select(path.c.id)),
            ~Work.idempotency_key.like("outbound-clear:%"),
            Work.processing_status.is_not(None),
        )
        .order_by((Work.team_id == lot.next_team_id).desc(), Work.id.desc())
        .limit(1)
    )


def validate(db, lot, payload, latest):
    if payload.work_kind != "rework":
        if lot.rework_pending:
            raise HTTPException(422, "本批为待返工料，请登记返工，不能计为首次加工产量")
        if payload.rework_of_id is not None:
            raise HTTPException(422, "仅返工可关联原加工记录")
        return None
    if payload.processing_mode is None:
        raise HTTPException(422, "返工须填写加工人、日期与实际完成量")
    if not (
        lot.rework_pending
        or lot.processing_role == "produced"
        or (latest and latest.processing_status == "complete")
    ):
        raise HTTPException(409, "请选择已加工的在库料或退回待返工料")
    prior = previous_work(db, lot)
    if prior is None or (payload.rework_of_id is not None and payload.rework_of_id != prior.id):
        raise HTTPException(409, "原加工记录已变化或不存在，请刷新核对返工来源")
    if (
        payload.processing_date
        and prior.processing_date
        and payload.processing_date < prior.processing_date
    ):
        raise HTTPException(422, "返工日期不能早于原加工日期")
    return prior
