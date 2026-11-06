"""An inventory row and its drill-down must contain one processing state."""

from datetime import datetime

import pytest
from app.configure_material_teams import MATERIAL_TEAMS
from app.database import SessionLocal
from app.models import MaterialQuantityAdjustment, MaterialTransfer, Team
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401


@pytest.fixture
def classified_lots(client, warehouse):
    team = warehouse["other"]
    ids = {}
    with SessionLocal() as db:
        for index, (state, quantity) in enumerate(
            [
                ("complete", 30),
                ("complete", 30),
                ("unregistered", 40),
                ("partial", 20),
                ("registered", 5),
            ]
        ):
            lot = MaterialTransfer(
                batch_no=f"STATE-{index}",
                source_batch_no=f"STATE-{index}",
                serial_no="691236-51",
                next_team_id=team["id"],
                next_team_code=team["code"],
                next_team_name=team["name"],
                entry_kind="opening_stock",
                status="received",
                stock_tracked=True,
                material_type="semi_finished",
                material_name="铜钼",
                transfer_specification="20×10",
                quantity=quantity,
                weight=quantity,
                received_at=datetime(2026, 11, 1),
                created_by="test",
            )
            db.add(lot)
            db.flush()
            ids.setdefault(state, set()).add(lot.id)
            if state != "unregistered":
                db.add(
                    MaterialQuantityAdjustment(
                        source_transfer_id=lot.id,
                        team_id=team["id"],
                        before_quantity=quantity,
                        after_quantity=quantity,
                        processing_status=None if state == "registered" else state,
                        before_specification="旧规格" if state == "registered" else "20×10",
                        after_specification="20×10",
                        weight_snapshot=quantity,
                        stock_revision_before=0,
                        reason="历史加工登记",
                        idempotency_key=f"state-{index}",
                        request_hash="f" * 64,
                        created_by="test",
                    )
                )
        db.commit()
    return team["id"], ids


def get(client, url, **params):
    response = client.get(url, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_processing_states_split_before_pagination_and_match_sources(client, classified_lots):
    team_id, ids = classified_lots
    team_url = f"/api/team-materials/{team_id}"
    expected = {"complete": 60, "unregistered": 40, "partial": 20, "registered": 5}
    for url in ("/api/serial-inventory/stock", team_url + "/inventory"):
        result = get(client, url, availability="owned")
        assert result["total"] == 4
        assert {
            row["processing_state"]: row["owned_quantity"] for row in result["items"]
        } == expected
        assert sum(row["owned_weight"] for row in result["items"]) == 125
        for row in result["items"]:
            state = row["processing_state"]
            sources = get(client, f"{team_url}/inventory/{row['group_id']}/sources")
            assert {item["transfer"]["id"] for item in sources["items"]} == ids[state]
            assert {item["processing_state"] for item in sources["items"]} == {state}
            movements = get(client, f"{team_url}/inventory/{row['group_id']}/movements")
            assert {item["id"] for item in movements["items"]} == ids[state]
            filtered = get(client, url, processing_state=state, page_size=1)
            assert filtered["total"] == 1
            assert filtered["items"][0]["owned_quantity"] == expected[state]
        pages = [get(client, url, page=page, page_size=1) for page in range(1, 5)]
        assert {p["items"][0]["processing_state"] for p in pages} == set(expected)


def test_batch_search_does_not_include_a_different_processing_state(client, classified_lots):
    team_id, _ = classified_lots
    for url in ("/api/serial-inventory/stock", f"/api/team-materials/{team_id}/inventory"):
        result = get(client, url, search_field="source_batch_no", query="STATE-2")
        assert result["total"] == 1
        assert result["items"][0]["processing_state"] == "unregistered"
        assert result["items"][0]["owned_quantity"] == 40


def test_pending_outbound_and_processing_picker_keep_the_selected_group(
    client, classified_lots, warehouse
):
    team_id, ids = classified_lots
    with SessionLocal() as db:
        outgoing = {}
        for state in ("complete", "unregistered"):
            source = db.get(MaterialTransfer, min(ids[state]))
            sent = MaterialTransfer(
                batch_no=f"SEND-{state}",
                serial_no=source.serial_no,
                entry_kind="transfer",
                source_transfer_id=source.id,
                source_team_id=team_id,
                source_team_code=source.next_team_code,
                source_team_name=source.next_team_name,
                next_team_id=warehouse["team"]["id"],
                next_team_code=warehouse["team"]["code"],
                next_team_name=warehouse["team"]["name"],
                quantity=1,
                weight=1,
                status="pending",
                created_by="test",
            )
            db.add(sent)
            db.flush()
            outgoing[state] = sent.id
        db.commit()
    team_url = f"/api/team-materials/{team_id}"
    for state in ("complete", "unregistered"):
        group_id = min(ids[state])
        pending = get(client, f"{team_url}/inventory/{group_id}/pending-outbound")
        assert {item["id"] for item in pending["items"]} == {outgoing[state]}
        selectable = get(client, team_url + "/processing-stock", group_id=group_id)
        assert {item["transfer"]["id"] for item in selectable["items"]} == (
            ids[state] if state == "unregistered" else set()
        )


def test_all_eight_team_lists_reconcile_with_factory_stock_and_team_totals(client):
    teams = {}
    with SessionLocal() as db:
        for code, name, kind, _ in MATERIAL_TEAMS:
            team = Team(code=code, name=name, kind=kind, active=True)
            db.add(team)
            db.flush()
            expected = (
                {"not_required": 120}
                if kind == "warehouse"
                else {"complete": 60, "unregistered": 40, "partial": 20}
            )
            teams[team.id] = (name, expected)
            for state, quantity in expected.items():
                key = f"{code}-{state}"
                lot = MaterialTransfer(
                    batch_no=key,
                    serial_no="691236-51",
                    next_team_id=team.id,
                    next_team_code=code,
                    next_team_name=name,
                    entry_kind="opening_stock",
                    status="received",
                    stock_tracked=True,
                    material_type="semi_finished",
                    material_name="铜钼",
                    transfer_specification="20×10",
                    quantity=quantity,
                    weight=quantity,
                    received_at=datetime(2026, 11, 1),
                    created_by="test",
                )
                db.add(lot)
                db.flush()
                if state in ("complete", "partial"):
                    db.add(
                        MaterialQuantityAdjustment(
                            source_transfer_id=lot.id,
                            team_id=team.id,
                            before_quantity=quantity,
                            after_quantity=quantity,
                            processing_status=state,
                            weight_snapshot=quantity,
                            stock_revision_before=0,
                            reason="加工登记",
                            idempotency_key=key,
                            request_hash="f" * 64,
                            created_by="test",
                        )
                    )
        db.commit()

    factory = get(client, "/api/serial-inventory/stock", page_size=100)
    assert factory["total"] == 22
    assert sum(row["owned_quantity"] for row in factory["items"]) == 960
    assert sum(row["owned_weight"] for row in factory["items"]) == 960
    for team_id, (name, expected) in teams.items():
        url = f"/api/team-materials/{team_id}"
        local = get(client, url + "/inventory", availability="owned")
        filtered = get(client, "/api/serial-inventory/stock", team_id=team_id)
        factory_rows = [row for row in factory["items"] if row["team_id"] == team_id]
        assert local["total"] == filtered["total"] == len(expected), name
        for rows in (local["items"], filtered["items"], factory_rows):
            assert {row["processing_state"]: row["owned_quantity"] for row in rows} == expected, (
                name
            )
        totals = get(client, url + "/overview")["totals"]
        for field in ("owned_quantity", "owned_weight", "on_hand_quantity", "on_hand_weight"):
            assert totals[field] == sum(row[field] for row in local["items"]) == 120, (name, field)
        for row in local["items"]:
            details = get(client, f"{url}/inventory/{row['group_id']}/sources")
            assert details["total"] == 1, name
            assert details["items"][0]["owned_quantity"] == row["owned_quantity"], name
            if row["processing_state"] != "not_required":
                assert details["items"][0]["processing_state"] == row["processing_state"], name
