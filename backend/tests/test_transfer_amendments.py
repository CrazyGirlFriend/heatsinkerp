"""Signed handoffs change only after the other team approves current safe stock."""

from decimal import Decimal

import pytest
from app.database import SessionLocal
from app.models import (
    MaterialQuantityAdjustment,
    MaterialStockBalance,
    MaterialTransfer,
    MaterialTransferAmendment,
    MaterialTransferEvent,
    TransferAmendmentNotice,
)
from receipt_helpers import receipt_post
from sqlalchemy import func, select
from test_material_stock import dispatch, receive_lot
from test_material_transfers import _setup_three_teams

pytestmark = pytest.mark.usefixtures("legacy_stock")


@pytest.fixture()
def handoff(client):
    setup = _setup_three_teams(client)
    setup["stock_team_id"] = setup["target"]["id"]
    setup["stock_headers"] = setup["target_headers"]
    source = receive_lot(client, setup)
    response = dispatch(
        client, setup, [{"source_transfer_id": source["id"], "quantity": 60, "weight": "6"}]
    )
    assert response.status_code == 201, response.text
    pending = response.json()["items"][0]
    response = receipt_post(
        client,
        f"/api/material-transfers/{pending['batch_no']}/confirm",
        headers=setup["third_headers"],
        json={"idempotency_key": "receive-third"},
    )
    assert response.status_code == 200, response.text
    return setup, source, response.json()


def request(client, setup, lot, *, requester="target", **values):
    return client.post(
        f"/api/material-transfers/{lot['batch_no']}/amendments",
        headers=setup[f"{requester}_headers"],
        json={
            "expected_version": lot["version"],
            "quantity": 50,
            "weight": "5",
            "notes": "复核数量",
            "reason": "双方盘点复核",
            **values,
        },
    )


def decide(client, setup, row, action="approve", *, actor="third", **payload):
    return client.post(
        f"/api/transfer-amendments/{row['id']}/{action}",
        headers=setup[f"{actor}_headers"],
        json=payload,
    )


def balances(*lots):
    with SessionLocal() as db:
        return [
            (
                db.get(MaterialStockBalance, lot["id"]).on_hand_quantity,
                db.get(MaterialStockBalance, lot["id"]).on_hand_weight,
            )
            for lot in lots
        ]


def test_request_is_not_effective_until_counterparty_approves_once(client, handoff):
    setup, source, lot = handoff
    response = request(client, setup, lot)
    assert response.status_code == 201, response.text
    row = response.json()
    assert row["allowed_actions"] == ["cancel"]
    assert row["before"]["quantity"] == 60 and row["after"]["quantity"] == 50
    assert balances(source, lot) == [(40, Decimal(4)), (60, Decimal(6))]
    assert client.get(f"/api/material-transfers/{lot['batch_no']}").json()["quantity"] == 60
    assert request(client, setup, lot).json()["id"] == row["id"]
    assert request(client, setup, lot, requester="third").status_code == 409
    assert decide(client, setup, row, actor="target").status_code == 403
    assert decide(client, setup, row, actor="source").status_code == 404
    assert client.post(f"/api/transfer-amendments/{row['id']}/approve", json={}).status_code == 403
    detail = client.get(
        f"/api/transfer-amendments/{row['id']}", headers=setup["third_headers"]
    ).json()
    assert detail["allowed_actions"] == ["approve", "reject"]
    approved = decide(client, setup, row)
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"
    assert balances(source, lot) == [(50, Decimal(5)), (50, Decimal(5))]
    assert decide(client, setup, row).status_code == 200
    assert balances(source, lot) == [(50, Decimal(5)), (50, Decimal(5))]
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(MaterialTransferAmendment)) == 1
        assert db.scalar(select(func.count()).select_from(TransferAmendmentNotice)) == 4
        assert (
            db.scalar(
                select(func.count())
                .select_from(MaterialTransferEvent)
                .where(
                    MaterialTransferEvent.transfer_id == lot["id"],
                    MaterialTransferEvent.action == "amendment_approved",
                )
            )
            == 1
        )
        actual = db.get(MaterialTransfer, lot["id"])
        assert actual.version == lot["version"] + 1
        assert actual.received_by == lot["received_by"]


def test_receiver_can_request_upstream_approval_and_increase_uses_source_balance(client, handoff):
    setup, source, lot = handoff
    row = request(client, setup, lot, requester="third", quantity=90, weight="9").json()
    assert row["counterparty_team_id"] == setup["target"]["id"]
    response = decide(client, setup, row, actor="target")
    assert response.status_code == 200, response.text
    assert balances(source, lot) == [(10, Decimal(1)), (90, Decimal(9))]
    current = client.get(f"/api/material-transfers/{lot['batch_no']}").json()
    assert request(client, setup, current, quantity=101, weight="10.1").status_code == 409


def test_approval_rechecks_receiver_consumption_and_preserves_child_records(client, handoff):
    setup, source, lot = handoff
    row = request(client, setup, lot, quantity=20, weight="2").json()
    downstream = {
        **setup,
        "stock_team_id": setup["third"]["id"],
        "stock_headers": setup["third_headers"],
    }
    outgoing = dispatch(
        client,
        downstream,
        [{"source_transfer_id": lot["id"], "quantity": 30, "weight": "3"}],
        next_team_id=setup["source"]["id"],
        idempotency_key="further-dispatch",
    )
    assert outgoing.status_code == 201, outgoing.text
    child = outgoing.json()["items"][0]
    failed = decide(client, setup, row)
    assert failed.status_code == 409
    assert "剩余" in failed.json()["detail"]
    assert balances(source, lot) == [(40, Decimal(4)), (30, Decimal(3))]
    assert client.get(f"/api/material-transfers/{child['batch_no']}").json()["quantity"] == 30
    context = client.get(
        f"/api/material-transfers/{lot['batch_no']}/amendments", headers=setup["target_headers"]
    ).json()
    assert context["remaining_quantity"] == 30 and context["editable"] is False
    assert context["items"][0]["status"] == "pending"
    assert decide(client, setup, row, "cancel", actor="target").status_code == 200
    safe = request(client, setup, lot, quantity=30, weight="3").json()
    assert decide(client, setup, safe).status_code == 200
    assert balances(source, lot) == [(70, Decimal(7)), (0, Decimal(0))]
    # Existing pending downstream reservation is still exactly the same document.
    actual = client.get(f"/api/material-transfers/{child['batch_no']}").json()
    assert (actual["quantity"], actual["weight"], actual["status"], actual["version"]) == (
        30,
        3,
        "pending",
        child["version"],
    )


def test_approval_rechecks_source_stock_and_reject_cancel_do_not_apply(client, handoff):
    setup, source, lot = handoff
    row = request(client, setup, lot, quantity=90, weight="9").json()
    extra = dispatch(
        client,
        setup,
        [{"source_transfer_id": source["id"], "quantity": 30, "weight": "3"}],
        idempotency_key="source-used",
    )
    assert extra.status_code == 201, extra.text
    failed = decide(client, setup, row)
    assert failed.status_code == 409 and "上序" in failed.json()["detail"]
    rejected = decide(client, setup, row, "reject", reason="余量不足")
    assert rejected.status_code == 200 and rejected.json()["response_reason"] == "余量不足"
    assert decide(client, setup, row).status_code == 409
    assert balances(source, lot) == [(10, Decimal(1)), (60, Decimal(6))]
    cancelled = request(client, setup, lot).json()
    assert decide(client, setup, cancelled, "cancel").status_code == 403
    assert decide(client, setup, cancelled, "cancel", actor="target").status_code == 200
    assert decide(client, setup, cancelled, "cancel", actor="target").status_code == 200
    assert balances(source, lot) == [(10, Decimal(1)), (60, Decimal(6))]


def test_completed_inline_work_protected_but_notes_can_be_corrected(client, handoff):
    setup, source, lot = handoff
    with SessionLocal() as db:
        db.add(
            MaterialQuantityAdjustment(
                source_transfer_id=lot["id"],
                team_id=setup["third"]["id"],
                before_quantity=60,
                after_quantity=60,
                weight_snapshot=6,
                processing_status="complete",
                completed_quantity=60,
                completed_weight=6,
                stock_revision_before=1,
                outputs=None,
                reason="历史加工",
                idempotency_key="historical-work",
                request_hash="a" * 64,
                created_by="工人",
            )
        )
        db.commit()
    assert request(client, setup, lot).status_code == 409
    row = request(client, setup, lot, quantity=60, weight="6", notes="补充交接说明").json()
    assert decide(client, setup, row).status_code == 200
    assert balances(source, lot) == [(40, Decimal(4)), (60, Decimal(6))]
    with SessionLocal() as db:
        record = db.scalar(select(MaterialQuantityAdjustment))
        assert (record.before_quantity, record.after_quantity, record.completed_quantity) == (
            60,
            60,
            60,
        )


def test_scope_versions_and_field_whitelist(client, handoff):
    setup, source, lot = handoff
    assert request(client, setup, lot, requester="source").status_code == 404
    assert request(client, setup, lot, serial_no="CHANGED").status_code == 422
    assert request(client, setup, lot, reason="   ").status_code == 422
    assert request(client, setup, lot, expected_version=lot["version"] - 1).status_code == 409
    row = request(client, setup, lot).json()
    with SessionLocal() as db:
        db.get(MaterialTransfer, lot["id"]).version += 1
        db.commit()
    assert decide(client, setup, row).status_code == 409
    assert balances(source, lot) == [(40, Decimal(4)), (60, Decimal(6))]
    assert (
        client.get(
            f"/api/transfer-amendments/{row['id']}", headers=setup["source_headers"]
        ).status_code
        == 404
    )
    assert (
        client.get(
            f"/api/material-transfers/{lot['batch_no']}/amendments", headers=setup["source_headers"]
        ).status_code
        == 404
    )


def partial_work(client, setup, lot, *, done, weight, key):
    team_id = setup["third"]["id"]
    assert client.patch(f"/api/teams/{team_id}", json={"code": "FACTORY-GRIND"}).status_code == 200
    employees = client.get(f"/api/team-materials/{team_id}/employees").json()
    employee = employees[0]
    context = client.get(
        f"/api/team-materials/{team_id}/stock/{lot['id']}/quantity-adjustments"
    ).json()
    response = client.post(
        f"/api/team-materials/{team_id}/quantity-adjustments",
        headers=setup["third_headers"],
        json={
            "source_transfer_id": lot["id"],
            "quantity": context["quantity"],
            "expected_revision": context["revision"],
            "processor_name": employee["name"],
            "processor_employee_id": employee["id"],
            "processing_date": "2026-10-15",
            "processing_mode": "unit",
            "completed_quantity": done,
            "completed_weight": weight,
            "idempotency_key": key,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_modern_partial_processing_remainder_chain_and_zero_remainder(client, handoff):
    setup, source, lot = handoff
    first = partial_work(client, setup, lot, done=20, weight=2, key="partial-1")
    produced, remaining = first["outputs"]
    second = partial_work(client, setup, remaining, done=10, weight=1, key="partial-2")
    produced2, remaining2 = second["outputs"]
    row = request(client, setup, lot, quantity=45, weight="4.5").json()
    assert decide(client, setup, row).status_code == 200
    assert balances(source, lot, produced, remaining, produced2, remaining2) == [
        (55, Decimal("5.5")),
        (0, Decimal(0)),
        (20, Decimal(2)),
        (0, Decimal(0)),
        (10, Decimal(1)),
        (15, Decimal("1.5")),
    ]
    with SessionLocal() as db:
        records = db.scalars(
            select(MaterialQuantityAdjustment).order_by(MaterialQuantityAdjustment.id)
        ).all()
        assert [record.outputs for record in records] == [first["outputs"], second["outputs"]]
        assert db.get(MaterialTransfer, remaining["id"]).quantity == 25
        assert db.get(MaterialTransfer, remaining2["id"]).quantity == 15
    latest = client.get(f"/api/material-transfers/{lot['batch_no']}").json()
    row = request(client, setup, latest, quantity=30, weight="3").json()
    response = decide(client, setup, row)
    assert response.status_code == 200, response.text
    assert balances(source, lot, produced, remaining, produced2, remaining2) == [
        (70, Decimal(7)),
        (0, Decimal(0)),
        (20, Decimal(2)),
        (0, Decimal(0)),
        (10, Decimal(1)),
        (0, Decimal(0)),
    ]
    with SessionLocal() as db:
        cleared = db.get(MaterialTransfer, remaining2["id"])
        assert (cleared.quantity, cleared.weight, cleared.status) == (0, Decimal(0), "received")
        assert db.get(MaterialTransfer, produced["id"]).quantity == 20
        assert db.get(MaterialTransfer, produced2["id"]).quantity == 10


def test_approval_rechecks_processing_after_request(client, handoff):
    setup, source, lot = handoff
    row = request(client, setup, lot, quantity=20, weight="2").json()
    work = partial_work(client, setup, lot, done=40, weight=4, key="work-after-request")
    response = decide(client, setup, row)
    assert response.status_code == 409
    assert balances(source, lot, *work["outputs"]) == [
        (40, Decimal(4)),
        (0, Decimal(0)),
        (40, Decimal(4)),
        (20, Decimal(2)),
    ]


def test_concurrent_proposals_and_double_confirmation_do_not_double_apply(client, handoff):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from app.models import User
    from app.transfer_amendments import AmendmentCreate, request_amendment, resolve_amendment
    from fastapi import HTTPException

    setup, source, lot = handoff
    with SessionLocal() as db:
        requester = db.get(User, setup["target_user"]["id"])
        counterparty = db.get(User, setup["third_user"]["id"])
        assert requester.team and counterparty.team
        db.expunge_all()
    barrier = Barrier(2)
    payload = AmendmentCreate(
        expected_version=lot["version"], quantity=50, weight=5, notes="校正", reason="复核"
    )

    def propose(user):
        barrier.wait(timeout=10)
        with SessionLocal() as db:
            try:
                return request_amendment(db, lot["batch_no"], payload, user)
            except HTTPException as exc:
                return exc.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(propose, [requester, counterparty]))
    row = next(value for value in results if isinstance(value, dict))
    assert sum(isinstance(value, dict) for value in results) == 1
    assert 409 in results
    actor = counterparty if row["requester_team_id"] == requester.team_id else requester
    barrier = Barrier(2)

    def approve(_):
        barrier.wait(timeout=10)
        with SessionLocal() as db:
            return resolve_amendment(db, row["id"], "approved", actor)

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert all(value["status"] == "approved" for value in pool.map(approve, range(2)))
    assert balances(source, lot) == [(50, Decimal(5)), (50, Decimal(5))]
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(MaterialTransferAmendment)) == 1
        assert db.scalar(select(func.count()).select_from(TransferAmendmentNotice)) == 4


def test_unknown_legacy_partial_work_cannot_be_reduced(client, handoff):
    setup, source, lot = handoff
    with SessionLocal() as db:
        db.add(
            MaterialQuantityAdjustment(
                source_transfer_id=lot["id"],
                team_id=setup["third"]["id"],
                before_quantity=60,
                after_quantity=60,
                weight_snapshot=6,
                processing_status="partial",
                stock_revision_before=1,
                outputs=None,
                reason="旧加工只记进度",
                idempotency_key="old-partial",
                request_hash="b" * 64,
                created_by="工人",
            )
        )
        db.commit()
    response = request(client, setup, lot)
    assert response.status_code == 409
    assert balances(source, lot) == [(40, Decimal(4)), (60, Decimal(6))]


def test_remainder_increase_and_later_outgoing_reservations_are_revalidated(client, handoff):
    setup, source, lot = handoff
    work = partial_work(client, setup, lot, done=20, weight=2, key="partial-before-increase")
    produced, remaining = work["outputs"]
    row = request(client, setup, lot, quantity=80, weight="8").json()
    assert decide(client, setup, row).status_code == 200
    assert balances(source, lot, produced, remaining) == [
        (20, Decimal(2)),
        (0, Decimal(0)),
        (20, Decimal(2)),
        (60, Decimal(6)),
    ]
    latest = client.get(f"/api/material-transfers/{lot['batch_no']}").json()
    row = request(client, setup, latest, quantity=30, weight="3").json()
    downstream = {
        **setup,
        "stock_team_id": setup["third"]["id"],
        "stock_headers": setup["third_headers"],
    }
    response = dispatch(
        client,
        downstream,
        [{"source_transfer_id": remaining["id"], "quantity": 30, "weight": "3"}],
        next_team_id=setup["source"]["id"],
        idempotency_key="remainder-outbound",
    )
    assert response.status_code == 201, response.text
    outgoing = response.json()["items"][0]
    assert decide(client, setup, row).status_code == 409
    assert balances(source, lot, produced, remaining) == [
        (20, Decimal(2)),
        (0, Decimal(0)),
        (20, Decimal(2)),
        (30, Decimal(3)),
    ]
    assert client.get(f"/api/material-transfers/{outgoing['batch_no']}").json()["quantity"] == 30
