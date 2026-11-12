"""Team-specific recorded parameters; no inference from process instructions."""

from fastapi import HTTPException

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


def parameter_fields(team_code):
    return TEAM_PARAMETER_FIELDS.get(team_code, ())


def recorded_parameters(payload, team_code):
    allowed = parameter_fields(team_code)
    values = {key: getattr(payload, key) for key in PARAMETER_FIELDS}
    if any(value is not None and key not in allowed for key, value in values.items()):
        raise HTTPException(422, "加工参数与本班组不符，请刷新后重试")
    return values


def parameter_snapshot(row):
    return {
        key: float(value) if key == "actual_temperature_c" and value is not None else value
        for key in PARAMETER_FIELDS
        for value in [getattr(row, key)]
    }
