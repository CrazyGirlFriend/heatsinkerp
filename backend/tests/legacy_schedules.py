"""Seed retained schedule history; current HTTP creation is tested through dispatch."""

import pytest
from app.database import SessionLocal
from app.models import Team, User
from app.production_schedule_schemas import ScheduleCreate, ScheduleTaskCreate
from app.production_schedule_tasks import create_task
from app.production_schedules import save_plan
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from test_material_transfers import _leader


def administrator(client):
    user_id = client.get("/api/auth/me").json()["id"]
    with SessionLocal() as db:
        user = db.get(User, user_id)
        db.expunge(user)
    return user


def seed_plan(client, payload):
    user = administrator(client)
    with SessionLocal() as db:
        result = save_plan(db, ScheduleCreate.model_validate(payload), user)
    client.drain_notifications()
    return result


def seed_task(client, payload):
    user = administrator(client)
    with SessionLocal() as db:
        result = create_task(db, ScheduleTaskCreate.model_validate(payload), user)
    client.drain_notifications()
    return result


def dispatcher(client):
    if not hasattr(client, "legacy_schedule_dispatcher"):
        with SessionLocal.begin() as db:
            team = db.scalar(select(Team).where(Team.code == "FACTORY-DISPATCH"))
            if team is None:
                team = Team(code="FACTORY-DISPATCH", name="调度", kind="dispatch", active=True)
                db.add(team)
                db.flush()
            team_id = team.id
        _, headers = _leader(client, "schedule-dispatcher", team_id)
        client.legacy_schedule_dispatcher = headers
    return client.legacy_schedule_dispatcher


def dispatch_patch(client, *args, **kwargs):
    if "headers" not in kwargs:
        kwargs["headers"] = dispatcher(client)
    return client.patch(*args, **kwargs)


def dispatch_post(client, *args, **kwargs):
    if "headers" not in kwargs:
        kwargs["headers"] = dispatcher(client)
    return client.post(*args, **kwargs)


def reject_seed(factory, client, payload, status=422):
    """Check validation of retained history without reopening obsolete HTTP writes."""
    with pytest.raises((HTTPException, ValidationError)) as error:
        factory(client, payload)
    if isinstance(error.value, HTTPException):
        assert error.value.status_code == status
    else:
        assert status == 422
