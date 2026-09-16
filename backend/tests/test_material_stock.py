from decimal import Decimal

import pytest
from sqlalchemy import select, func

from app.database import SessionLocal
from app.models import MaterialDispatch, MaterialLoss, MaterialTransfer, Team
from app.configure_material_teams import configure_material_teams, MATERIAL_TEAMS
from test_material_transfers import _setup_three_teams, _create, _leader


@pytest.fixture()
def stock_setup(client):
    setup = _setup_three_teams(client)
    setup["stock_team_id"] = setup["target"]["id"]
    setup["stock_headers"] = setup["target_headers"]
    return setup


def receive_lot(client, setup, *, key="lot-1", material_name="铜钼", quantity=100, weight="10.000"):
    response = _create(client, setup, serial_no=f"FLOW-{key}", idempotency_key=key,
                       material_name=material_name, material_type="semi_finished", quantity=quantity, weight=weight)
    assert response.status_code == 201, response.text
    confirmed = client.post(f"/api/material-transfers/{response.json()['batch_no']}/confirm",
                            headers=setup["target_headers"], json={"idempotency_key": f"receive-{key}"})
    assert confirmed.status_code == 200, confirmed.text
    return confirmed.json()


def endpoint(setup, suffix):
    return f"/api/team-materials/{setup['stock_team_id']}/{suffix}"


def dispatch(client, setup, lines, **overrides):
    return client.post(endpoint(setup, "dispatches"), headers=setup["stock_headers"], json={
        "next_team_id": setup["third"]["id"], "idempotency_key": "dispatch-1", "lines": lines, **overrides,
    })


def loss(client, setup, lot, **overrides):
    return client.post(endpoint(setup, "losses"), headers=setup["stock_headers"], json={
        "source_transfer_id": lot["id"], "quantity": 2, "weight": "0.200", "reason": "清点发现丢失",
        "idempotency_key": "loss-1", **overrides,
    })


def totals(client, setup):
    response = client.get(endpoint(setup, "overview"))
    assert response.status_code == 200, response.text
    return response.json()["totals"]


def test_pending_stock_receipt_and_legacy_boundary(client, stock_setup):
    setup = stock_setup
    pending = _create(client, setup).json()
    overview = client.get(endpoint(setup, "overview")).json()
    assert overview["pending_incoming"] == {"quantity": 12, "weight": 3.25, "count": 1}
    assert overview["totals"]["available_quantity"] == 0
    assert client.get(endpoint(setup, "stock")).json()["total"] == 0
    assert loss(client, setup, pending).status_code == 409
    lot = receive_lot(client, setup)
    assert lot["stock_tracked"] is True
    assert totals(client, setup)["available_quantity"] == 100
    # Pre-upgrade receipts explicitly stay outside the inferred stock balance.
    with SessionLocal() as db:
        db.get(MaterialTransfer, lot["id"]).stock_tracked = False
        db.commit()
    assert client.get(endpoint(setup, "stock")).json()["total"] == 0
    assert client.get(endpoint(setup, "overview")).json()["legacy_received_count"] == 1
    assert loss(client, setup, lot).status_code == 409


def test_bulk_reservation_loss_confirmation_and_void_conserve_both_amounts(client, stock_setup):
    setup = stock_setup
    first = receive_lot(client, setup)
    second = receive_lot(client, setup, key="lot-2", quantity=20, weight="5.000")
    lines = [{"source_transfer_id": first["id"], "quantity": 30, "weight": "3.000"},
             {"source_transfer_id": second["id"], "quantity": 10, "weight": "2.000"}]
    response = dispatch(client, setup, lines)
    assert response.status_code == 201, response.text
    group = response.json()
    assert group["line_count"] == 2 and group["total_quantity"] == 40
    assert group["total_weight"] == 5 and group["status"] == "pending"
    assert {row["serial_no"] for row in group["items"]} == {first["serial_no"], second["serial_no"]}
    assert {row["source_transfer_id"] for row in group["items"]} == {first["id"], second["id"]}
    assert all(row["source_transfer_batch_no"] in (first["batch_no"], second["batch_no"]) for row in group["items"])
    assert all(row["dispatch_no"] == group["dispatch_no"] for row in group["items"])
    assert len({row["barcode_payload"] for row in group["items"]}) == 2
    assert totals(client, setup)["reserved_quantity"] == 40
    assert totals(client, setup)["available_quantity"] == 80
    assert totals(client, setup)["available_weight"] == 10
    lost = loss(client, setup, first)
    assert lost.status_code == 201, lost.text
    assert totals(client, setup)["available_quantity"] == 78
    assert totals(client, setup)["available_weight"] == 9.8
    assert client.get(f"/api/material-transfers/{first['batch_no']}").json()["loss_records"][0]["reason"] == "清点发现丢失"
    assert client.get(f"/api/material-transfers/{first['batch_no']}").json()["quantity"] == 100
    outgoing = group["items"][0]
    receipt = client.post(f"/api/material-transfers/{outgoing['batch_no']}/confirm", headers=setup["third_headers"],
                          json={"idempotency_key": "downstream-confirm", "expected_version": outgoing["version"]})
    assert receipt.status_code == 200, receipt.text
    assert totals(client, setup)["dispatched_quantity"] == 30
    assert totals(client, setup)["reserved_quantity"] == 10
    assert totals(client, setup)["available_quantity"] == 78
    downstream = client.get(f"/api/team-materials/{setup['third']['id']}/overview").json()["totals"]
    assert downstream["available_quantity"] == 30 and downstream["available_weight"] == 3
    assert client.get(endpoint(setup, "dispatches")).json()["items"][0]["status"] == "partial"
    remaining = group["items"][1]
    assert client.delete(f"/api/material-transfers/{remaining['batch_no']}", headers=setup["stock_headers"]).status_code == 204
    assert totals(client, setup)["available_quantity"] == 88
    assert totals(client, setup)["available_weight"] == 11.8
    assert totals(client, setup)["reserved_quantity"] == 0
    closed = client.get(endpoint(setup, "dispatches")).json()["items"][0]
    assert closed["status"] == "received" and closed["total_quantity"] == 30


def test_stock_idempotency_atomic_failure_and_permission_checks(client, stock_setup):
    setup = stock_setup
    first = receive_lot(client, setup)
    second = receive_lot(client, setup, key="lot-2", quantity=5, weight="0.500")
    invalid = [{"source_transfer_id": first["id"], "quantity": 50, "weight": 5},
               {"source_transfer_id": second["id"], "quantity": 6, "weight": "0.100"}]
    assert dispatch(client, setup, invalid).status_code == 409
    assert totals(client, setup)["reserved_quantity"] == 0
    with SessionLocal() as db:
        assert db.scalar(select(func.count(MaterialDispatch.id))) == 0
        assert db.scalar(select(func.count(MaterialTransfer.id)).where(MaterialTransfer.source_transfer_id.is_not(None))) == 0
    lines = [{"source_transfer_id": first["id"], "quantity": 60, "weight": 6}]
    created = dispatch(client, setup, lines)
    assert created.status_code == 201, created.text
    retried = dispatch(client, setup, lines)
    assert retried.json() == created.json()
    assert dispatch(client, setup, [{**lines[0], "quantity": 61}]).status_code == 409
    assert dispatch(client, setup, lines, idempotency_key="overspend").status_code == 409
    lost = loss(client, setup, first)
    assert lost.status_code == 201 and loss(client, setup, first).json() == lost.json()
    assert loss(client, setup, first, reason="不同原因").status_code == 409
    assert loss(client, setup, first, idempotency_key="too-much", quantity=39).status_code == 409
    assert loss(client, setup, first, idempotency_key="too-heavy", weight=4).status_code == 409
    for headers in ({}, setup["source_headers"], setup["third_headers"]):
        attempt = client.post(endpoint(setup, "dispatches"), headers=headers, json={
            "next_team_id": setup["third"]["id"], "idempotency_key": "forbidden", "lines": lines,
        })
        assert attempt.status_code == 403
    other_team = {**setup, "stock_team_id": setup["third"]["id"], "stock_headers": setup["third_headers"]}
    assert loss(client, other_team, first, idempotency_key="foreign-lot").status_code == 403
    with SessionLocal() as db:
        assert db.scalar(select(func.count(MaterialLoss.id))) == 1


def test_linked_edits_adjust_reservation_without_rewriting_identity(client, stock_setup):
    setup = stock_setup
    lot = receive_lot(client, setup)
    created = dispatch(client, setup, [{"source_transfer_id": lot["id"], "quantity": 80, "weight": 8}]).json()["items"][0]
    assert loss(client, setup, lot, quantity=10, weight=1).status_code == 201
    url = f"/api/material-transfers/{created['batch_no']}"
    for payload in ({"quantity": 91}, {"weight": "9.001"}):
        assert client.patch(url, json=payload, headers=setup["stock_headers"]).status_code == 409
    for payload in ({"serial_no": "OTHER"}, {"material_name": "其他材质"}, {"next_team_id": setup["source"]["id"]}):
        assert client.patch(url, json=payload, headers=setup["stock_headers"]).status_code == 422
    updated = client.patch(url, json={"quantity": 70, "weight": "7.000", "expected_version": 1}, headers=setup["stock_headers"])
    assert updated.status_code == 200, updated.text
    assert updated.json()["version"] == 2
    assert totals(client, setup)["reserved_quantity"] == 70
    assert totals(client, setup)["available_quantity"] == 20
    assert client.patch(url, json={"quantity": 60, "expected_version": 1}, headers=setup["stock_headers"]).status_code == 409
    assert client.delete(url, headers=setup["stock_headers"]).status_code == 204
    assert totals(client, setup)["available_quantity"] == 90


def test_material_overview_filters_paging_dispatch_status_and_loss_details(client, stock_setup):
    setup = stock_setup
    lots = [receive_lot(client, setup, key=f"LITERAL%_{i}", material_name="铜钼" if i < 2 else None) for i in range(3)]
    overview = client.get(endpoint(setup, "overview")).json()
    assert {row["material_name"]: row["available_quantity"] for row in overview["materials"]} == {"铜钼": 200, None: 100}
    page = client.get(endpoint(setup, "stock"), params={"query": "%_", "material_type": "semi_finished", "page_size": 1, "page": 2}).json()
    assert page["total"] == 3 and len(page["items"]) == 1
    assert page["items"][0]["transfer"]["id"] == lots[1]["id"]
    assert page["items"][0]["transfer"]["history"] == []
    assert client.get(endpoint(setup, "stock"), params={"query": "' OR 1=1"}).json()["total"] == 0
    for i, lot in enumerate(lots[:2]):
        assert loss(client, setup, lot, idempotency_key=f"loss-{i}").status_code == 201
        assert dispatch(client, setup, [{"source_transfer_id": lot["id"], "quantity": 98, "weight": "9.800"}],
                        idempotency_key=f"dispatch-{i}").status_code == 201
    assert client.get(endpoint(setup, "stock")).json()["total"] == 1
    assert client.get(endpoint(setup, "stock"), params={"availability": "all"}).json()["total"] == 3
    group_page = client.get(endpoint(setup, "dispatches"), params={"query": "LITERAL%_", "status": "pending", "page": 2, "page_size": 1}).json()
    assert group_page["total"] == 2 and len(group_page["items"]) == 1
    loss_page = client.get(endpoint(setup, "losses"), params={"query": "铜钼", "source_transfer_id": lots[0]["id"]}).json()
    assert loss_page["total"] == 1 and loss_page["items"][0]["batch_no"] == lots[0]["batch_no"]
    # Initial manual transfers are included in their source team's outbound log.
    manual = client.get(f"/api/team-materials/{setup['source']['id']}/dispatches").json()
    assert manual["total"] == 3 and all(item["line_count"] == 1 for item in manual["items"])


def test_stock_validation_and_atomic_rollback_on_audit_failure(client, stock_setup, monkeypatch):
    from app import material_transfer_workflow
    setup = stock_setup
    lot = receive_lot(client, setup)
    valid = {"source_transfer_id": lot["id"], "quantity": 1, "weight": "0.100"}
    for changes in ({"quantity": -1}, {"weight": "0.0001"}, {"quantity": 0, "weight": 0}, {"quantity": 1.5}, {"source_transfer_id": 0}):
        assert dispatch(client, setup, [{**valid, **changes}]).status_code == 422
    assert dispatch(client, setup, [valid, valid]).status_code == 422
    assert dispatch(client, setup, []).status_code == 422
    assert loss(client, setup, lot, reason="   ").status_code == 422
    assert client.get("/api/team-materials/0/overview").status_code == 422
    assert client.get("/api/team-materials/999999/overview").status_code == 404
    assert client.get(endpoint(setup, "stock"), params={"page_size": 101}).status_code == 422
    assert dispatch(client, setup, [valid], next_team_id=setup["stock_team_id"]).status_code == 422

    def fail_audit(*args, **kwargs):
        raise RuntimeError("audit failed")
    monkeypatch.setattr(material_transfer_workflow, "_record_event", fail_audit)
    with pytest.raises(RuntimeError, match="audit failed"):
        dispatch(client, setup, [valid])
    assert totals(client, setup)["reserved_quantity"] == 0
    with SessionLocal() as db:
        assert db.scalar(select(func.count(MaterialDispatch.id))) == 0


def test_weight_only_stock_and_explicit_warehouse_classification(client, stock_setup):
    setup = stock_setup
    warehouse = client.post("/api/teams", json={"code": "FACTORY-WAREHOUSE", "name": "库房", "kind": "warehouse"}).json()
    lot = receive_lot(client, setup, quantity=0, weight="1.235")
    lines = [{"source_transfer_id": lot["id"], "quantity": 0, "weight": "0.235", "material_type": "scrap_chips"}]
    assert dispatch(client, setup, [{**lines[0], "material_type": None}], next_team_id=warehouse["id"]).status_code == 422
    good = dispatch(client, setup, lines, next_team_id=warehouse["id"])
    assert good.status_code == 201, good.text
    assert good.json()["items"][0]["material_type"] == "scrap_chips"
    assert loss(client, setup, lot, quantity=0, weight="0.001").status_code == 201
    assert totals(client, setup)["available_weight"] == 0.999


def test_eight_team_configuration_preserves_old_references_and_is_idempotent(client):
    setup = _setup_three_teams(client)
    old = client.post("/api/teams", json={"code": "FACTORY-ROLL", "name": "扎板"}).json()
    scrap = client.post("/api/teams", json={"code": "FACTORY-SCRAP", "name": "转废", "kind": "scrap"}).json()
    with SessionLocal() as db:
        first = configure_material_teams(db)
        second = configure_material_teams(db)
        assert len(MATERIAL_TEAMS) == 8
        assert len(first["inserted"]) == 7
        assert first["renamed"] == [{"id": old["id"], "before": "扎板", "after": "轧制"}]
        assert second["inserted"] == second["renamed"] == []
        assert db.get(Team, scrap["id"]).active is True
        assert db.get(Team, setup["source"]["id"]).name == "上序班"


@pytest.mark.parametrize("partial", [False, True])
def test_stock_migration_preserves_historical_rows_and_adds_constraints(tmp_path, partial):
    import importlib.util
    from pathlib import Path
    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext
    from sqlalchemy import create_engine, inspect
    from sqlalchemy.exc import IntegrityError

    def migration(filename):
        path = Path(__file__).parents[1] / "alembic" / "versions" / filename
        spec = importlib.util.spec_from_file_location(filename.removesuffix(".py"), path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    engine = create_engine(f"sqlite:///{tmp_path / 'stock-migration.sqlite'}")
    with engine.begin() as conn:
        conn.exec_driver_sql("PRAGMA foreign_keys=ON")
        conn.exec_driver_sql("CREATE TABLE teams (id INTEGER PRIMARY KEY)")
        conn.exec_driver_sql("CREATE TABLE users (id INTEGER PRIMARY KEY)")
        conn.exec_driver_sql("INSERT INTO teams VALUES (1),(2)")
        with Operations.context(MigrationContext.configure(conn)):
            for filename in ("20260906_0004_material_transfers.py", "20260906_0005_transfer_document.py", "20260906_0006_transfer_query_indexes.py"):
                migration(filename).upgrade()
        conn.exec_driver_sql("""INSERT INTO material_transfers
            (id,batch_no,serial_no,source_team_id,source_team_code,source_team_name,
             next_team_id,next_team_code,next_team_name,quantity,weight,status,created_by,created_at,updated_at)
            VALUES (1,'TL-OLD','OLD-SERIAL',1,'A','历史上序',2,'B','历史下序',10,1.250,'received','原操作人',
                    '2026-09-01 00:00:00','2026-09-01 00:00:00')""")
        before = dict(conn.exec_driver_sql("SELECT * FROM material_transfers").mappings().one())
        if partial:
            conn.exec_driver_sql("ALTER TABLE material_transfers ADD COLUMN source_transfer_id INTEGER")
            conn.exec_driver_sql("ALTER TABLE material_transfers ADD COLUMN dispatch_id INTEGER")
        with Operations.context(MigrationContext.configure(conn)):
            stock_migration = migration("20260906_0007_team_material_stock.py")
            stock_migration.upgrade()
            stock_migration.upgrade()
        after = dict(conn.exec_driver_sql("SELECT * FROM material_transfers").mappings().one())
        assert {key: after[key] for key in before} == before
        assert after["stock_tracked"] == 0
        assert after["source_transfer_id"] is None and after["dispatch_id"] is None
        assert conn.exec_driver_sql("SELECT COUNT(*) FROM material_losses").scalar_one() == 0
        indexes = {item["name"]: item["column_names"] for item in inspect(conn).get_indexes("material_transfers")}
        assert {"ix_mt_stock_source_status", "ix_mt_stock_lot", "ix_material_transfers_dispatch_id"} <= indexes.keys()
        assert indexes["ix_mt_stock_lot"] == ["next_team_id", "status", "stock_tracked", "received_at", "id"]
        assert conn.exec_driver_sql("PRAGMA foreign_key_check").fetchall() == []
        with pytest.raises(IntegrityError):
            with conn.begin_nested():
                conn.exec_driver_sql("UPDATE material_transfers SET source_transfer_id=999 WHERE id=1")
        with pytest.raises(RuntimeError, match="backup"):
            stock_migration.downgrade()
    engine.dispose()
