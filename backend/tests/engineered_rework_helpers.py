"""Explicit engineering preparation shared by rework ledger regression scenarios."""

from app.database import SessionLocal
from app.models import MaterialQuantityAdjustment
from test_engineered_rework import request_plan, save_plan
from test_warehouse_classification import base


def approve_rework(client, setup, lot, original=None, *, team=None):
    context = client.get(base(setup, True) + f"/stock/{lot['id']}/quantity-adjustments").json()
    if context.get("rework_route_ready"):
        return lot
    if original is None:
        with SessionLocal() as db:
            record = db.get(MaterialQuantityAdjustment, context["rework_of_id"])
            original = {"id": record.id}
    plan = request_plan(client, setup, lot, original)
    save_plan(client, setup, plan, team=team)
    return {"id": plan["rework_request"]["source_transfer_id"]}


def resume_rework(client, setup, lot):
    context = client.get(base(setup, True) + f"/stock/{lot['id']}/quantity-adjustments").json()
    result = client.post(
        f"/api/process-routes/rework-lots/{lot['id']}/resume",
        headers=setup["other_headers"],
        json={"expected_revision": context["revision"]},
    )
    assert result.status_code == 200, result.text
