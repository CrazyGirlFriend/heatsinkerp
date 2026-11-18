"""Batch searches preserve the balance of the selected row before pagination."""

import pytest
from app.database import SessionLocal
from app.models import MaterialTransfer, ProcessRoutePath, SharedMaterialMember
from sqlalchemy import select
from test_factory_performance import facts as facts  # noqa: F401
from test_factory_performance import processing, report
from test_material_analytics import identify
from test_material_stock import endpoint, receive_lot
from test_material_stock import stock_setup as stock_setup  # noqa: F401
from test_process_route_list_summary import route as process_route
from test_production_schedule_tasks import TASKS, create, route
from test_production_schedules import URL
from test_shared_material import shared_intake
from test_team_business import history, initialize
from test_warehouse_receipts import intake
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

pytestmark = pytest.mark.usefixtures("legacy_stock")


def page(client, url, query, **params):
    response = client.get(url, params={"query": query, **params})
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize("resource", ["serials", "inventory", "global"])
def test_team_batch_search_keeps_serial_totals_and_exact_batch_balances(
    client, stock_setup, resource
):
    first = receive_lot(client, stock_setup, quantity=30, weight=3)
    second = receive_lot(client, stock_setup, key="second", quantity=20, weight=2)
    identify([first, second], "ONE-ORDER")
    receive_lot(client, stock_setup, key="unrelated")
    url = "/api/serial-inventory/stock" if resource == "global" else endpoint(stock_setup, resource)
    found = page(client, url, first["batch_no"], page_size=1)
    assert found["total"] == 1
    assert found["items"][0]["serial_no"] == "ONE-ORDER"
    assert found["items"][0]["available_quantity"] == (50 if resource == "serials" else 30)
    if resource != "serials":
        assert found["items"][0]["batch_no"] == first["batch_no"]
    assert page(client, url, first["batch_no"], page_size=1, page=2)["items"] == []
    assert page(client, url, "MISSING-BATCH")["total"] == 0
    assert page(client, url, "%")["total"] == 0
    other = {**stock_setup, "stock_team_id": stock_setup["third"]["id"]}
    other_url = url if resource == "global" else endpoint(other, resource)
    params = {"team_id": other["stock_team_id"]} if resource == "global" else {}
    assert page(client, other_url, first["batch_no"], **params)["total"] == 0


def test_normal_routes_match_bound_and_shared_batches_without_duplicates(client, warehouse):
    first = intake(client, warehouse).json()
    shared = shared_intake(client, warehouse, idempotency_key="shared-search").json()
    with SessionLocal.begin() as db:
        bound = process_route(db, "BOUND")
        member_route = process_route(db, "MEMBER")
        process_route(db, "UNRELATED")
        db.get(MaterialTransfer, first["id"]).process_route_id = bound.id
        member = db.scalar(
            select(SharedMaterialMember).where(
                SharedMaterialMember.group_id == shared["shared_group_id"]
            )
        )
        member.process_route_id = member_route.id
        expected = [(first["batch_no"], bound.id), (shared["batch_no"], member_route.id)]
    for batch, route_id in expected:
        found = page(client, "/api/process-routes", batch, page_size=1)
        assert found["total"] == 1
        assert found["items"][0]["id"] == route_id
    assert page(client, "/api/process-routes", "%")["total"] == 0


def test_schedule_search_accepts_multiple_batches_and_serial_picker(client, warehouse):
    first = intake(client, warehouse, serial_no="ORDER-FIRST").json()
    second = intake(
        client, warehouse, serial_no="ORDER-SECOND", idempotency_key="second-search"
    ).json()
    tasks = [create(client, route(warehouse, lot)) for lot in (first, second)]
    create(client, route(warehouse))
    query = first["batch_no"] + "，" + second["batch_no"]
    found = page(client, TASKS, query, page_size=1)
    next_page = page(client, TASKS, query, page_size=1, page=2)
    assert found["total"] == next_page["total"] == 2
    assert {found["items"][0]["id"], next_page["items"][0]["id"]} == {task["id"] for task in tasks}
    assert len(found["items"][0]["nodes"]) == 2
    picker = page(client, URL + "/serial-options", first["batch_no"])
    assert picker["items"] == [{"serial_no": first["serial_no"], "task_count": 1}]
    assert page(client, URL, first["batch_no"])["total"] == 1


def test_batch_finds_current_normal_revision_without_matching_unrelated_rework(client, warehouse):
    lot = intake(client, warehouse).json()
    with SessionLocal.begin() as db:
        original = process_route(db, lot["serial_no"])
        current = process_route(db, lot["serial_no"], parent_id=original.id)
        rework = process_route(db, lot["serial_no"], kind="rework")
        db.get(MaterialTransfer, lot["id"]).process_route_id = original.id
        for row in (current, rework):
            db.add(
                ProcessRoutePath(
                    route_id=row.id,
                    serial_no=lot["serial_no"],
                    step_index=0,
                    team_id=warehouse["team"]["id"],
                )
            )
        current_id = current.id
    found = page(client, "/api/process-routes", lot["batch_no"], kind="all")
    assert found["total"] == 1 and found["items"][0]["id"] == current_id


def test_warehouse_catalog_search_matches_batch_before_pagination(client, warehouse):
    first = intake(client, warehouse).json()
    intake(client, warehouse, idempotency_key="other-catalog", serial_no="OTHER")
    found = page(client, "/api/warehouse-locations/inventory", first["batch_no"], page_size=1)
    assert found["total"] == 1
    assert any(
        batch["batch_no"] == first["batch_no"] for batch in found["items"][0]["location"]["batches"]
    )


def test_history_batch_resolves_its_serial_within_the_current_team(client, stock_setup):
    first = initialize(client, stock_setup)
    expected = history(client, stock_setup, first["serial_no"])
    found = history(client, stock_setup, first["batch_no"])
    for key in ("serial_no", "found", "lots", "groups", "flows"):
        assert found[key] == expected[key]
    other = {**stock_setup, "target": stock_setup["third"]}
    assert not history(client, other, first["batch_no"])["found"]


def test_current_serials_deliveries_and_suggestions_accept_batch_numbers(client, warehouse):
    first = intake(
        client,
        warehouse,
        serial_no="ORDER-SEARCH",
        delivery_date="2026-12-01",
        delivery_quantity=100,
    ).json()
    intake(client, warehouse, serial_no="UNRELATED", idempotency_key="other-search")
    path = f"/api/team-materials/{warehouse['team']['id']}/serials"
    found = page(client, path, first["batch_no"], page_size=1)
    assert found["total"] == 1
    assert found["items"][0]["serial_no"] == first["serial_no"]
    options = page(client, "/api/material-input-suggestions", first["batch_no"], field="serial_no")
    assert [item["value"] for item in options["items"]] == [first["serial_no"]]


def test_production_statistics_resolve_entered_batch_number(client, facts):
    processing(facts)
    serial = report(client, serial_no=facts["lot"]["serial_no"])
    batch = report(client, serial_no=facts["lot"]["batch_no"])
    assert batch["production"] == serial["production"]
