"""Physical sludge mass is not counted as material mass a second time."""
from decimal import Decimal
import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, select, text

from app.database import SessionLocal
from app.models import MaterialQuantityAdjustment, MaterialTransfer, Team
from test_warehouse_receipts import warehouse, intake  # noqa: F401
from test_quantity_adjustments import dispatch, confirm, base


def line(lot, *, gross=10, percent=30, weight=3, quantity=0):
    return {"source_transfer_id": lot["id"], "material_type": "sludge", "quantity": quantity,
            "weight": weight, "sludge_gross_weight": gross, "sludge_content_percent": percent}


def stock(client, s, workshop=False):
    return client.get(base(s, workshop) + "/overview").json()["totals"]


def test_sludge_return_and_external_exit_count_material_mass_once(client, warehouse):
    s = warehouse
    with SessionLocal.begin() as db:
        team = db.get(Team, s['other']['id'])
        team.code, team.name = 'FACTORY-GRIND', '研磨'
    origin = intake(client, s, quantity=0, weight=10).json()
    sent = dispatch(client, s, [{"source_transfer_id": origin["id"], "quantity": 0, "weight": 10}]).json()
    assert confirm(client, s, sent, workshop=True).status_code == 200
    source = sent["items"][0]
    returned = dispatch(client, s, [line(source)], workshop=True, notes="废泥按材料占比回库")
    assert returned.status_code == 201, returned.text
    assert dispatch(client, s, [line(source)], workshop=True, notes="废泥按材料占比回库").json() == returned.json()
    batch = returned.json()["items"][0]
    assert (batch["weight"], batch["sludge_gross_weight"], batch["sludge_content_percent"]) == (3, 10, 30)
    assert stock(client, s, True)["on_hand_weight"] == 7
    assert stock(client, s, True)["owned_weight"] == 10
    assert stock(client, s)["owned_weight"] == 0
    assert client.get("/api/factory-overview").json()["totals"]["owned_weight"] == 10
    # The receiving leader cannot change either the measurement or its percentage.
    url = "/api/material-transfers/" + batch["batch_no"]
    assert client.patch(url, headers=s["headers"], json={"sludge_content_percent": 20, "weight": 2}).status_code == 403
    assert confirm(client, s, returned.json()).status_code == 200
    assert stock(client, s)["scrap_available_weight"] == 3
    assert stock(client, s, True)["owned_weight"] == 7
    assert client.get("/api/factory-overview").json()["totals"]["owned_weight"] == 10
    external = dict(entry_kind="warehouse_outbound", next_team_id=None, external_destination="回收单位", notes="废泥处理", idempotency_key="sludge-exit")
    assert dispatch(client, s, [line(batch, percent=20, weight=2)], **external).status_code == 422
    outgoing = dispatch(client, s, [line(batch)], **external)
    assert outgoing.status_code == 201, outgoing.text
    row = outgoing.json()["items"][0]
    assert (row["weight"], row["sludge_gross_weight"], row["sludge_content_percent"], row["status"]) == (3, 10, 30, "dispatched")
    assert row["sludge_percent_locked"] is True
    assert stock(client, s)["owned_weight"] == 0
    assert client.get("/api/factory-overview").json()["totals"]["owned_weight"] == 7


def test_final_material_weight_can_clear_pieces_with_a_reason(client, warehouse):
    s = warehouse
    origin = intake(client, s, quantity=100, weight=3).json()
    sent = dispatch(client, s, [{"source_transfer_id": origin["id"], "quantity": 100, "weight": 3}]).json()
    assert confirm(client, s, sent, workshop=True).status_code == 200
    source = sent["items"][0]
    data = line(source)
    response = dispatch(client, s, [data], workshop=True, notes="废泥回库", idempotency_key="without-clearance")
    assert response.status_code == 201
    assert stock(client, s, True)["on_hand_quantity"] == 100
    assert client.delete(f"/api/material-transfers/{response.json()['items'][0]['batch_no']}", headers=s["other_headers"]).status_code == 204
    response = dispatch(client, s, [data], workshop=True, notes="废泥回库",
        quantity_clearances=[{"source_transfer_id": source["id"], "quantity": 100, "reason": "全部加工为废泥，按重量交接"}])
    assert response.status_code == 201, response.text
    assert stock(client, s, True)["on_hand_quantity"] == 0
    assert stock(client, s, True)["on_hand_weight"] == 0
    assert stock(client, s, True)["owned_weight"] == 3
    with SessionLocal() as db:
        adjustment = db.scalar(select(MaterialQuantityAdjustment))
        assert adjustment.after_quantity == 0 and adjustment.weight_snapshot == 0


def test_percentage_edits_adjust_only_material_weight_and_void_restores_it(client, warehouse):
    s = warehouse
    origin = intake(client, s, quantity=0, weight=10).json()
    sent = dispatch(client, s, [{"source_transfer_id": origin["id"], "quantity": 0, "weight": 10}]).json()
    assert confirm(client, s, sent, workshop=True).status_code == 200
    response = dispatch(client, s, [line(sent["items"][0])], workshop=True, notes="废泥回库")
    batch = response.json()["items"][0]
    url = "/api/material-transfers/" + batch["batch_no"]
    edited = client.patch(url, headers=s["other_headers"], json={"sludge_content_percent": 20, "weight": 2, "expected_version": batch["version"]})
    assert edited.status_code == 200, edited.text
    assert stock(client, s, True)["on_hand_weight"] == 8
    assert edited.json()["history"][-1]["changes"]["sludge_content_percent"] == {"before": 30, "after": 20}
    assert client.patch(url, headers=s["other_headers"], json={"weight": 3, "expected_version": edited.json()["version"]}).status_code == 422
    assert client.delete(url, headers=s["other_headers"]).status_code == 204
    assert stock(client, s, True)["on_hand_weight"] == 10


@pytest.mark.parametrize("overrides", [
    {"sludge_content_percent": None}, {"sludge_gross_weight": None}, {"sludge_content_percent": 0},
    {"sludge_content_percent": 101}, {"sludge_content_percent": -5}, {"sludge_content_percent": "3.333"},
    {"sludge_gross_weight": 0}, {"sludge_gross_weight": "1.0001"}, {"weight": 10},
    {"material_type": "semi_finished"}, {"sludge_gross_weight": ".001", "sludge_content_percent": 1, "weight": 0},
])
def test_invalid_measurement_never_creates_stock(client, warehouse, overrides):
    values = {"quantity": 0, "weight": 3, "material_type": "sludge", "sludge_gross_weight": 10, "sludge_content_percent": 30, **overrides}
    response = intake(client, warehouse, **values)
    assert response.status_code == 422, response.text
    assert stock(client, warehouse)["owned_weight"] == 0


def test_receipt_decimal_rounding_and_legacy_unconverted_stock(client, warehouse):
    s = warehouse
    receipt = intake(client, s, quantity=0, weight="0.1005", material_type="sludge", sludge_gross_weight="1.005", sludge_content_percent=10)
    assert receipt.status_code == 201, receipt.text
    assert stock(client, s)["owned_weight"] == .1005
    assert intake(client, s, quantity=0, weight="0.1005", material_type="sludge", sludge_gross_weight="1.005", sludge_content_percent=10).json() == receipt.json()
    # Simulate a pre-upgrade row: missing means unknown, never a guessed 100%.
    with SessionLocal() as db:
        row = db.get(MaterialTransfer, receipt.json()["id"])
        row.sludge_gross_weight = row.sludge_content_percent = None
        db.commit()
    legacy = client.get("/api/material-transfers/" + receipt.json()["batch_no"]).json()
    assert legacy["sludge_content_percent"] is None and legacy["weight"] == .1005
    payload = dict(entry_kind="warehouse_outbound", next_team_id=None, external_destination="回收单位", notes="历史废泥处理", idempotency_key="legacy")
    assert dispatch(client, s, [line(legacy, gross="1.005", percent=10, weight=".101")], **payload).status_code == 422
    result = dispatch(client, s, [{"source_transfer_id": legacy["id"], "quantity": 0, "weight": ".101"}], **payload)
    assert result.status_code == 201, result.text
    assert result.json()["items"][0]["sludge_content_percent"] is None


def test_measured_sludge_excess_exits_keep_gross_and_signed_book_stock(client, warehouse):
    s = warehouse
    receipt = intake(client, s, quantity=0, weight=10, material_type="sludge", sludge_gross_weight=20, sludge_content_percent=50).json()
    external = dict(entry_kind="warehouse_outbound", next_team_id=None, external_destination="回收单位", notes="废泥处理")
    first = [line(receipt, gross=6, percent=50, weight=3)]
    result = dispatch(client, s, first, **external)
    assert result.status_code == 201, result.text
    assert dispatch(client, s, first, **external).json() == result.json()
    items = client.get(base(s) + "/stock?availability=all").json()["items"]
    assert items[0]["sludge_available_gross_weight"] == 14
    assert items[0]["scrap_available_weight"] == 7
    result = dispatch(client, s, [line(receipt, gross=8, percent=50, weight=4), line(receipt, gross=8, percent=50, weight=4)], **external, idempotency_key="over-limit")
    assert result.status_code == 201, result.text
    assert stock(client, s)["owned_weight"] == -1
    last = dispatch(client, s, [line(receipt, gross=14, percent=50, weight=7)], **external, idempotency_key="last-sludge")
    assert last.status_code == 201, last.text
    assert stock(client, s)["owned_weight"] == -8
    assert dispatch(client, s, first, **external, idempotency_key="duplicate-new-request").status_code == 201
    assert stock(client, s)["owned_weight"] == -11


def test_legacy_rounded_measurement_survives_metadata_edit_until_measurement_changes(client, warehouse):
    s = warehouse
    origin = intake(client, s, quantity=0, weight=1).json()
    sent = dispatch(client, s, [{"source_transfer_id": origin["id"], "quantity": 0, "weight": 1}]).json()
    assert confirm(client, s, sent, workshop=True).status_code == 200
    receipt = dispatch(client, s, [line(sent["items"][0], gross="1.005", percent=10, weight=".1005")], workshop=True).json()["items"][0]
    with SessionLocal.begin() as db:
        db.get(MaterialTransfer, receipt["id"]).weight = Decimal(".101")
    url = "/api/material-transfers/" + receipt["batch_no"]
    edited = client.patch(url, headers=s["other_headers"], json={"notes": "补充历史转料说明"})
    assert edited.status_code == 200, edited.text
    assert edited.json()["weight"] == .101
    assert stock(client, s, True)["on_hand_weight"] == .899
    assert client.patch(url, headers=s["other_headers"], json={"sludge_gross_weight": "1.006"}).status_code == 422
    measured = client.patch(url, headers=s["other_headers"], json={"sludge_gross_weight": "1.006", "weight": ".1006"})
    assert measured.status_code == 200, measured.text
    assert measured.json()["weight"] == .1006
    assert stock(client, s, True)["on_hand_weight"] == .8994


def test_rounding_preserves_actual_sludge_gap_separately_from_book_weight(client, warehouse):
    s = warehouse
    receipt = intake(client, s, quantity=0, weight=".1005", material_type="sludge", sludge_gross_weight="1.005", sludge_content_percent=10).json()
    external = dict(entry_kind="warehouse_outbound", next_team_id=None, external_destination="回收单位", notes="废泥处理")
    # Preserve both the actual and accounted difference at the new precision.
    response = dispatch(client, s, [line(receipt, gross="1.009", percent=10, weight=".1009")], **external)
    assert response.status_code == 201, response.text
    rows = client.get(base(s) + "/stock?availability=all").json()["items"]
    assert rows[0]["sludge_available_gross_weight"] == -.004
    sources = client.get(base(s) + f'/inventory/{receipt["id"]}/sources').json()["items"]
    assert sources[0]["sludge_available_gross_weight"] == -.004
    assert dispatch(client, s, [line(receipt, gross="1.005", percent=10, weight=".1005")], **external, idempotency_key="second-gross").status_code == 201


def test_sludge_opening_stock_uses_accounted_weight(client):
    from test_team_business import initialize, _setup_three_teams
    s = _setup_three_teams(client)
    row = initialize(client, s, quantity=0, weight=3, material_type="sludge", sludge_gross_weight=10, sludge_content_percent=30)
    assert (row["weight"], row["sludge_gross_weight"], row["sludge_content_percent"]) == (3, 10, 30)
    summary = client.get(f'/api/team-materials/{s["target"]["id"]}/overview').json()
    assert summary["totals"]["owned_weight"] == 3


def test_recorded_effective_loss_reduces_dispatchable_sludge(client, warehouse):
    s = warehouse
    receipt = intake(client, s, quantity=0, weight=3, material_type="sludge", sludge_gross_weight=10, sludge_content_percent=30).json()
    response = client.post(base(s) + "/losses", headers=s["headers"], json={
        "source_transfer_id": receipt["id"], "quantity": 0, "weight": ".3", "reason": "按折算重量登记", "idempotency_key": "loss-sludge"})
    assert response.status_code == 201, response.text
    rows = client.get(base(s) + "/stock?availability=all").json()["items"]
    assert (rows[0]["sludge_available_gross_weight"], rows[0]["scrap_available_weight"]) == (9, 2.7)


def test_sludge_stock_page_aggregates_measurements_without_per_row_queries(client, warehouse):
    from test_transfer_list_loading import read_statements
    for index in range(3):
        result = intake(client, warehouse, quantity=0, weight=3, material_type="sludge", sludge_gross_weight=10,
                        sludge_content_percent=30, idempotency_key=f"sludge-list-{index}")
        assert result.status_code == 201, result.text
    counts = []
    for size in (1, 10):
        with read_statements() as queries:
            response = client.get(base(warehouse) + f"/stock?availability=all&page_size={size}")
        assert response.status_code == 200, response.text
        assert all(row["sludge_available_gross_weight"] == 10 for row in response.json()["items"])
        counts.append(len(queries))
    assert counts[0] == counts[1]


def test_migration_retains_old_weights_and_marks_percentage_unknown(tmp_path):
    path = Path(__file__).parents[1] / "alembic/versions/20260929_0025_sludge_measurement.py"
    spec = importlib.util.spec_from_file_location("sludge_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite:///" + str(tmp_path / "old.db"))
    try:
        with engine.begin() as connection:
            connection.execute(text("CREATE TABLE material_transfers (id INTEGER PRIMARY KEY, material_type VARCHAR(32), weight NUMERIC(14,3))"))
            connection.execute(text("INSERT INTO material_transfers VALUES (1, 'sludge', 12.345)"))
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
            row = connection.execute(text("SELECT * FROM material_transfers")).mappings().one()
            assert Decimal(str(row["weight"])) == Decimal("12.345")
            assert row["sludge_content_percent"] is None and row["sludge_gross_weight"] is None
            assert "ck_mt_sludge_measurement" in {item["name"] for item in inspect(connection).get_check_constraints("material_transfers")}
    finally:
        engine.dispose()
