"""The live board must not calculate analytics that its contract discards."""

from datetime import datetime

import pytest
from app import factory_overview
from app.database import SessionLocal
from test_external_outbound import dispatch, outbound  # noqa: F401
from test_transfer_list_loading import read_statements


def test_live_skips_unconsumed_analytics(client, outbound, monkeypatch):  # noqa: F811
    def unexpected(*args, **kwargs):
        raise AssertionError("Live board calculated unused analytics")

    for name in ("daily", "stock_matrix", "stock_rankings"):
        monkeypatch.setattr(factory_overview, name, unexpected)
    response = client.get("/api/factory-overview/live")
    assert response.status_code == 200


@pytest.mark.parametrize("state", ["pending", "received", "voided", "loss"])
def test_live_payload_matches_full_report_without_thirteen_unused_reads(
    client,
    outbound,
    monkeypatch,
    state,  # noqa: F811
):
    monkeypatch.setattr(factory_overview, "utcnow", lambda: datetime(2026, 9, 23, 8))
    sent = dispatch(
        client,
        outbound,
        entry_kind="transfer",
        external_destination=None,
        next_team_id=outbound["other"]["id"],
    ).json()
    item = sent["items"][0]
    if state == "received":
        assert (
            client.post(
                f"/api/material-transfers/{item['batch_no']}/confirm",
                headers=outbound["other_headers"],
                json={"idempotency_key": "live-query-receive"},
            ).status_code
            == 200
        )
    elif state == "voided":
        assert (
            client.delete(
                f"/api/material-transfers/{item['batch_no']}",
                headers=outbound["headers"],
            ).status_code
            == 204
        )
    elif state == "loss":
        assert (
            client.post(
                f"/api/team-materials/{outbound['team']['id']}/losses",
                headers=outbound["headers"],
                json={
                    "source_transfer_id": outbound["lots"][0]["id"],
                    "quantity": 1,
                    "weight": ".001",
                    "reason": "核对精度",
                    "idempotency_key": "live-query-loss",
                },
            ).status_code
            == 201
        )
    full_report = factory_overview.factory_overview
    with monkeypatch.context() as patch:
        patch.setattr(
            factory_overview,
            "factory_overview",
            lambda db, **kwargs: full_report(db, recent_limit=100),
        )
        with SessionLocal() as db, read_statements() as reference_queries:
            expected = factory_overview.live_endpoint(db)
    with SessionLocal() as db, read_statements() as queries:
        actual = factory_overview.live_endpoint(db)
    assert actual == expected
    assert len(reference_queries) - len(queries) == 13


def test_full_overview_still_includes_analytics(client, outbound):  # noqa: F811
    report = client.get("/api/factory-overview").json()
    assert len(report["trend"]) == 30
    assert report["stock_matrix"]["total"]["quantity"] == report["totals"]["on_hand_quantity"]
    assert report["material_ranking"]["quantity"]
    assert report["serial_ranking"]["quantity"]
    assert report["stock_age"] and report["waiting_age"]
