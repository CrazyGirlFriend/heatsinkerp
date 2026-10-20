"""Patrol and QC inspection facts. No stock movements or automatic disposition."""

from datetime import datetime, timezone
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import aliased

from .auth import actor_name
from .material_lineage import relatives
from .models import (
    InspectionFeedbackTeam,
    InspectionProblem,
    InspectionProblemType,
    MaterialQuantityAdjustment,
    MaterialStockBalance,
    MaterialTransfer,
    MaterialTransferEvent,
    Team,
    utcnow,
)
from .models import MaterialInspection as Inspection
from .record_filters import RecordFilters
from .team_constants import INSPECTION_TEAM_CODE, PROCESSING_TEAM_CODES


class InspectionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_transfer_id: int = Field(ge=1)
    expected_revision: int = Field(ge=0)
    inspector_employee_id: int = Field(ge=1)
    checked_at: datetime
    sample_quantity: int = Field(gt=0, le=2147483647)
    failed_quantity: int = Field(ge=0, le=2147483647)
    kind: Literal["patrol", "inspection"] = "patrol"
    scope: Literal["sample", "full"] = "sample"
    methods: list[Literal["visual", "microscope"]] = Field(min_length=1, max_length=2)
    items: list[Literal["appearance", "dimension", "weight"]] = Field(min_length=1, max_length=3)
    dimension_result: str = Field(default="", max_length=2000)
    weight_result: str = Field(default="", max_length=2000)
    involved_team_ids: list[int] = Field(default_factory=list, max_length=50)
    problem_type_ids: list[int] = Field(default_factory=list, max_length=50)
    notes: str = Field(default="", max_length=2000)
    parent_id: int | None = Field(default=None, ge=1)
    idempotency_key: str = Field(min_length=1, max_length=100)

    @field_validator("idempotency_key")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("提交标识不能为空")
        return value.strip()

    @field_validator("checked_at")
    @classmethod
    def timestamp(cls, value):
        if value.tzinfo is None:
            raise ValueError("检查时间须带时区")
        return value.astimezone(timezone.utc)

    @model_validator(mode="after")
    def counts(self):
        if self.failed_quantity > self.sample_quantity:
            raise ValueError("不合格件数不能超过检查件数")
        if len(set(self.methods)) != len(self.methods) or len(set(self.items)) != len(self.items):
            raise ValueError("检查手段和项目不能重复")
        if len(set(self.involved_team_ids)) != len(self.involved_team_ids) or any(
            i < 1 for i in self.involved_team_ids
        ):
            raise ValueError("问题涉及班组不能重复或无效")
        if self.failed_quantity and not self.parent_id and not self.involved_team_ids:
            raise ValueError("请选择问题涉及班组")
        if not self.failed_quantity and self.involved_team_ids:
            raise ValueError("没有不合格物料时无需指定问题班组")
        if len(set(self.problem_type_ids)) != len(self.problem_type_ids) or any(
            i < 1 for i in self.problem_type_ids
        ):
            raise ValueError("检验问题不能重复或无效")
        if self.failed_quantity and not self.problem_type_ids:
            raise ValueError("请选择检验问题")
        if not self.failed_quantity and self.problem_type_ids:
            raise ValueError("没有不合格物料时无需选择检验问题")
        return self


def hold_conditions():
    return (
        Inspection.blocks_outbound.is_(True),
        Inspection.parent_id.is_(None),
        Inspection.failed_quantity > 0,
        Inspection.released_at.is_(None),
    )


def hold_column(lot_id):
    physical = aliased(MaterialTransfer)
    root_id = (
        select(physical.inspection_hold_root_id)
        .where(physical.id == lot_id)
        .correlate_except(physical)
        .scalar_subquery()
    )
    return (
        select(Inspection.id)
        .where(
            or_(Inspection.source_transfer_id == lot_id, Inspection.source_transfer_id == root_id),
            *hold_conditions(),
        )
        .limit(1)
        .correlate_except(Inspection)
        .scalar_subquery()
    )


def lock_hold(db, lot_id):
    lot = db.get(MaterialTransfer, lot_id)
    return db.scalar(
        select(Inspection)
        .where(
            Inspection.source_transfer_id.in_([lot_id, lot.inspection_hold_root_id or lot_id]),
            *hold_conditions(),
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )


def require_clear(db, lot_id):
    if lock_hold(db, lot_id) is not None:
        raise HTTPException(
            409, "本批巡检不合格，整批暂停转出；请由检验班组长在质量反馈中确认处理并手动解除锁定"
        )


def require_clear_lots(db, lots):
    root_ids = {
        root_id for lot in lots for root_id in (lot.id, lot.inspection_hold_root_id) if root_id
    }
    held = db.scalar(
        select(Inspection.id)
        .where(Inspection.source_transfer_id.in_(root_ids), *hold_conditions())
        .order_by(Inspection.id)
        .with_for_update()
    )
    if held is not None:
        raise HTTPException(
            409, "本批巡检不合格，整批暂停转出；请由检验班组长在质量反馈中确认处理并手动解除锁定"
        )


def held_quantity(db, root_id, *, lock=False):
    family = select(MaterialTransfer.id).where(
        or_(MaterialTransfer.id == root_id, MaterialTransfer.inspection_hold_root_id == root_id)
    )
    condition = MaterialStockBalance.transfer_id.in_(family)
    if lock:
        # Current reads after the hold lock avoid a stale REPEATABLE READ snapshot.
        # Lock balances only; a waiting worker may already own its transfer row.
        return sum(
            db.scalars(
                select(MaterialStockBalance.on_hand_quantity)
                .where(condition)
                .order_by(MaterialStockBalance.transfer_id)
                .with_for_update()
            )
        )
    return db.scalar(
        select(func.coalesce(func.sum(MaterialStockBalance.on_hand_quantity), 0)).where(condition)
    )


def recheck_context(db, inspection_id):
    row = db.get(Inspection, inspection_id)
    if row is None or row.parent_id or not row.failed_quantity:
        raise HTTPException(409, "请选择原不合格检查记录")
    lot = db.get(MaterialTransfer, row.source_transfer_id)
    balance = db.get(MaterialStockBalance, lot.id)
    return dict(
        source_transfer_id=lot.id,
        team_id=lot.next_team_id,
        serial_no=lot.serial_no,
        batch_no=lot.batch_no,
        material_name=lot.material_name,
        specification=lot.transfer_specification,
        quantity=balance.on_hand_quantity if balance else 0,
        revision=balance.revision if balance else 0,
        hold_id=hold_column_value(db, lot.id),
        processing_status="complete",
    )


def hold_column_value(db, lot_id):
    return db.scalar(select(hold_column(lot_id)))


def record_dict(row, lot, team):
    status = (
        "released"
        if row.released_at
        else "pending"
        if row.failed_quantity and not row.parent_id and row.blocks_outbound
        else "failed"
        if row.failed_quantity
        else "passed"
    )
    return dict(
        id=row.id,
        source_transfer_id=row.source_transfer_id,
        team_id=row.team_id,
        team_name=team.name,
        serial_no=lot.serial_no,
        batch_no=lot.batch_no,
        material_name=lot.material_name,
        specification=lot.transfer_specification,
        inspector_employee_id=row.inspector_employee_id,
        inspector_name=row.inspector_name,
        processing_record_id=row.processing_record_id,
        processor_name=row.processor_name,
        checked_at=row.checked_at.replace(tzinfo=timezone.utc).isoformat(),
        batch_quantity=row.batch_quantity,
        sample_quantity=row.sample_quantity,
        passed_quantity=row.sample_quantity - row.failed_quantity,
        failed_quantity=row.failed_quantity,
        status=status,
        kind=row.kind,
        scope=row.scope,
        methods=row.methods or [],
        items=row.items or [],
        dimension_result=row.dimension_result or "",
        weight_result=row.weight_result or "",
        blocks_outbound=bool(row.blocks_outbound and not row.released_at and row.failed_quantity),
        feedback_status=row.feedback_status,
        disposition=row.disposition,
        decision_notes=row.decision_notes or "",
        feedback_version=row.feedback_version,
        quality_issue_id=(row.parent_id or row.id)
        if row.failed_quantity or row.parent_id
        else None,
        notes=row.notes,
        problems=[dict(id=p.problem_type_id, name=p.name) for p in row.problems],
        parent_id=row.parent_id,
        released_at=row.released_at.replace(tzinfo=timezone.utc).isoformat()
        if row.released_at
        else None,
        created_by=row.created_by,
    )


def create(db, payload, user):
    from . import material_stock as stock
    from .material_transfer_workflow import _require_team_actor, require_team_employee
    from .processing_records import registered_lots

    actor_team = _require_team_actor(user)
    if actor_team.code != INSPECTION_TEAM_CODE:
        raise HTTPException(403, "仅检验班组可登记巡检和检验结果")
    digest = stock.fingerprint(payload)

    def replay(row):
        stock._replay(row, user, digest, "inspection_team_id")
        return record_dict(
            row, db.get(MaterialTransfer, row.source_transfer_id), db.get(Team, row.team_id)
        )

    try:
        with db.begin():
            prior = db.scalar(
                select(Inspection).where(Inspection.idempotency_key == payload.idempotency_key)
            )
            if prior is not None:
                return replay(prior)
        with db.begin():
            lot = stock.lock_lot(db, payload.source_transfer_id)
            prior = db.scalar(
                select(Inspection).where(Inspection.idempotency_key == payload.idempotency_key)
            )
            if prior is not None:
                return replay(prior)
            target = stock.require_team(db, lot.next_team_id)
            if not target.active or target.code not in PROCESSING_TEAM_CODES:
                raise HTTPException(422, "请选择生产班组的已加工在库批次")
            if payload.kind == "inspection" and target.id != actor_team.id:
                raise HTTPException(422, "检验登记请选择检验班组的在库批次")
            balance = db.scalar(
                select(MaterialStockBalance)
                .where(MaterialStockBalance.transfer_id == lot.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if balance is None or balance.revision != payload.expected_revision:
                raise HTTPException(409, "库存已变化，请重新选择巡检批次")
            parent = db.get(Inspection, payload.parent_id) if payload.parent_id else None
            if payload.parent_id and (
                parent is None
                or parent.parent_id
                or not parent.failed_quantity
                or parent.kind != payload.kind
            ):
                raise HTTPException(409, "复检必须关联本批次的原不合格检查")
            if parent:
                family = relatives([parent.source_transfer_id], name="recheck_family")
                if not db.scalar(select(family.c.id).where(family.c.id == lot.id)):
                    raise HTTPException(409, "复检批次不属于原检查物料的后续批次")
            quantity = balance.on_hand_quantity
            if quantity <= 0 or payload.sample_quantity > quantity:
                raise HTTPException(422, "检查件数超过本批当前在库件数，请选择现存批次")
            if payload.scope == "full" and payload.sample_quantity != quantity:
                raise HTTPException(422, "全检件数须等于当前在库件数")
            for team_id in payload.involved_team_ids:
                involved = db.get(Team, team_id)
                if involved is None or not involved.active:
                    raise HTTPException(422, "问题涉及班组不存在或已停用")
            progress = registered_lots(target.id)
            registered = db.execute(
                select(progress.c.processing_status, progress.c.latest_id).where(
                    progress.c.lot_id == lot.id
                )
            ).first()
            state = registered.processing_status if registered else None
            if payload.kind == "patrol" and state not in ("complete", "partial", "registered"):
                raise HTTPException(422, "只能抽检已登记加工的物料")
            now = utcnow()
            if payload.checked_at.replace(tzinfo=None) > now:
                raise HTTPException(422, "检查时间不能晚于当前时间")
            if lot.received_at and payload.checked_at.replace(tzinfo=None) < lot.received_at:
                raise HTTPException(422, "检查时间不能早于本批入库时间")
            employee = require_team_employee(
                db, actor_team.id, payload.inspector_employee_id, "检验人"
            )
            problems = (
                list(
                    db.scalars(
                        select(InspectionProblemType)
                        .where(InspectionProblemType.id.in_(payload.problem_type_ids))
                        .order_by(InspectionProblemType.id)
                        .with_for_update()
                        .execution_options(populate_existing=True)
                    )
                )
                if payload.problem_type_ids
                else []
            )
            if len(problems) != len(payload.problem_type_ids) or any(
                p.team_id != actor_team.id or not p.active for p in problems
            ):
                raise HTTPException(422, "请选择启用的检验问题；无可用选项时请联系检验班组长")
            if parent and payload.checked_at.replace(tzinfo=None) < parent.checked_at:
                raise HTTPException(422, "复检时间不能早于原检查")
            work = (
                db.get(MaterialQuantityAdjustment, registered.latest_id)
                if registered and registered.latest_id
                else None
            )
            row = Inspection(
                processing_record_id=work.id if work else None,
                processor_name=work.processor_name if work else None,
                source_transfer_id=lot.id,
                team_id=target.id,
                inspection_team_id=actor_team.id,
                inspector_employee_id=employee.id,
                inspector_name=employee.name,
                checked_at=payload.checked_at.replace(tzinfo=None),
                batch_quantity=quantity,
                sample_quantity=payload.sample_quantity,
                failed_quantity=payload.failed_quantity,
                kind=payload.kind,
                scope=payload.scope,
                methods=payload.methods,
                items=payload.items,
                dimension_result=payload.dimension_result.strip(),
                weight_result=payload.weight_result.strip(),
                blocks_outbound=False,
                notes=payload.notes.strip(),
                parent_id=payload.parent_id,
                idempotency_key=payload.idempotency_key,
                request_hash=digest,
                created_by=actor_name(user),
                created_by_user_id=user.id,
                created_at=now,
                problems=[InspectionProblem(problem_type_id=p.id, name=p.name) for p in problems],
            )
            db.add(row)
            db.flush()
            # A recheck belongs to the original issue; it does not create another defect count.
            if payload.failed_quantity and not parent:
                db.add_all(
                    [
                        InspectionFeedbackTeam(inspection_id=row.id, team_id=i)
                        for i in payload.involved_team_ids
                    ]
                )
            db.flush()
            db.add(
                MaterialTransferEvent(
                    transfer_id=lot.id,
                    action="inspection_rechecked" if parent else "inspection_recorded",
                    actor=actor_name(user),
                    actor_user_id=user.id,
                    occurred_at=now,
                    changes={
                        "inspection": {
                            "before": None,
                            "after": dict(
                                id=row.id,
                                inspector=employee.name,
                                sample=payload.sample_quantity,
                                failed=payload.failed_quantity,
                                parent_id=payload.parent_id,
                                released=False,
                                blocks_outbound=False,
                                kind=payload.kind,
                                scope=payload.scope,
                                methods=payload.methods,
                                items=payload.items,
                                involved_team_ids=payload.involved_team_ids,
                                problems=[dict(id=p.id, name=p.name) for p in problems],
                            ),
                        }
                    },
                )
            )
            result = record_dict(row, lot, target)
        return result
    except (IntegrityError, OperationalError) as exc:
        db.rollback()
        prior = db.scalar(
            select(Inspection).where(Inspection.idempotency_key == payload.idempotency_key)
        )
        if prior is not None:
            return replay(prior)
        stock._db_conflict(exc)


def list_records(
    db,
    *,
    team_id=None,
    source_transfer_id=None,
    query=None,
    inspector_id=None,
    status=None,
    kind=None,
    scope=None,
    problem_type_id=None,
    date_from=None,
    date_to=None,
    page=1,
    page_size=20,
):
    from .material_stock import literal_query

    conditions = list(
        RecordFilters(date_from=date_from, date_to=date_to).dates(Inspection.checked_at)
    )
    for column, value in (
        (Inspection.team_id, team_id),
        (Inspection.kind, kind),
        (Inspection.scope, scope),
        (Inspection.inspector_employee_id, inspector_id),
    ):
        if value is not None:
            conditions.append(column == value)
    if problem_type_id is not None:
        conditions.append(
            Inspection.problems.any(InspectionProblem.problem_type_id == problem_type_id)
        )
    if source_transfer_id is not None:
        ancestry = relatives([source_transfer_id], ancestors=True, name="inspection_ancestry")
        ancestors = select(ancestry.c.id)
        roots = select(Inspection.id).where(Inspection.source_transfer_id.in_(ancestors))
        conditions.append(
            or_(Inspection.source_transfer_id.in_(ancestors), Inspection.parent_id.in_(roots))
        )
    if query and query.strip():
        conditions.append(
            literal_query(
                query,
                [
                    MaterialTransfer.serial_no,
                    MaterialTransfer.batch_no,
                    MaterialTransfer.material_name,
                    Inspection.inspector_name,
                ],
            )
        )
    if status == "pending":
        conditions.extend(hold_conditions())
    elif status == "released":
        conditions.append(Inspection.released_at.is_not(None))
    elif status == "passed":
        conditions.append(Inspection.failed_quantity == 0)
    elif status == "failed":
        conditions.append(Inspection.failed_quantity > 0)
    stmt = (
        select(Inspection, MaterialTransfer, Team)
        .join(MaterialTransfer, MaterialTransfer.id == Inspection.source_transfer_id)
        .join(Team, Team.id == Inspection.team_id)
        .where(*conditions)
    )
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(
        stmt.order_by(Inspection.checked_at.desc(), Inspection.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return dict(
        items=[record_dict(*row) for row in rows], total=total, page=page, page_size=page_size
    )


def list_sources(
    db, team_id, query=None, page=1, page_size=20, kind="patrol", recheck_id=None, group_id=None
):
    from .material_stock import literal_query
    from .processing_records import registered_lots, require_processing_team

    team = require_processing_team(db, team_id)
    if kind == "inspection" and team.code != INSPECTION_TEAM_CODE:
        raise HTTPException(422, "检验登记请选择检验班组库存")
    registered = registered_lots(team_id)
    stmt = (
        select(
            MaterialTransfer,
            MaterialStockBalance,
            registered.c.processing_status,
            hold_column(MaterialTransfer.id).label("hold_id"),
        )
        .join(MaterialStockBalance, MaterialStockBalance.transfer_id == MaterialTransfer.id)
        .outerjoin(registered, registered.c.lot_id == MaterialTransfer.id)
        .where(
            MaterialStockBalance.team_id == team_id,
            MaterialStockBalance.on_hand_quantity > 0,
            registered.c.processing_status.in_(("complete", "partial", "registered"))
            if kind == "patrol"
            else True,
        )
    )
    if recheck_id:
        root = db.get(Inspection, recheck_id)
        if root is None or root.parent_id or not root.failed_quantity or root.kind != kind:
            raise HTTPException(422, "请选择原不合格检查")
        family = relatives([root.source_transfer_id], name="recheck_sources")
        stmt = stmt.where(MaterialTransfer.id.in_(select(family.c.id)))
    if group_id is not None:
        from .warehouse_inventory import group_conditions, origin_columns

        origins = origin_columns()
        anchor = (
            db.execute(
                select(*(column.label(name) for name, column in origins.items())).where(
                    MaterialTransfer.id == group_id,
                    MaterialTransfer.next_team_id == team_id,
                    MaterialTransfer.status == "received",
                    MaterialTransfer.stock_tracked.is_(True),
                )
            )
            .mappings()
            .first()
        )
        if anchor is None:
            raise HTTPException(404, "未找到本班组库存来源")
        stmt = stmt.where(*group_conditions(origins, anchor))
    if query and query.strip():
        stmt = stmt.where(
            literal_query(
                query,
                [
                    MaterialTransfer.serial_no,
                    MaterialTransfer.batch_no,
                    MaterialTransfer.material_name,
                ],
            )
        )
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(
        stmt.order_by(MaterialTransfer.received_at.desc(), MaterialTransfer.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return dict(
        items=[
            dict(
                source_transfer_id=lot.id,
                team_id=team_id,
                serial_no=lot.serial_no,
                batch_no=lot.batch_no,
                material_name=lot.material_name,
                specification=lot.transfer_specification,
                quantity=balance.on_hand_quantity,
                revision=balance.revision,
                hold_id=hold,
                processing_status=status,
            )
            for lot, balance, status, hold in rows
        ],
        total=total,
        page=page,
        page_size=page_size,
    )
