"""Migration and real concurrent stock writes on EMPTY disposable MySQL only.

Requires --confirm-disposable and database heatsink_stock_qa. Run in isolated
containers without production credentials, volumes, or published ports.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
import importlib.util
import json
from pathlib import Path
from threading import Barrier, local
from unittest.mock import patch

from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from fastapi import HTTPException
import sqlalchemy as sa

from app.database import Base, engine, SessionLocal
from app import material_stock as stock
from app import material_transfer_workflow as workflow
from app import warehouse_receipts
from app import material_dispatch_workflow as batches
from app.models import MaterialDispatch, MaterialLoss, MaterialTransfer, User, Team
from app.schemas import MaterialTransferCreate, MaterialTransferConfirm, MaterialTransferUpdate, WarehouseReceiptCreate
from app.record_filters import RecordFilters


def migration(filename):
    path = Path(__file__).resolve().parents[1] / "backend/alembic/versions" / filename
    spec = importlib.util.spec_from_file_location(filename.removesuffix(".py"), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def race(*operations):
    """Both requests read their idempotency snapshot before locking a lot."""
    barrier, state, original = Barrier(len(operations)), local(), stock.lock_lot

    def synchronized_lock(*args, **kwargs):
        if not getattr(state, "entered", False):
            state.entered = True
            barrier.wait(timeout=15)
        return original(*args, **kwargs)

    def execute(operation):
        with SessionLocal() as db:
            try:
                return {"status": 201, "body": operation(db)}
            except HTTPException as exc:
                assert exc.status_code == 409, (exc.status_code, exc.detail)
                return {"status": 409, "detail": exc.detail}

    with patch.object(stock, "lock_lot", synchronized_lock):
        with ThreadPoolExecutor(max_workers=len(operations)) as pool:
            return list(pool.map(execute, operations))


def run():
    parser = argparse.ArgumentParser()
    parser.add_argument("--confirm-disposable", action="store_true", required=True)
    parser.parse_args()
    if engine.dialect.name != "mysql" or engine.url.database != "heatsink_stock_qa":
        raise RuntimeError("Only EMPTY disposable MySQL heatsink_stock_qa is allowed")
    files = [f"20260906_000{n}_{suffix}.py" for n, suffix in (
        (4, "material_transfers"), (5, "transfer_document"),
        (6, "transfer_query_indexes"), (7, "team_material_stock"))]
    with engine.connect() as conn:
        if sa.inspect(conn).get_table_names():
            raise RuntimeError("Verification requires an empty disposable database")
        version, isolation = conn.exec_driver_sql("SELECT VERSION(), @@transaction_isolation").one()
        assert isolation == "REPEATABLE-READ", isolation
        Base.metadata.create_all(conn, tables=[t for t in Base.metadata.sorted_tables if t.name not in {
            "material_transfers", "material_transfer_events", "material_dispatches", "material_losses"}])
        conn.execute(Team.__table__.insert(), [
            {"id": i, "code": f"QA-{i}", "name": f"隔离测试班组{i}", "active": True}
            for i in (1, 2, 3)])
        with Operations.context(MigrationContext.configure(conn)):
            migration(files[0]).upgrade()
        conn.exec_driver_sql("""INSERT INTO material_transfers
            (id,batch_no,serial_no,source_team_id,source_team_code,source_team_name,
             next_team_id,next_team_code,next_team_name,quantity,weight,status,created_by,created_at,updated_at)
            VALUES (1,'TL20260101000001','LEGACY-PRESERVED',1,'QA-1','隔离测试班组1',
                    2,'QA-2','隔离测试班组2',12,3.25,'received','历史操作人',
                    '2026-01-01 00:00:00','2026-01-01 00:00:00')""")
        before = dict(conn.exec_driver_sql("SELECT * FROM material_transfers WHERE id=1").mappings().one())
        conn.commit()
        with Operations.context(MigrationContext.configure(conn)):
            for filename in files[1:3]:
                migration(filename).upgrade()
            # Simulate a MySQL interrupted DDL run after adding nullable
            # columns but before installing their foreign keys.
            conn.exec_driver_sql("ALTER TABLE material_transfers ADD COLUMN source_transfer_id INTEGER, ADD COLUMN dispatch_id INTEGER")
            migration(files[-1]).upgrade()
            migration(files[-1]).upgrade()
        after = dict(conn.exec_driver_sql("SELECT * FROM material_transfers WHERE id=1").mappings().one())
        assert {key: after[key] for key in before} == before
        assert after["stock_tracked"] == 0 and after["source_transfer_id"] is None
        indexes = {row["name"] for row in sa.inspect(conn).get_indexes("material_transfers")}
        assert {"ix_mt_stock_lot", "ix_mt_stock_source_status", "ix_material_transfers_dispatch_id"} <= indexes
        fks = {tuple(fk["constrained_columns"]) for fk in sa.inspect(conn).get_foreign_keys("material_transfers")}
        assert {("source_transfer_id",), ("dispatch_id",)} <= fks
        with Operations.context(MigrationContext.configure(conn)):
            migration("20260906_0008_warehouse_receipts.py").upgrade()
            migration("20260906_0008_warehouse_receipts.py").upgrade()
        upgraded = dict(conn.exec_driver_sql("SELECT * FROM material_transfers WHERE id=1").mappings().one())
        assert {key: upgraded[key] for key in after} == after
        assert upgraded["entry_kind"] == "transfer"
        with Operations.context(MigrationContext.configure(conn)):
            conn.exec_driver_sql("ALTER TABLE material_transfers ADD COLUMN external_destination VARCHAR(240)")
            migration("20260907_0009_external_outbound.py").upgrade()
            migration("20260907_0009_external_outbound.py").upgrade()
        external_upgraded = dict(conn.exec_driver_sql("SELECT * FROM material_transfers WHERE id=1").mappings().one())
        assert {key: external_upgraded[key] for key in upgraded} == upgraded
        assert {"ix_mt_source_kind_created", "ix_mt_intake_created"} <= {row["name"] for row in sa.inspect(conn).get_indexes("material_transfers")}
        assert any(fk["constrained_columns"] == ["dispatched_by_user_id"] for fk in sa.inspect(conn).get_foreign_keys("material_transfers"))
        with Operations.context(MigrationContext.configure(conn)):
            conn.exec_driver_sql("ALTER TABLE material_dispatches ADD COLUMN confirmed_by VARCHAR(80)")
            migration("20260907_0010_dispatch_confirmation.py").upgrade()
            migration("20260907_0010_dispatch_confirmation.py").upgrade()
        assert any(fk["constrained_columns"] == ["confirmed_by_user_id"] for fk in sa.inspect(conn).get_foreign_keys("material_dispatches"))
        assert any(u["column_names"] == ["confirmation_idempotency_key"] for u in sa.inspect(conn).get_unique_constraints("material_dispatches"))
        with Operations.context(MigrationContext.configure(conn)):
            for filename in ("20260916_0013_warehouse_provenance.py", "20260918_0014_independent_batches.py"):
                migration(filename).upgrade()
                migration(filename).upgrade()
        assert next(c for c in sa.inspect(conn).get_columns("material_dispatches") if c['name'] == 'dispatch_no')['nullable']
        conn.execute(sa.update(Team).where(Team.id == 2).values(code="FACTORY-QC"))
        conn.commit()

    with SessionLocal.begin() as db:
        db.add_all(User(id=i, username=f"qa-{i}", display_name=f"测试班组长{i}",
                        password_hash="NO-LOGIN-DISPOSABLE-TEST", role="TEAM", team_id=i, active=True) for i in (1, 2, 3))
    with SessionLocal() as db:
        users = {i: db.get(User, i) for i in (1, 2, 3)}
        db.expunge_all()

    def received(key):
        with SessionLocal() as db:
            created = workflow.create_material_transfer(db, MaterialTransferCreate(
                serial_no=key, next_team_id=2, material_name="铜钼", material_type="semi_finished",
                quantity=100, weight=Decimal("10.000"), idempotency_key=key), users[1])
        with SessionLocal() as db:
            return workflow.confirm_material_transfer(db, created["batch_no"],
                MaterialTransferConfirm(idempotency_key=f"receive-{key}"), users[2])

    def outgoing(lot, key, quantity=60):
        payload = stock.DispatchCreate(next_team_id=3, idempotency_key=key, lines=[{
            "source_transfer_id": lot["id"], "quantity": quantity, "weight": Decimal(quantity) / 10}])
        return lambda db: stock.create_dispatch(db, 2, payload, users[2])

    def lost(lot, key, quantity=60):
        payload = stock.LossCreate(source_transfer_id=lot["id"], quantity=quantity,
            weight=Decimal(quantity) / 10, reason="隔离并发测试", idempotency_key=key)
        return lambda db: stock.create_loss(db, 2, payload, users[2])

    results = {}
    for name, factory1, factory2 in (
        ("dispatch_vs_dispatch", outgoing, outgoing),
        ("loss_vs_dispatch", lost, outgoing),
        ("loss_vs_loss", lost, lost)):
        lot = received(name)
        raced = race(factory1(lot, f"{name}-1"), factory2(lot, f"{name}-2"))
        assert sorted(row["status"] for row in raced) == [201, 409], raced
        with SessionLocal.begin() as db:
            locked = stock.lock_lot(db, lot["id"], 2)
            assert stock.available_locked(db, locked) == (40, Decimal("4.000"))
        results[name] = [row["status"] for row in raced]

    for name, factory, model in (("duplicate_dispatch", outgoing, MaterialDispatch), ("duplicate_loss", lost, MaterialLoss)):
        lot = received(name)
        operation = factory(lot, name, quantity=100)
        raced = race(operation, operation)
        assert [row["status"] for row in raced] == [201, 201], raced
        assert raced[0]["body"] == raced[1]["body"], raced
        with SessionLocal() as db:
            assert db.scalar(sa.select(sa.func.count(model.id)).where(model.idempotency_key == name)) == 1
        results[name] = [row["status"] for row in raced]

    lot1, lot2 = received("atomic-1"), received("atomic-2")
    with SessionLocal() as db:
        lost(lot2, "atomic-loss", 95)(db)
    with SessionLocal() as db:
        try:
            stock.create_dispatch(db, 2, stock.DispatchCreate(next_team_id=3, idempotency_key="atomic-fail", lines=[
                {"source_transfer_id": lot1["id"], "quantity": 10, "weight": 1},
                {"source_transfer_id": lot2["id"], "quantity": 10, "weight": 1}]), users[2])
            raise AssertionError("Expected whole submission rejection")
        except HTTPException as exc:
            assert exc.status_code == 409
    with SessionLocal() as db:
        assert db.scalar(sa.select(sa.func.count(MaterialDispatch.id)).where(MaterialDispatch.idempotency_key == "atomic-fail")) == 0
        assert db.scalar(sa.select(sa.func.count(MaterialTransfer.id)).where(MaterialTransfer.source_transfer_id == lot1["id"])) == 0
        # Exercise MySQL grouped queries and all list filters, not just SQLite.
        overview = stock.overview(db, 2)
        assert overview["legacy_received_count"] == 1
        assert overview["totals"]["available_quantity"] == 225
        assert stock.list_stock(db, 2, users[2])["total"] == 5
        assert stock.list_dispatches(db, 2, users[2], status="pending")["total"] >= 2
        assert stock.list_dispatches(db, 2, users[2], query="duplicate_dispatch")["total"] == 1
        assert stock.list_losses(db, 2, query="atomic-2")["total"] == 1
    with SessionLocal.begin() as db:
        db.add(Team(id=4, code="FACTORY-WAREHOUSE", name="库房", kind="warehouse", active=True))
        db.flush()
        db.add(User(id=4, username="qa-warehouse", display_name="隔离库房班组长", role="TEAM", team_id=4,
                    password_hash="NO-LOGIN-DISPOSABLE-TEST", active=True))
    with SessionLocal() as db:
        warehouse_user = db.get(User, 4)
        db.expunge_all()

    def intake_race(payloads):
        barrier = Barrier(len(payloads))
        def execute(payload):
            barrier.wait(timeout=15)
            with SessionLocal() as db:
                try:
                    return {"status": 201, "body": warehouse_receipts.create_receipt(db, 4, payload, warehouse_user)}
                except HTTPException as exc:
                    assert exc.status_code == 409, (exc.status_code, exc.detail)
                    return {"status": 409}
        with ThreadPoolExecutor(max_workers=len(payloads)) as pool:
            return list(pool.map(execute, payloads))

    for changed in (False, True):
        key = "intake-changed" if changed else "intake-retry"
        first = WarehouseReceiptCreate(serial_no=key, material_name="铜钼", material_type="semi_finished",
            quantity=100, weight="10.000", notes="隔离入库并发验证", idempotency_key=key)
        second = first.model_copy(update={"quantity": 99}) if changed else first
        raced = intake_race([first, second])
        assert sorted(row["status"] for row in raced) == ([201, 409] if changed else [201, 201]), raced
        with SessionLocal() as db:
            assert db.scalar(sa.select(sa.func.count(MaterialTransfer.id)).where(MaterialTransfer.idempotency_key == key)) == 1
        if not changed:
            assert raced[0]["body"] == raced[1]["body"]
        results[key] = [row["status"] for row in raced]

    def external(lot, key, quantity=60):
        payload = stock.DispatchCreate(entry_kind="inspection_shipment", external_destination="并发测试客户",
            idempotency_key=key, lines=[{"source_transfer_id": lot["id"], "quantity": quantity, "weight": Decimal(quantity)/10}])
        return lambda db: stock.create_dispatch(db, 2, payload, users[2])

    for name, competitor in (("external_vs_internal", outgoing), ("external_vs_loss", lost), ("external_vs_external", external)):
        lot = received(name)
        raced = race(external(lot, name+'-a'), competitor(lot, name+'-b'))
        assert sorted(row['status'] for row in raced) == [201, 409], raced
        with SessionLocal.begin() as db:
            assert stock.available_locked(db, stock.lock_lot(db, lot['id'], 2)) == (40, Decimal('4.000'))
        results[name] = [row['status'] for row in raced]

    lot = received('duplicate-external')
    operation = external(lot, 'duplicate-external', 100)
    raced = race(operation, operation)
    assert [row['status'] for row in raced] == [201, 201] and raced[0]['body'] == raced[1]['body'], raced
    results['duplicate_external'] = [row['status'] for row in raced]
    line = raced[0]['body']['items'][0]
    payload = MaterialTransferConfirm(idempotency_key='confirm-external', expected_version=line['version'])
    operation = lambda db: workflow.confirm_outbound(db, line['batch_no'], payload, users[2])
    raced = race(operation, operation)
    assert [row['status'] for row in raced] == [201, 201] and raced[0]['body'] == raced[1]['body'], raced
    results['duplicate_external_confirmation'] = [row['status'] for row in raced]
    assert raced[0]['body']['received_at'] is None and raced[0]['body']['dispatched_at'] is not None
    with SessionLocal() as db:
        assert stock.list_dispatches(db, 2, users[2], status='dispatched', entry_kind='inspection_shipment')['total'] == 1
        table = stock.stock_table(2)
        balance = db.execute(sa.select(table).where(table.c.transfer_id == lot['id'])).mappings().one()
        assert balance['available_quantity'] == balance['on_hand_quantity'] == 0
        assert balance['reserved_quantity'] == 0 and balance['dispatched_quantity'] == 100
        assert db.scalar(sa.select(sa.func.count(MaterialTransfer.id)).where(MaterialTransfer.source_transfer_id == lot['id'])) == 1

    lot = received('confirm-vs-void')
    with SessionLocal() as db:
        line = external(lot, 'confirm-vs-void', 100)(db)['items'][0]
    raced = race(
        lambda db: workflow.confirm_outbound(db, line['batch_no'], MaterialTransferConfirm(idempotency_key='confirm-vs-void'), users[2]),
        lambda db: workflow.void_material_transfer(db, line['batch_no'], users[2]))
    assert sorted(row['status'] for row in raced) == [201, 409], raced
    results['external_confirm_vs_void'] = [row['status'] for row in raced]
    with SessionLocal.begin() as db:
        current = db.get(MaterialTransfer, line['id'])
        available = stock.available_locked(db, stock.lock_lot(db, lot['id'], 2))
        assert available == ((100, Decimal('10.000')) if current.status == 'voided' else (0, Decimal('0.000')))

    with SessionLocal() as db:
        receipt = warehouse_receipts.create_receipt(db, 4, WarehouseReceiptCreate(serial_no='warehouse-exit', material_name='铜钼',
            material_type='semi_finished', quantity=10, weight=1, notes='库房对外出库验证', idempotency_key='warehouse-exit'), warehouse_user)
    with SessionLocal() as db:
        line = stock.create_dispatch(db, 4, stock.DispatchCreate(entry_kind='warehouse_outbound', external_destination='外部仓库',
            idempotency_key='warehouse-outbound', lines=[{'source_transfer_id': receipt['id'], 'quantity': 10, 'weight': 1}]), warehouse_user)['items'][0]
    with SessionLocal() as db:
        done = workflow.confirm_outbound(db, line['batch_no'], MaterialTransferConfirm(idempotency_key='warehouse-outbound-confirm'), warehouse_user)
        assert done['status'] == 'dispatched' and done['next_team'] is None and not done['stock_tracked']
    def batch(key, *, lots=None, external=False, reverse=False):
        lots = lots or [received(key+'-lot-1'), received(key+'-lot-2')]
        fields = {'entry_kind': 'inspection_shipment', 'external_destination': '整批客户'} if external else {'next_team_id': 3}
        payload = stock.DispatchCreate(**fields, idempotency_key=key, lines=[
            {'source_transfer_id': lot['id'], 'quantity': 20, 'weight': Decimal('2.125')}
            for lot in (list(reversed(lots)) if reverse else lots)])
        with SessionLocal() as db:
            created = stock.create_dispatch(db, 2, payload, users[2])
            assert set(created) == {'items'}
            assert len({item['batch_no'] for item in created['items']}) == len(created['items'])
            # Deliberately construct an OLD CK record for legacy API concurrency checks.
            header = db.get(MaterialDispatch, db.get(MaterialTransfer, created['items'][0]['id']).dispatch_id)
            assert header.dispatch_no is None
            header.dispatch_no = f'CK-LEGACY-{header.id}'
            db.commit()
            return stock.dispatch_dict(db, header, users[2])

    independent_lots = [received('independent-1'), received('independent-2')]
    independent_payload = stock.DispatchCreate(next_team_id=3, idempotency_key='independent-pair', lines=[
        {'source_transfer_id': lot['id'], 'quantity': 20, 'weight': 2} for lot in independent_lots])
    with SessionLocal() as db:
        independent = stock.create_dispatch(db, 2, independent_payload, users[2])
        assert set(independent) == {'items'} and len(independent['items']) == 2
        assert all(item['dispatch_no'] is None for item in independent['items'])
        assert stock.create_dispatch(db, 2, independent_payload, users[2]) == independent
    first, second = independent['items']
    with SessionLocal() as db:
        workflow.confirm_material_transfer(db, first['batch_no'], MaterialTransferConfirm(idempotency_key='independent-receive'), users[3])
        assert db.get(MaterialTransfer, second['id']).status == 'pending'
    with SessionLocal() as db:
        workflow.update_material_transfer(db, second['batch_no'], MaterialTransferUpdate(quantity=25, weight=Decimal('2.500'), expected_version=second['version']), users[2])
        assert stock.list_outbound_batches(db, 2, users[2], record_filters=RecordFilters(), query='independent-', status='pending')['total'] == 1
    with SessionLocal.begin() as db:
        assert stock.available_locked(db, stock.lock_lot(db, independent_lots[0]['id'], 2)) == (80, Decimal('8.000'))
        assert stock.available_locked(db, stock.lock_lot(db, independent_lots[1]['id'], 2)) == (75, Decimal('7.500'))
    results['independent_receive_edit_and_retry'] = 'passed'

    def batch_confirm(group, key, *, external=False):
        payload = batches.DispatchConfirm(idempotency_key=key, expected_revision=group['revision'])
        return lambda db: batches.confirm_dispatch(db, group['dispatch_no'], payload, users[2 if external else 3], external=external)

    for external in (False, True):
        name = 'duplicate_batch_' + ('outbound' if external else 'receipt')
        group = batch(name, external=external)
        operation = batch_confirm(group, name+'-confirm', external=external)
        raced = race(operation, operation)
        assert [row['status'] for row in raced] == [201, 201] and raced[0]['body'] == raced[1]['body'], raced
        done = raced[0]['body']
        assert done['locked'] and done['pending_line_count'] == 0
        assert all(len(item['history']) == 2 for item in done['items'])
        with SessionLocal() as db:
            assert batches.get_dispatch(db, group['dispatch_no'], users[2 if external else 3]) == done
        results[name] = [row['status'] for row in raced]

    for mutation in ('edit', 'void'):
        name = 'batch_confirmation_vs_' + mutation
        group = batch(name)
        line = group['items'][0]
        if mutation == 'edit':
            competitor = lambda db: workflow.update_material_transfer(db, line['batch_no'],
                MaterialTransferUpdate(quantity=21, expected_version=line['version']), users[2])
        else:
            competitor = lambda db: workflow.void_material_transfer(db, line['batch_no'], users[2])
        raced = race(batch_confirm(group, name+'-confirm'), competitor)
        assert sorted(row['status'] for row in raced) == [201, 409], raced
        with SessionLocal() as db:
            current = batches.get_dispatch(db, group['dispatch_no'], users[3])
        if raced[0]['status'] == 201:
            assert all(item['status'] == 'received' for item in current['items'])
        else:
            assert current['confirmed_at'] is None and current['items'][1]['status'] == 'pending'
        results[name] = [row['status'] for row in raced]

    lots = [received('overlap-1'), received('overlap-2')]
    groups = [batch('overlap-group-1', lots=lots), batch('overlap-group-2', lots=lots, reverse=True)]
    raced = race(*(batch_confirm(group, f'overlap-confirm-{i}') for i, group in enumerate(groups)))
    assert [row['status'] for row in raced] == [201, 201], raced
    with SessionLocal.begin() as db:
        for lot in lots:
            assert stock.available_locked(db, stock.lock_lot(db, lot['id'], 2)) == (60, Decimal('5.750'))
    results['overlapping_batch_confirmations_reverse_input'] = [row['status'] for row in raced]

    groups = [batch('same-key-group-1'), batch('same-key-group-2')]
    raced = race(*(batch_confirm(group, 'shared-group-confirm') for group in groups))
    assert sorted(row['status'] for row in raced) == [201, 409], raced
    for group, result in zip(groups, raced):
        with SessionLocal() as db:
            current = batches.get_dispatch(db, group['dispatch_no'], users[3])
            assert all(item['status'] == ('received' if result['status'] == 201 else 'pending') for item in current['items'])
    results['same_confirmation_key_different_batches'] = [row['status'] for row in raced]

    group = batch('stale-create-replay-header')
    with SessionLocal() as stale_db:
        stale_header = stale_db.scalar(sa.select(MaterialDispatch).where(MaterialDispatch.dispatch_no == group['dispatch_no']))
        assert stale_header.confirmed_at is None
        with SessionLocal() as writer:
            done = batch_confirm(group, 'stale-create-replay-confirm')(writer)
        replay = stock.dispatch_dict(stale_db, stale_header, users[3])
        assert replay['status'] == 'received' and replay['confirmed_at'] == done['confirmed_at']
        assert replay['confirmed_by'] == done['confirmed_by'] and replay['revision'] == done['revision']

    from app.warehouse_inventory import WarehouseInventoryFilters, list_inventory, list_group_sources
    with SessionLocal() as db:
        groups = list_inventory(db, 4, WarehouseInventoryFilters(page_size=100))
        assert groups['total'] == len(groups['items'])
        summary = stock.overview(db, 4)
        assert sum(row['on_hand_quantity'] for row in groups['items']) == summary['totals']['on_hand_quantity']
        for row in groups['items']:
            sources = list_group_sources(db, 4, row['group_id'], warehouse_user, page_size=100)
            assert sum(item['on_hand_quantity'] for item in sources['items']) == row['on_hand_quantity']
        for filters in ({'receipt_source':'external'}, {'material_type':'scrap_chips'}, {'search_field':'source','query':'外部'},
                        {'search_field':'on_hand_quantity','query':'1','search_operator':'gte'}, {'date_from':'2026-01-01'},
                        {'search_field':'customer_code','query':'test'}):
            list_inventory(db, 4, WarehouseInventoryFilters(**filters))
    results['mysql_warehouse_grouping_filters_and_sources'] = 'passed'

    print(json.dumps({"mysql_version": version, "isolation": isolation,
        "legacy_preserved": True, "repeat_migration": True, "indexes_and_foreign_keys": True,
        "atomic_rollback": True, "mysql_grouped_queries": True, "current_header_replay": True,
        "concurrent_results": results}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    run()
