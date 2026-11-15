"""Team-specific recorded parameters; no inference from process instructions."""

from fastapi import HTTPException
from sqlalchemy import select

from .models import TeamEquipment

PARAMETER_FIELDS = (
    "furnace_no",
    "temperature_requirement",
    "actual_temperature_c",
    "holding_minutes",
    "machine_no",
)
TEAM_PARAMETER_FIELDS = {
    "FACTORY-ANNEAL": PARAMETER_FIELDS[:4],
    **{
        code: ("machine_no",)
        for code in ("FACTORY-ROLL", "FACTORY-GRIND", "FACTORY-WIRE", "FACTORY-ENGRAVE")
    },
}
EQUIPMENT_FIELDS = {
    code: "furnace_no" if code == "FACTORY-ANNEAL" else "machine_no"
    for code in TEAM_PARAMETER_FIELDS
}

PARAMETER_LABELS = {
    "furnace_no": "炉号",
    "temperature_requirement": "工艺温度要求",
    "actual_temperature_c": "实际温度",
    "holding_minutes": "保温时长",
    "machine_no": "机台号",
}


def parameter_fields(team_code):
    return TEAM_PARAMETER_FIELDS.get(team_code, ())


def recorded_parameters(payload, team_code, *, db=None, team_id=None):
    allowed = parameter_fields(team_code)
    values = {key: getattr(payload, key) for key in PARAMETER_FIELDS}
    if any(value is not None and key not in allowed for key, value in values.items()):
        raise HTTPException(422, "加工参数与本班组不符，请刷新后重试")
    equipment_field = EQUIPMENT_FIELDS.get(team_code)
    if payload.equipment_id is not None:
        if equipment_field is None:
            raise HTTPException(422, "本班组不登记加工设备")
        equipment = db.scalar(
            select(TeamEquipment)
            .where(TeamEquipment.id == payload.equipment_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if equipment is None or equipment.team_id != team_id or not equipment.active:
            raise HTTPException(422, "请选择本班组启用的设备")
        values[equipment_field] = equipment.name
    elif payload.processing_mode is not None and equipment_field:
        raise HTTPException(422, "请选择本班组的" + PARAMETER_LABELS[equipment_field])
    # Legacy piece corrections and historical records do not register daily production.
    if payload.processing_mode is not None:
        missing = ["加工时长"] if payload.processing_minutes is None else []
        if not payload.reason.strip():
            missing.append("备注（无特殊情况请填无）")
        missing.extend(PARAMETER_LABELS[key] for key in allowed if values[key] is None)
        if missing:
            raise HTTPException(422, "请填写" + "、".join(missing))
    return {**values, "equipment_id": payload.equipment_id}


def parameter_snapshot(row):
    return {
        "equipment_id": row.equipment_id,
        **{
            key: float(value) if key == "actual_temperature_c" and value is not None else value
            for key in PARAMETER_FIELDS
            for value in [getattr(row, key)]
        },
    }
