"""Normalize explicit production work into the existing lot and adjustment ledger."""

from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from .config import settings
from .schemas import ProcessingOutput
from .team_constants import PROCESSING_TEAM_CODES, SPLITTING_TEAM_CODES

METRICS = (
    "input_quantity",
    "input_weight",
    "completed_quantity",
    "completed_weight",
    "scrap_quantity",
    "scrap_weight",
)


SUMMARY_METRICS = METRICS + (
    "rework_quantity",
    "rework_weight",
    "rework_record_count",
    "work_quantity",
    "work_weight",
)


def prepare(lot, balance, latest, payload, team_code):
    splitting = team_code in SPLITTING_TEAM_CODES
    if payload.processing_mode is None:
        if not splitting:
            raise HTTPException(422, "本班组按件登记加工，不能修改加工件数或拆分产出")
        return payload, {}
    if payload.processing_mode != ("split" if splitting else "unit"):
        raise HTTPException(422, "加工方式与本班组不符，请刷新后重试")
    if not payload.processor_employee_id or not payload.processing_date:
        raise HTTPException(422, "请选择加工人并填写实际加工日期")
    if payload.processing_date > datetime.now(ZoneInfo(settings.factory_timezone)).date():
        raise HTTPException(422, "实际加工日期不能晚于今天")
    if (
        payload.work_kind != "rework"
        and payload.processing_task_id is None
        and (
            lot.processing_role == "produced" or (latest and latest.processing_status == "complete")
        )
    ):
        raise HTTPException(409, "本班组已加工完成，请选择未加工库存，避免重复登记产量")
    q, w = balance.on_hand_quantity, balance.on_hand_weight
    if q < 0 or w < 0:
        raise HTTPException(409, "本批历史库存需先核对，不能据此登记日产")
    if not splitting:
        if payload.outputs is not None:
            raise HTTPException(422, "普通加工无需填写拆分产出")
        done, weight = payload.completed_quantity, payload.completed_weight
        if done is None or done > q or weight is None:
            raise HTTPException(422, "请填写本次完成件数与重量，完成件数不能超过未加工件数")
        remaining = q - done
        if remaining and weight > w:
            raise HTTPException(422, "部分加工重量超过本批库存，请核对已加工与未加工重量")
        outputs = [
            ProcessingOutput(
                role="produced",
                quantity=done,
                weight=weight,
                material_type=lot.material_type or "semi_finished",
                transfer_specification=lot.transfer_specification,
            )
        ]
        if remaining:
            outputs.append(
                ProcessingOutput(
                    role="remaining",
                    quantity=remaining,
                    weight=w - weight,
                    material_type=lot.material_type or "semi_finished",
                    transfer_specification=lot.transfer_specification,
                )
            )
        payload = payload.model_copy(
            update={
                "quantity": q,
                "outputs": outputs,
                "processing_status": "partial" if remaining else "complete",
            }
        )
        input_quantity = done
    else:
        input_quantity = payload.input_quantity
        if input_quantity is None or input_quantity > q:
            raise HTTPException(422, "请填写本次实际投入件数，不能超过本批未加工件数")
        if payload.outputs is None:
            # Inline outbound supports whole-lot completion only. Partial work
            # must first create separately selectable physical output lots.
            if payload.processing_status != "complete":
                raise HTTPException(422, "部分加工请先按明细登记已加工料和未加工料")
            if input_quantity != q:
                raise HTTPException(422, "整批加工的投入件数应等于本批未加工件数")
            if payload.quantity <= 0:
                raise HTTPException(422, "请填写实际加工产出件数")
            return payload, dict(
                processing_date=payload.processing_date,
                processing_mode="split",
                input_quantity=input_quantity,
                input_weight=w,
                completed_quantity=payload.quantity,
                completed_weight=w,
                scrap_quantity=0,
                scrap_weight=Decimal(0),
            )
    produced = [line for line in payload.outputs if line.role == "produced"]
    remaining = [line for line in payload.outputs if line.role == "remaining"]
    scrap = [line for line in payload.outputs if line.role == "scrap"]
    if splitting and not remaining and input_quantity != q:
        raise HTTPException(422, "整批加工的投入件数应等于本批未加工件数")
    if not produced:
        raise HTTPException(422, "请至少登记一项已加工产出")
    if sum(line.quantity for line in remaining) > q or sum(line.weight for line in remaining) > w:
        raise HTTPException(422, "剩余未加工料超过来源库存，请核对")
    payload = payload.model_copy(
        update={"processing_status": "partial" if remaining else "complete"}
    )
    return payload, dict(
        processing_date=payload.processing_date,
        processing_mode=payload.processing_mode,
        input_quantity=input_quantity,
        input_weight=w - sum((line.weight for line in remaining), Decimal(0)),
        completed_quantity=sum(line.quantity for line in produced),
        completed_weight=sum((line.weight for line in produced), Decimal(0)),
        scrap_quantity=sum(line.quantity for line in scrap),
        scrap_weight=sum((line.weight for line in scrap), Decimal(0)),
    )


def completed_route_step(lot):
    route, index = lot.process_route, lot.process_step_index
    return bool(
        not lot.rework_pending
        and route
        and lot.process_step_complete
        and index is not None
        and index < len(route.steps)
        and route.steps[index]["team_id"] == lot.next_team_id
    )


def sent_status(lot, latest=None):
    if lot.next_team_code not in PROCESSING_TEAM_CODES:
        return None
    if lot.rework_pending:
        return "unregistered"
    if latest:
        return latest.processing_status or "registered"
    return (
        "complete"
        if lot.processing_role == "produced" or completed_route_step(lot)
        else "not_applicable"
        if lot.processing_role == "scrap"
        else "unregistered"
    )
