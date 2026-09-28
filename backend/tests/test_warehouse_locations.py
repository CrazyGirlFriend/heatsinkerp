"""Warehouse locations are receiving-batch metadata, not inherited material properties."""
import importlib.util
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

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


def location(client, setup, name, *, headers=None):
    items = client.get('/api/warehouse-locations', params={'query': name}).json()['items']
    slot = next((item for item in items if item['name'] == name), None)
    if slot is None:
        response = client.post('/api/warehouse-locations', json={'name': name})
        assert response.status_code == 201, response.text
        slot = response.json()
    key = uuid4().hex
    response = client.post(f"/api/warehouse-locations/{slot['id']}/reservation",
        headers=headers or setup['headers'], json={'key': key})
    assert response.status_code == 200, response.text
    return {'warehouse_location': name, 'warehouse_location_reservation_key': key}


def test_intake_location_persists_in_detail_stock_audit_and_retry(client, warehouse):
    selected = location(client, warehouse, 'A区-01')
    response = intake(client, warehouse, **{**selected, 'warehouse_location': ' A区-01 '})
    assert response.status_code == 201, response.text
    row = response.json()
    assert row['warehouse_location'] == 'A区-01'
    assert row['history'][0]['changes']['warehouse_location']['after'] == 'A区-01'
    assert intake(client, warehouse, **selected).json() == row
    assert intake(client, warehouse, **location(client, warehouse, 'A区-02')).status_code == 409
    base = f"/api/team-materials/{warehouse['team']['id']}"
    for suffix in ('/receipts', '/stock'):
        result = client.get(base + suffix, params={'query': 'A区-01'}).json()
        assert result['total'] == 1
        item = result['items'][0]
        assert item.get('transfer', item)['warehouse_location'] == 'A区-01'
    assert intake(client, warehouse, idempotency_key='blank', warehouse_location=' ').json()['warehouse_location'] is None
    assert intake(client, warehouse, idempotency_key='long', warehouse_location='A' * 81).status_code == 422


def test_internal_warehouse_receipt_sets_its_own_location_and_replay_is_checked(client, warehouse):
    origin = intake(client, warehouse, **location(client, warehouse, 'A-01')).json()
    outgoing = dispatch(client, warehouse, origin, 'out')
    assert outgoing['warehouse_location'] is None
    url = f"/api/material-transfers/{outgoing['batch_no']}/confirm"
    assert client.post(url, headers=warehouse['other_headers'], json={
        'idempotency_key': 'received-other', 'warehouse_location': 'A-02'}).status_code == 422
    assert client.post(url, headers=warehouse['other_headers'], json={'idempotency_key': 'received-other'}).status_code == 200
    returning = dispatch(client, warehouse, outgoing, 'return', returning=True)
    url = f"/api/material-transfers/{returning['batch_no']}/confirm"
    payload = {'idempotency_key': 'received-back', 'expected_version': 1, **location(client, warehouse, 'B-02')}
    assert client.post(url, json=payload).status_code == 403
    result = client.post(url, headers=warehouse['headers'], json=payload)
    assert result.status_code == 200, result.text
    assert result.json()['warehouse_location'] == 'B-02'
    assert result.json()['history'][-1]['changes']['warehouse_location']['after'] == 'B-02'
    assert client.post(url, headers=warehouse['headers'], json=payload).json() == result.json()
    assert client.post(url, headers=warehouse['headers'], json={**payload, 'warehouse_location': 'B-03'}).status_code == 409


def test_choices_offer_slot_freed_by_internal_outgoing(client, warehouse):
    base = f"/api/team-materials/{warehouse['team']['id']}/warehouse-locations"
    selected = location(client, warehouse, 'A-busy')
    origin = intake(client, warehouse, **selected).json()
    free = client.post('/api/warehouse-locations', json={'name': 'B-free'}).json()
    dispatch(client, warehouse, origin, 'all-pending')
    assert [item['name'] for item in client.get(base).json()['items']] == ['A-busy', 'B-free']
    assert client.get(base, params={'query': 'B-fr', 'limit': 1}).json()['items'][0]['id'] == free['id']
    assert client.get(base, params={'query': '%'}).json()['items'] == []
    assert intake(client, warehouse, idempotency_key='shared', **selected).status_code == 409
    assert intake(client, warehouse, idempotency_key='unknown', warehouse_location='随便输入').status_code == 422
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


def test_managed_locations_migration_seeds_unique_names_without_rewriting_history():
    file = Path(__file__).parents[1] / 'alembic/versions/20260928_0023_warehouse_locations.py'
    spec = importlib.util.spec_from_file_location('managed_locations_migration', file)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine('sqlite://')
    with engine.begin() as connection:
        connection.execute(text('CREATE TABLE teams (id INTEGER PRIMARY KEY, code VARCHAR(80))'))
        connection.execute(text('CREATE TABLE users (id INTEGER PRIMARY KEY)'))
        connection.execute(text('CREATE TABLE material_transfers (id INTEGER PRIMARY KEY, next_team_id INTEGER, warehouse_location VARCHAR(80))'))
        connection.execute(text("INSERT INTO teams VALUES (1,'FACTORY-WAREHOUSE'),(2,'ROLL')"))
        connection.execute(text("INSERT INTO material_transfers VALUES (1,1,'A-01'),(2,1,'A-01'),(3,1,'B-01'),(4,1,NULL),(5,2,'OTHER')"))
        before = connection.execute(text('SELECT * FROM material_transfers')).all()
        with patch.object(migration, 'op', Operations(MigrationContext.configure(connection))):
            migration.upgrade()
            migration.upgrade()
        assert connection.execute(text('SELECT name FROM warehouse_locations ORDER BY name')).scalars().all() == ['A-01', 'B-01']
        assert connection.execute(text('SELECT * FROM material_transfers')).all() == before
    engine.dispose()
