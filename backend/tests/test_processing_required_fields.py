"""Daily production requires the fields for its team, including direct API writes."""

from types import SimpleNamespace

import pytest
from app.processing_parameters import recorded_parameters
from app.schemas import ProcessingQuantity
from fastapi import HTTPException


def payload(**values):
    return ProcessingQuantity(
        **{
            "source_transfer_id": 1,
            "quantity": 10,
            "expected_revision": 0,
            "processor_name": "张师傅",
            "processing_mode": "unit",
            "processing_minutes": 60,
            "reason": "无",
            **values,
        }
    )


@pytest.mark.parametrize("mode", ["unit", "split"])
@pytest.mark.parametrize("field", ["processing_minutes", "machine_no"])
@pytest.mark.parametrize(
    "code", ["FACTORY-ROLL", "FACTORY-GRIND", "FACTORY-WIRE", "FACTORY-ENGRAVE"]
)
def test_machine_work_requires_duration_and_machine(code, mode, field):
    data = {
        "processing_mode": mode,
        "machine_no": "M01",
        "equipment_id": 1 if field != "machine_no" else None,
        field: None,
    }
    with pytest.raises(HTTPException) as error:
        recorded_parameters(payload(**data), code, db=equipment_db(), team_id=1)
    assert error.value.status_code == 422
    assert ("加工时长" if field == "processing_minutes" else "机台号") in error.value.detail


def test_anneal_requires_all_fields_and_accepts_zero_temperature():
    data = dict(
        equipment_id=1,
        furnace_no="2炉",
        temperature_requirement="0 °C",
        actual_temperature_c=0,
        holding_minutes=30,
    )
    for field in (
        "equipment_id",
        "temperature_requirement",
        "actual_temperature_c",
        "holding_minutes",
    ):
        with pytest.raises(HTTPException) as error:
            recorded_parameters(
                payload(**{**data, field: None}), "FACTORY-ANNEAL", db=equipment_db(), team_id=1
            )
        assert error.value.status_code == 422
    saved = recorded_parameters(payload(**data), "FACTORY-ANNEAL", db=equipment_db(), team_id=1)
    assert saved["actual_temperature_c"] == 0
    assert saved["furnace_no"] == "2炉"


def test_teams_without_parameters_still_require_duration():
    with pytest.raises(HTTPException, match="加工时长"):
        recorded_parameters(payload(processing_minutes=None), "FACTORY-QC")
    recorded_parameters(payload(), "FACTORY-QC")


def test_legacy_piece_corrections_do_not_require_daily_report_parameters():
    recorded_parameters(payload(processing_mode=None, processing_minutes=None), "FACTORY-ROLL")


def equipment_db():
    return SimpleNamespace(
        scalar=lambda query: SimpleNamespace(id=1, team_id=1, active=True, name="2炉")
    )
