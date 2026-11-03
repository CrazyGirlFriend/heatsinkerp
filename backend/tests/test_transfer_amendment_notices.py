"""Received-handoff requests share the inbox without treating reads as approval."""

from datetime import timedelta

import pytest
from app.database import SessionLocal
from app.models import (
    MaterialTransfer,
    MaterialTransferAmendment,
    NotificationOutbox,
    TransferAmendmentNotice,
    TransferAmendmentNoticeRead,
    User,
    utcnow,
)
from receipt_helpers import receipt_post
from sqlalchemy import func, select
from test_business_notices import INBOX, inbox
from test_material_transfers import _create, _leader, _setup_three_teams


@pytest.fixture()
def received(client):
    teams = _setup_three_teams(client)
    transfer = _create(client, teams).json()
    response = receipt_post(
        client,
        f"/api/material-transfers/{transfer['batch_no']}/confirm",
        headers=teams["target_headers"],
        json={"idempotency_key": "notice-receipt"},
    )
    assert response.status_code == 200, response.text
    return teams, response.json()


def proposal(teams, transfer, *, status="pending", notices=True):
    with SessionLocal.begin() as db:
        amendment = MaterialTransferAmendment(
            transfer_id=transfer["id"],
            pending_transfer_id=transfer["id"] if status == "pending" else None,
            base_version=transfer["version"],
            requester_team_id=teams["source"]["id"],
            counterparty_team_id=teams["target"]["id"],
            requested_by=teams["source_user"]["display_name"],
            requested_by_user_id=teams["source_user"]["id"],
            before={"quantity": transfer["quantity"], "weight": transfer["weight"]},
            after={"quantity": 10, "weight": 3},
            reason="复核剩余物料数量",
            status=status,
        )
        db.add(amendment)
        db.flush()
        amendment_id = amendment.id
        if notices:
            add_notices(db, amendment, teams)
    return amendment_id


def add_notices(db, amendment, teams, kind="amendment_requested"):
    for side in ("source", "target"):
        db.add(
            TransferAmendmentNotice(
                event_key=f"amendment:{amendment.id}:{kind}:{side}",
                amendment_id=amendment.id,
                team_id=teams[side]["id"],
                kind=kind,
                message="剩余物料数量调整，等待对方确认",
            )
        )


def test_transfer_notice_scope_read_and_target(client, received):
    teams, transfer = received
    amendment_id = proposal(teams, transfer)
    receiver = inbox(client, teams["target_headers"], category="pending")
    assert receiver["total"] == receiver["unread"] == 1
    notice = receiver["items"][0]
    assert notice["source"] == "transfer"
    assert notice["amendment_id"] == amendment_id
    assert notice["amendment_status"] == "pending" and notice["action_required"]
    assert notice["serial_no"] == transfer["serial_no"]
    assert notice["batch_no"] == transfer["batch_no"]
    path = f"{INBOX}/transfer/{notice['id']}"
    target = client.get(path + "/target", headers=teams["target_headers"])
    assert target.status_code == 200, target.text
    assert target.json() == {
        "href": f"/transfer-batches?batch_no={transfer['batch_no']}&amendment_id={amendment_id}",
        "section": "amendment",
        "amendment_id": amendment_id,
    }
    for side in ("source", "third"):
        assert client.get(path + "/target", headers=teams[f"{side}_headers"]).status_code == 404
        assert client.post(path + "/read", headers=teams[f"{side}_headers"]).status_code == 404
    assert inbox(client, teams["third_headers"])["total"] == 0
    assert inbox(client, teams["source_headers"], category="pending")["total"] == 0
    assert inbox(client, teams["source_headers"], category="transfer")["total"] == 1
    admin = inbox(client, category="transfer")
    assert admin["total"] == admin["unread"] == 2
    assert not any(n["action_required"] for n in admin["items"])
    assert inbox(client, category="pending")["total"] == 0
    assert client.get(path + "/target").status_code == 200

    for _ in range(2):
        assert client.post(path + "/read", headers=teams["target_headers"]).status_code == 204
    assert inbox(client, teams["target_headers"])["unread"] == 0
    assert inbox(client, teams["target_headers"], category="pending")["total"] == 1
    assert (
        inbox(client, teams["target_headers"], category="pending", unread_only=True)["total"] == 0
    )
    _, colleague = _leader(client, "receiving-colleague", teams["target"]["id"])
    assert inbox(client, colleague)["unread"] == 1
    assert inbox(client)["unread"] == 2
    with SessionLocal() as db:
        assert db.get(MaterialTransferAmendment, amendment_id).status == "pending"
        actual = db.get(MaterialTransfer, transfer["id"])
        assert actual.quantity == transfer["quantity"] and actual.version == transfer["version"]
        assert db.scalar(select(func.count()).select_from(TransferAmendmentNoticeRead)) == 1


@pytest.mark.parametrize("status", ["approved", "rejected", "cancelled"])
def test_resolved_requests_leave_pending_even_if_unread(client, received, status):
    teams, transfer = received
    amendment_id = proposal(teams, transfer)
    assert inbox(client, teams["target_headers"], category="pending")["total"] == 1
    with SessionLocal.begin() as db:
        amendment = db.get(MaterialTransferAmendment, amendment_id)
        amendment.status = status
        amendment.pending_transfer_id = None
        amendment.resolved_at = utcnow()
        add_notices(db, amendment, teams, f"amendment_{status}")
    assert inbox(client, teams["target_headers"], category="pending")["total"] == 0
    messages = inbox(client, teams["target_headers"], category="transfer")
    assert messages["total"] == messages["unread"] == 2
    assert all(n["amendment_status"] == status for n in messages["items"])
    assert not any(n["action_required"] for n in messages["items"])


def test_requester_moved_to_counterparty_team_has_no_self_approval_todo(client, received):
    teams, transfer = received
    proposal(teams, transfer)
    with SessionLocal.begin() as db:
        user = db.get(User, teams["source_user"]["id"])
        user.team_id = teams["target"]["id"]
    own = inbox(client, teams["source_headers"], category="transfer")
    assert own["total"] == 1 and not own["items"][0]["action_required"]
    assert inbox(client, teams["source_headers"], category="pending")["total"] == 0
    assert inbox(client, teams["target_headers"], category="pending")["total"] == 1


def test_transfer_notice_pagination_and_read_all_watermark(client, received):
    teams, transfer = received
    amendment_id = proposal(teams, transfer)
    with SessionLocal.begin() as db:
        for number in range(22):
            db.add(
                TransferAmendmentNotice(
                    event_key=f"history:{number}",
                    amendment_id=amendment_id,
                    team_id=teams["target"]["id"],
                    kind="amendment_cancelled",
                    message="历史修改已撤回",
                    created_at=utcnow() + timedelta(seconds=number),
                )
            )
    first = inbox(client, teams["target_headers"], category="transfer")
    second = inbox(client, teams["target_headers"], category="transfer", page=2)
    assert first["total"] == 23 and len(first["items"]) == 20 and len(second["items"]) == 3
    assert len({n["id"] for n in first["items"] + second["items"]}) == 23
    # Historical notices never become actionable just because their proposal is pending.
    assert inbox(client, teams["target_headers"], category="pending")["total"] == 1
    with SessionLocal.begin() as db:
        db.add(
            TransferAmendmentNotice(
                event_key="arrived-after-open",
                amendment_id=amendment_id,
                team_id=teams["target"]["id"],
                kind="amendment_requested",
                message="新消息",
            )
        )
    assert (
        client.post(
            INBOX + "/read-all", headers=teams["target_headers"], json=first["latest"]
        ).status_code
        == 204
    )
    remaining = inbox(client, teams["target_headers"], unread_only=True)
    assert remaining["total"] == 1 and remaining["items"][0]["message"] == "新消息"
    assert inbox(client, teams["source_headers"])["unread"] == 1
    with SessionLocal() as db:
        assert db.get(MaterialTransferAmendment, amendment_id).status == "pending"


def test_transfer_notice_wakes_both_teams_only_after_commit(client, received):
    teams, transfer = received
    amendment_id = proposal(teams, transfer, notices=False)
    with SessionLocal() as db:
        before = db.scalar(select(func.count()).select_from(NotificationOutbox))
    with SessionLocal() as db:
        amendment = db.get(MaterialTransferAmendment, amendment_id)
        add_notices(db, amendment, teams)
        db.flush()
        db.rollback()
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(NotificationOutbox)) == before
        assert db.scalar(select(func.count()).select_from(TransferAmendmentNotice)) == 0
    with SessionLocal.begin() as db:
        add_notices(db, db.get(MaterialTransferAmendment, amendment_id), teams)
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(NotificationOutbox)) == before + 1
        event = db.scalar(
            select(NotificationOutbox).where(NotificationOutbox.published_at.is_(None))
        )
        assert event.payload["team_ids"] == sorted([teams["source"]["id"], teams["target"]["id"]])
