from datetime import date
from decimal import Decimal
from types import SimpleNamespace

import pytest
from app.processing_rules import ProcessingRuleError, prepare
from app.schemas import ProcessingQuantity

TODAY = date(2026, 11, 7)


def production(mode="unit", **changes):
    return ProcessingQuantity(
        **{
            "source_transfer_id": 1,
            "quantity": 10,
            "expected_revision": 0,
            "processor_name": "张师傅",
            "processor_employee_id": 1,
            "processing_date": TODAY,
            "processing_mode": mode,
            "completed_quantity": 6,
            "completed_weight": Decimal("60"),
            **changes,
        }
    )


def normalize(payload, team="FACTORY-ANNEAL"):
    lot = SimpleNamespace(
        processing_role=None,
        material_type="semi_finished",
        transfer_specification="100 × 80 × 5 mm",
    )
    balance = SimpleNamespace(on_hand_quantity=10, on_hand_weight=Decimal("100"))
    return prepare(lot, balance, None, payload, team, today=TODAY)


@pytest.mark.parametrize("completed", [6, 10])
def test_unit_work_preserves_physical_quantity_weight_and_dimensions(completed):
    payload = production(completed_quantity=completed, completed_weight=Decimal(completed * 10))
    prepared, metrics = normalize(payload)
    assert sum(row.quantity for row in prepared.outputs) == 10
    assert sum(row.weight for row in prepared.outputs) == Decimal("100")
    assert all(row.transfer_specification == "100 × 80 × 5 mm" for row in prepared.outputs)
    assert prepared.processing_status == ("complete" if completed == 10 else "partial")
    assert metrics["completed_quantity"] == metrics["input_quantity"] == completed
    assert metrics["input_weight"] == metrics["completed_weight"] == completed * 10
    assert payload.outputs is None  # Normalization must not mutate the caller's request.


def test_split_work_counts_outputs_and_scrap_without_changing_the_input_quantity():
    prepared, metrics = normalize(
        production(
            "split",
            input_quantity=7,
            outputs=[
                dict(role="produced", quantity=60, weight=60, material_type="semi_finished"),
                dict(role="remaining", quantity=3, weight=30, material_type="semi_finished"),
                dict(role="scrap", quantity=0, weight=10, material_type="scrap_chips"),
            ],
        ),
        "FACTORY-WIRE",
    )
    assert prepared.processing_status == "partial"
    assert (metrics["input_quantity"], metrics["completed_quantity"]) == (7, 60)
    assert metrics["input_weight"] == metrics["completed_weight"] + metrics["scrap_weight"] == 70


def test_inline_split_completion_keeps_the_legacy_whole_lot_contract():
    prepared, metrics = normalize(
        production("split", quantity=60, input_quantity=10, processing_status="complete"),
        "FACTORY-WIRE",
    )
    assert prepared.outputs is None
    assert metrics["completed_quantity"] == 60 and metrics["input_quantity"] == 10
    assert metrics["completed_weight"] == metrics["input_weight"] == 100


@pytest.mark.parametrize(("team", "mode"), [("FACTORY-WIRE", "unit"), ("FACTORY-ANNEAL", "split")])
def test_client_cannot_select_a_different_processing_capability(team, mode):
    with pytest.raises(ProcessingRuleError, match="加工方式与本班组不符"):
        normalize(production(mode), team)


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"completed_quantity": 11}, "不能超过未加工件数"),
        ({"completed_weight": Decimal("101")}, "部分加工重量超过"),
        ({"processing_date": date(2026, 11, 8)}, "不能晚于今天"),
    ],
)
def test_invalid_work_is_rejected_before_any_persistence(changes, message):
    with pytest.raises(ProcessingRuleError, match=message):
        normalize(production(**changes))
