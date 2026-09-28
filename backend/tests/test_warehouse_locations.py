"""Warehouse locations are receiving-batch metadata, not inherited material properties."""
import importlib.util
from pathlib import Path
from unittest.mock import patch

from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine, inspect, text

from test_warehouse_receipts import warehouse, intake  # noqa: F401


def dispatch(client, setup, source, key, *, returning=False):
    team = setup['other'] if returning else setup['team']
    target = setup['team'] if returning else setup['other']
    response = client.post(f"/api/team-materials/{team['id']}/outbound-batches",
        headers=setup['other_headers'] if returning else setup['headers'], json={
            'next_team_id': target['id'], 'idempotency_key': key,
            'lines': [{'source_transfer_id': source['id'], 'quantity': source['quantity'], 'weight': source['weight']}],
        })
    assert response.status_code == 201, response.text
    return response.json()['items'][0]


def test_intake_location_persists_in_detail_stock_audit_and_retry(client, warehouse):
    response = intake(client, warehouse, warehouse_location=' A区-01 ')
    assert response.status_code == 201, response.text
    row = response.json()
    assert row['warehouse_location'] == 'A区-01'
    assert row['history'][0]['changes']['warehouse_location']['after'] == 'A区-01'
    assert intake(client, warehouse, warehouse_location='A区-01').json() == row
    assert intake(client, warehouse, warehouse_location='A区-02').status_code == 409
    base = f"/api/team-materials/{warehouse['team']['id']}"
    for suffix in ('/receipts', '/stock'):
        result = client.get(base + suffix, params={'query': 'A区-01'}).json()
        assert result['total'] == 1
        item = result['items'][0]
        assert item.get('transfer', item)['warehouse_location'] == 'A区-01'
    assert intake(client, warehouse, idempotency_key='blank', warehouse_location=' ').json()['warehouse_location'] is None
    assert intake(client, warehouse, idempotency_key='long', warehouse_location='A' * 81).status_code == 422


def test_internal_warehouse_receipt_sets_its_own_location_and_replay_is_checked(client, warehouse):
    origin = intake(client, warehouse, warehouse_location='A-01').json()
    outgoing = dispatch(client, warehouse, origin, 'out')
    assert outgoing['warehouse_location'] is None
    url = f"/api/material-transfers/{outgoing['batch_no']}/confirm"
    assert client.post(url, headers=warehouse['other_headers'], json={
        'idempotency_key': 'received-other', 'warehouse_location': 'A-02'}).status_code == 422
    assert client.post(url, headers=warehouse['other_headers'], json={'idempotency_key': 'received-other'}).status_code == 200
    returning = dispatch(client, warehouse, outgoing, 'return', returning=True)
    url = f"/api/material-transfers/{returning['batch_no']}/confirm"
    payload = {'idempotency_key': 'received-back', 'expected_version': 1, 'warehouse_location': 'B-02'}
    assert client.post(url, json=payload).status_code == 403
    result = client.post(url, headers=warehouse['headers'], json=payload)
    assert result.status_code == 200, result.text
    assert result.json()['warehouse_location'] == 'B-02'
    assert result.json()['history'][-1]['changes']['warehouse_location']['after'] == 'B-02'
    assert client.post(url, headers=warehouse['headers'], json=payload).json() == result.json()
    assert client.post(url, headers=warehouse['headers'], json={**payload, 'warehouse_location': 'B-03'}).status_code == 409


def test_locations_prioritize_physical_stock_and_allow_manual_new_names(client, warehouse):
    base = f"/api/team-materials/{warehouse['team']['id']}/warehouse-locations"
    origin = intake(client, warehouse, warehouse_location='A-empty').json()
    intake(client, warehouse, idempotency_key='occupied', warehouse_location='B-stock', quantity=0, weight=1)
    intake(client, warehouse, idempotency_key='same-slot', warehouse_location='B-stock')
    dispatch(client, warehouse, origin, 'all-pending')
    # Pending outbound remains owned, but is no longer physically in this slot.
    assert client.get(base).json()['items'] == [
        {'name': 'B-stock', 'has_stock': True}, {'name': 'A-empty', 'has_stock': False}]
    assert client.get(base, params={'query': 'B-st', 'limit': 1}).json()['items'] == [{'name': 'B-stock', 'has_stock': True}]
    assert client.get(base, params={'query': '%'}).json()['items'] == []
    assert client.get(f"/api/team-materials/{warehouse['other']['id']}/warehouse-locations").status_code == 403
    assert client.get(base, headers={'Authorization': ''}).status_code == 401


def test_location_migration_preserves_rows_and_is_repeatable():
    file = Path(__file__).parents[1] / 'alembic/versions/20260928_0022_warehouse_location.py'
    spec = importlib.util.spec_from_file_location('warehouse_location_migration', file)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine('sqlite://')
    with engine.begin() as connection:
        connection.execute(text('CREATE TABLE material_transfers (id INTEGER PRIMARY KEY, next_team_id INTEGER)'))
        connection.execute(text('INSERT INTO material_transfers VALUES (1, 1)'))
        with patch.object(migration, 'op', Operations(MigrationContext.configure(connection))):
            migration.upgrade()
            assert connection.execute(text('SELECT warehouse_location FROM material_transfers')).scalar() is None
            connection.execute(text("UPDATE material_transfers SET warehouse_location='A-01' WHERE id=1"))
            migration.upgrade()
        assert connection.execute(text('SELECT warehouse_location FROM material_transfers')).scalar() == 'A-01'
        assert 'ix_mt_warehouse_location' in {i['name'] for i in inspect(connection).get_indexes('material_transfers')}
    engine.dispose()
