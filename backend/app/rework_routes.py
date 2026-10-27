"""A rework request isolates physical stock; engineering supplies its execution route."""

from decimal import Decimal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError

from . import material_stock as stock
from . import material_transfer_workflow as workflow
from .auth import actor_name
from .batch_numbers import next_transfer_batch_numbers
from .material_lineage import relatives
from .models import (
    InspectionFeedbackTeam,
    InspectionProblem,
    MaterialInspection,
    MaterialTransfer,
    MaterialTransferEvent,
    ProcessRoute,
    ProductionSchedule,
    Team,
    utcnow,
)
from .models import MaterialQuantityAdjustment as Work
from .models import MaterialStockBalance as Balance
from .schemas import SCRAP_MATERIAL_TYPES


class ReworkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_transfer_id: int = Field(ge=1)
    rework_of_id: int = Field(ge=1)
    inspection_id: int | None = Field(default=None, ge=1)
    expected_revision: int = Field(ge=0)
    quantity: int = Field(gt=0, le=2_147_483_647)
    weight: Decimal = Field(gt=0, max_digits=17, decimal_places=6)
    reason: str = Field(min_length=1, max_length=2000)
    idempotency_key: str = Field(min_length=1, max_length=100)

    @field_validator("reason", "idempotency_key")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("请填写返工原因")
        return value.strip()


def active(lot):
    return bool(lot.process_route_id and lot.process_route.route_kind == "rework")


def pending(lot):
    return bool(lot.rework_route_id and lot.rework_route.state != "published")


def can_revise(db, route):
    lot = db.get(MaterialTransfer, route.rework_source_transfer_id)
    balance = db.get(Balance, lot.id)
    return bool(
        lot.rework_route_id == route.id
        and balance
        and balance.on_hand_quantity == lot.quantity
        and balance.on_hand_weight == lot.weight
        and not balance.reserved_quantity
        and not balance.reserved_weight
        and db.scalar(select(Work.id).where(Work.source_transfer_id == lot.id).limit(1)) is None
        and db.scalar(
            select(MaterialTransfer.id)
            .where(MaterialTransfer.source_transfer_id == lot.id)
            .limit(1)
        )
        is None
    )


def require_unstarted(db, route):
    lot = stock.lock_lot(db, route.rework_source_transfer_id)
    db.scalar(
        select(Balance)
        .where(Balance.transfer_id == lot.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if not can_revise(db, route):
        raise HTTPException(409, "返工已开始或实物已变化，原工艺保留；再次返工须登记新事项")
    return lot


def request_documents(db, routes):
    """Load a bounded page's rework context without one query per route."""
    routes = [row for row in routes if row.route_kind == "rework"]
    if not routes:
        return {}
    lots = {
        row.id: row
        for row in db.execute(
            select(
                MaterialTransfer.id,
                MaterialTransfer.batch_no,
                MaterialTransfer.next_team_id,
                MaterialTransfer.next_team_name,
                MaterialTransfer.quantity,
                MaterialTransfer.weight,
            ).where(MaterialTransfer.id.in_([row.rework_source_transfer_id for row in routes]))
        )
    }
    inspection_ids = [row.rework_inspection_id for row in routes if row.rework_inspection_id]
    inspections = {}
    problems, teams = {}, {}
    if inspection_ids:
        inspections = {
            row.id: row
            for row in db.execute(
                select(
                    MaterialInspection.id,
                    MaterialInspection.kind,
                    MaterialInspection.notes,
                    MaterialInspection.inspector_name,
                    MaterialInspection.dimension_result,
                    MaterialInspection.weight_result,
                ).where(MaterialInspection.id.in_(inspection_ids))
            )
        }
        for inspection_id, name in db.execute(
            select(InspectionProblem.inspection_id, InspectionProblem.name)
            .where(InspectionProblem.inspection_id.in_(inspection_ids))
            .order_by(InspectionProblem.problem_type_id)
        ):
            problems.setdefault(inspection_id, []).append(name)
        for inspection_id, team_id, name in db.execute(
            select(InspectionFeedbackTeam.inspection_id, Team.id, Team.name)
            .join(Team, Team.id == InspectionFeedbackTeam.team_id)
            .where(InspectionFeedbackTeam.inspection_id.in_(inspection_ids))
            .order_by(Team.id)
        ):
            teams.setdefault(inspection_id, []).append({"id": team_id, "name": name})
    execution = {
        route_id: list(dict.fromkeys(step["team_name"] for step in steps if step.get("team_name")))
        for route_id, steps in db.execute(
            select(ProcessRoute.id, ProcessRoute.steps).where(
                ProcessRoute.id.in_([row.id for row in routes if row.state == "published"])
            )
        )
    }
    tasks = dict(
        db.execute(
            select(ProductionSchedule.id, ProductionSchedule.task_id).where(
                ProductionSchedule.id.in_(
                    [r.original_schedule_id for r in routes if r.original_schedule_id]
                )
            )
        ).all()
    )
    result = {}
    for route in routes:
        lot = lots[route.rework_source_transfer_id]
        inspection = inspections.get(route.rework_inspection_id)
        result[route.id] = {
            "source_transfer_id": lot.id,
            "batch_no": lot.batch_no,
            "team_id": lot.next_team_id,
            "team_name": lot.next_team_name,
            "quantity": lot.quantity,
            "weight": float(lot.weight),
            "reason": route.request_reason,
            "requesting_team_id": route.requesting_team_id,
            "requesting_team_name": route.requesting_team_name,
            "requested_by": route.requested_by,
            "rework_of_id": route.rework_of_id,
            "original_schedule_id": route.original_schedule_id,
            "original_task_id": tasks.get(route.original_schedule_id),
            "inspection_id": route.rework_inspection_id,
            "inspection_kind": inspection.kind if inspection else None,
            "inspector_name": inspection.inspector_name if inspection else None,
            "problem_names": problems.get(route.rework_inspection_id, []),
            "problem_notes": inspection.notes if inspection else "",
            "dimension_result": inspection.dimension_result if inspection else "",
            "weight_result": inspection.weight_result if inspection else "",
            "problem_teams": teams.get(route.rework_inspection_id, []),
            "execution_team_names": execution.get(route.id, []),
            "round": route.rework_round,
            "resume_route_id": route.resume_route_id,
            "resume_step_index": route.resume_step_index,
            "resume_step_name": None,
            "resume_team_id": route.resume_team_id,
        }
    return result


def request_document(db, route):
    if route.route_kind != "rework":
        return None
    resume = db.get(ProcessRoute, route.resume_route_id) if route.resume_route_id else None
    return {
        **request_documents(db, [route])[route.id],
        "can_modify": route.state == "published" and can_revise(db, route),
        "resume_step_name": f"{resume.steps[route.resume_step_index]['sequence_no']} · {resume.steps[route.resume_step_index]['name']}（{resume.steps[route.resume_step_index].get('team_name', '')}）"
        if resume
        else None,
    }


def source_stock(db, user, query="", page=1, lot_id=None):
    """Direct team submissions select physical stock, never a free-form serial."""
    team = stock.require_actor(user, user.team_id)
    if team.kind == "engineering":
        raise HTTPException(403, "请由物料所在班组提交返工问题")
    stmt = (
        select(MaterialTransfer, Balance)
        .join(Balance, Balance.transfer_id == MaterialTransfer.id)
        .where(
            MaterialTransfer.next_team_id == team.id,
            MaterialTransfer.status == "received",
            MaterialTransfer.stock_tracked.is_(True),
            MaterialTransfer.rework_route_id.is_(None),
            or_(
                MaterialTransfer.material_type.is_(None),
                MaterialTransfer.material_type.not_in(SCRAP_MATERIAL_TYPES),
            ),
            Balance.on_hand_quantity > 0,
            Balance.on_hand_weight > 0,
        )
    )
    if lot_id is not None:
        pair = db.execute(stmt.where(MaterialTransfer.id == lot_id)).one_or_none()
        if pair is None:
            raise HTTPException(409, "本批库存已变化，请重新选择")
        from .quantity_adjustments import context

        lot, _ = pair
        result = context(db, team.id, lot.id)
        path = relatives([lot.id], ancestors=True, name="team_rework_history")
        ids = set(db.scalars(select(path.c.id)))
        records = db.scalars(
            select(Work)
            .where(Work.source_transfer_id.in_(ids), Work.processing_status.is_not(None))
            .order_by(Work.id.desc())
            .limit(100)
        )
        result["rework_task_records"] = [
            dict(
                rework_of_id=record.id,
                process_step_name=record.process_step_name,
                processing_task_name=record.processing_task_name,
            )
            for record in records
            if not record.outputs
            or any(item["id"] in ids and item["role"] == "produced" for item in record.outputs)
        ]
        result["rework_of_id"] = None
        return result
    if query.strip():
        stmt = stmt.where(
            or_(
                MaterialTransfer.serial_no.contains(query.strip(), autoescape=True),
                MaterialTransfer.batch_no.contains(query.strip(), autoescape=True),
            )
        )
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.execute(stmt.order_by(MaterialTransfer.id.desc()).offset((page - 1) * 10).limit(10))
    return dict(
        items=[
            dict(
                id=lot.id,
                serial_no=lot.serial_no,
                batch_no=lot.batch_no,
                quantity=balance.on_hand_quantity,
                weight=float(balance.on_hand_weight),
            )
            for lot, balance in rows
        ],
        total=total,
        page=page,
        page_size=10,
    )


def request_rework(db, payload, user):
    from .process_route_api import document
    from .quality_feedback import is_qc, require_rework_issue

    team = stock.require_actor(user, user.team_id)
    if team.kind == "engineering":
        raise HTTPException(403, "请由物料所在班组提交返工问题")
    request_hash = stock.fingerprint(payload)

    def replay(row):
        if row.created_by_user_id != user.id or row.request_hash != request_hash:
            raise HTTPException(409, "重复请求的班组或内容不一致")
        return document(row, db=db)

    try:
        with db.begin():
            prior = db.scalar(
                select(ProcessRoute).where(ProcessRoute.request_key == payload.idempotency_key)
            )
            if prior:
                return replay(prior)
            if payload.inspection_id and is_qc(user):
                require_rework_issue(db, payload.inspection_id, user, lock=True)
            from .inspections import lock_hold

            hold = lock_hold(db, payload.source_transfer_id)
            lot = stock.lock_lot(db, payload.source_transfer_id)
            if lot.next_team_id != user.team_id and not (payload.inspection_id and is_qc(user)):
                raise HTTPException(403, "只能提交本班组在库批次的返工问题")
            if lot.status != "received" or not lot.stock_tracked:
                raise HTTPException(409, "请选择已签收的在库批次")
            # Recheck after the source lock: retries must not reserve another portion.
            prior = db.scalar(
                select(ProcessRoute)
                .where(ProcessRoute.request_key == payload.idempotency_key)
                .execution_options(populate_existing=True)
            )
            if prior:
                return replay(prior)
            if lot.material_type in SCRAP_MATERIAL_TYPES or pending(lot) or active(lot):
                raise HTTPException(409, "请选择正常在库料；已有返工事项的批次不能重复申请")
            balance = db.scalar(
                select(Balance)
                .where(Balance.transfer_id == lot.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if not balance or balance.revision != payload.expected_revision:
                raise HTTPException(409, "库存已变化，请刷新后重新选择返工数量")
            if (
                payload.quantity > balance.on_hand_quantity
                or payload.weight > balance.on_hand_weight
            ):
                raise HTTPException(422, "返工件数或重量超过在库数量")
            if (payload.quantity == balance.on_hand_quantity) != (
                payload.weight == balance.on_hand_weight
            ):
                raise HTTPException(
                    422, "整批返工须包含全部在库件数和重量，部分返工须保留剩余件数与重量"
                )
            path = relatives([lot.id], ancestors=True, name="rework_request_ancestors")
            work = db.scalar(
                select(Work).where(
                    Work.id == payload.rework_of_id,
                    Work.source_transfer_id.in_(select(path.c.id)),
                    Work.processing_status.is_not(None),
                )
            )
            if work is None:
                raise HTTPException(422, "原加工记录不属于本批物料")
            if work.outputs:
                descendants = set(db.scalars(select(path.c.id)))
                if not any(
                    item["id"] in descendants and item["role"] == "produced"
                    for item in work.outputs
                ):
                    raise HTTPException(422, "所选工序未加工这部分料，不能关联返工")
            inspection = db.scalar(
                select(MaterialInspection).where(
                    MaterialInspection.id == payload.inspection_id,
                    MaterialInspection.source_transfer_id.in_(select(path.c.id)),
                    MaterialInspection.failed_quantity > 0,
                )
            )
            if payload.inspection_id and inspection is None:
                raise HTTPException(422, "质量问题记录不属于本批物料")
            now = utcnow()
            fields = {key: getattr(lot, key) for key in workflow.DOCUMENT_FIELDS}
            fields.update(delivery_date=None, delivery_quantity=None)
            child = MaterialTransfer(
                batch_no=next_transfer_batch_numbers(db, 1)[0],
                serial_no=lot.serial_no,
                entry_kind="rework_split",
                source_transfer_id=lot.id,
                source_team_id=lot.next_team_id,
                source_team_code=lot.next_team_code,
                source_team_name=lot.next_team_name,
                next_team_id=lot.next_team_id,
                next_team_code=lot.next_team_code,
                next_team_name=lot.next_team_name,
                quantity=payload.quantity,
                weight=payload.weight,
                status="received",
                stock_tracked=True,
                processing_role=lot.processing_role,
                rework_pending=True,
                processing_schedule_id=lot.processing_schedule_id or work.production_schedule_id,
                rework_count=lot.rework_count,
                process_route_id=lot.process_route_id,
                process_step_index=lot.process_step_index,
                process_step_complete=lot.process_step_complete,
                shared_group_id=lot.shared_group_id,
                shared_unallocated=lot.shared_unallocated,
                purpose_id=lot.purpose_id,
                purpose_name=lot.purpose_name,
                inspection_hold_root_id=hold.source_transfer_id
                if hold
                else lot.inspection_hold_root_id,
                warehouse_location=lot.warehouse_location,
                delivery_origin_id=lot.delivery_origin_id or lot.id,
                notes=payload.reason,
                created_by=actor_name(user),
                created_by_user_id=user.id,
                received_by=actor_name(user),
                received_by_user_id=user.id,
                created_at=now,
                updated_at=now,
                received_at=now,
                **fields,
            )
            db.add(child)
            db.flush()
            route = ProcessRoute(
                route_kind="rework",
                title=f"{lot.serial_no} · 返工",
                filename="",
                source_file=b"",
                source_sha256="",
                source_data={"tables": [], "issues": []},
                serial_nos=lot.process_route.serial_nos
                if lot.shared_unallocated and lot.process_route_id
                else [lot.serial_no],
                steps=[],
                rework_source_transfer_id=child.id,
                rework_of_id=work.id,
                original_schedule_id=lot.processing_schedule_id or work.production_schedule_id,
                rework_inspection_id=payload.inspection_id,
                resume_route_id=lot.process_route_id,
                resume_step_index=lot.process_step_index,
                resume_step_complete=lot.process_step_complete,
                resume_team_id=lot.next_team_id,
                rework_round=lot.rework_count + 1,
                request_reason=payload.reason,
                requesting_team_id=team.id,
                requesting_team_name=team.name,
                requested_by=actor_name(user),
                request_key=payload.idempotency_key,
                request_hash=request_hash,
                created_by=actor_name(user),
                created_by_user_id=user.id,
            )
            db.add(route)
            db.flush()
            from .process_route_drawings import copy_drawings
            from .rework_notices import notify_engineering

            copy_drawings(db, lot.process_route_id or work.process_route_id, route.id)
            notify_engineering(db, route)
            child.rework_route_id = route.id
            db.add(
                MaterialTransferEvent(
                    transfer_id=child.id,
                    action="rework_requested",
                    actor=actor_name(user),
                    actor_user_id=user.id,
                    occurred_at=now,
                    changes={
                        "rework_route": {
                            "before": None,
                            "after": {
                                "id": route.id,
                                "rework_of_id": work.id,
                                "reason": payload.reason,
                                "quantity": payload.quantity,
                                "weight": float(payload.weight),
                            },
                        }
                    },
                )
            )
            workflow._record_event(db, child, user, "created")
            db.flush()
            return document(route, db=db)
    except IntegrityError:
        db.rollback()
        prior = db.scalar(
            select(ProcessRoute).where(ProcessRoute.request_key == payload.idempotency_key)
        )
        if prior:
            return replay(prior)
        raise HTTPException(409, "库存或返工申请已变化，请刷新后重试") from None


def activate(db, route):
    if route.route_kind != "rework":
        return
    if not route.engineering_employee_id:
        raise HTTPException(422, "返工工艺必须选择工艺人员")
    lot = stock.lock_lot(db, route.rework_source_transfer_id)
    balance = db.scalar(select(Balance).where(Balance.transfer_id == lot.id).with_for_update())
    if (
        not balance
        or balance.on_hand_quantity != lot.quantity
        or balance.on_hand_weight != lot.weight
        or balance.reserved_quantity
        or balance.reserved_weight
    ):
        raise HTTPException(409, "返工实物已变化，请核对后重新登记事项")
    if route.parent_id:
        previous = db.get(ProcessRoute, route.parent_id)
        require_unstarted(db, previous)
        lot.rework_route = route
    elif lot.rework_route_id != route.id or not lot.rework_pending:
        raise HTTPException(409, "返工批次已变化，请重新核对")
    if route.resume_route_id:
        original = db.get(ProcessRoute, route.resume_route_id)
        if route.resume_step_index is None or route.resume_step_index >= len(original.steps):
            raise HTTPException(422, "请选择返工后接回的正常工序")
        step = original.steps[route.resume_step_index]
        if step.get("serial_nos") and lot.serial_no not in step["serial_nos"]:
            raise HTTPException(422, "返回工序不适用于本批流水号")
        route.resume_team_id = step["team_id"]
    lot.process_route = route
    lot.process_step_index, lot.process_step_complete = 0, False
    lot.version += 1


def original_work(db, lot, payload):
    if pending(lot) or not active(lot):
        raise HTTPException(422, "请先登记返工事项，由工艺人员制定返工工艺后再加工")
    route = lot.process_route
    if payload.rework_of_id not in (None, route.rework_of_id):
        raise HTTPException(422, "返工原加工记录与工艺不一致")
    return db.get(Work, route.rework_of_id)


def resume_fields(route):
    return {
        "process_route_id": route.resume_route_id,
        "process_step_index": route.resume_step_index,
        "process_step_complete": route.resume_step_complete,
        "rework_route_id": None,
    }


def dispatch_fields(lot, target, rework_return):
    from .process_routes import next_index

    if pending(lot):
        raise HTTPException(422, "返工工艺尚未制定，不能转出")
    if not active(lot):
        if rework_return:
            raise HTTPException(422, "请先登记返工事项，由工艺人员确定返工工序和班组")
        return None
    route = lot.process_route
    index = lot.process_step_index
    step = route.steps[index]
    if step["team_id"] == lot.next_team_id:
        if not lot.process_step_complete:
            raise HTTPException(422, "本批返工工序尚未完成，不能转出")
        index = next_index(route, index, lot.serial_no, lot.shared_unallocated)
    if index is None:
        if not target or target.id != route.resume_team_id:
            raise HTTPException(422, "返工完成后须转回工艺人员指定的正常工序班组")
        return resume_fields(route)
    step = route.steps[index]
    if not target or target.id != step["team_id"]:
        raise HTTPException(422, f"返工须按工艺转入{step['name']}（{step['team_name']}）")
    return {
        "process_route_id": route.id,
        "process_step_index": index,
        "process_step_complete": False,
        "rework_route_id": route.id,
    }


def resume(db, lot, user, expected_revision):
    from .process_routes import next_index, route_document

    stock.require_actor(user, lot.next_team_id)
    balance = db.scalar(
        select(Balance)
        .where(Balance.transfer_id == lot.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if (
        not balance
        or balance.revision != expected_revision
        or balance.reserved_quantity
        or balance.reserved_weight
    ):
        raise HTTPException(409, "库存已变化，请刷新后核对")
    if (
        not active(lot)
        or not lot.process_step_complete
        or next_index(
            lot.process_route, lot.process_step_index, lot.serial_no, lot.shared_unallocated
        )
        is not None
    ):
        raise HTTPException(422, "返工工序尚未全部完成")
    route = lot.process_route
    if lot.next_team_id != route.resume_team_id:
        raise HTTPException(422, "请先转回工艺人员指定的正常工序班组")
    for key, value in resume_fields(route).items():
        setattr(lot, key, value)
    lot.process_route = (
        db.get(ProcessRoute, route.resume_route_id) if route.resume_route_id else None
    )
    if route.original_schedule_id:
        lot.processing_schedule_id = route.original_schedule_id
    lot.rework_route = None
    lot.rework_pending = False
    lot.version += 1
    db.add(
        MaterialTransferEvent(
            transfer_id=lot.id,
            action="rework_resumed",
            actor=actor_name(user),
            actor_user_id=user.id,
            occurred_at=utcnow(),
            changes={"process_route": {"before": {"id": route.id}, "after": route_document(lot)}},
        )
    )
    db.flush()
    return {"current": route_document(lot)}
