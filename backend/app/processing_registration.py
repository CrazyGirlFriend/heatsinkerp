"""Normalize explicit production work into the existing lot and adjustment ledger."""

from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from .config import settings
from .team_constants import PROCESSING_TEAM_CODES

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
    from .processing_rules import ProcessingRuleError
    from .processing_rules import prepare as prepare_production

    try:
        return prepare_production(
            lot,
            balance,
            latest,
            payload,
            team_code,
            today=datetime.now(ZoneInfo(settings.factory_timezone)).date(),
        )
    except ProcessingRuleError as error:
        raise HTTPException(error.status_code, str(error)) from error


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
