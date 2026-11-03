"""Supplemental documents can be added to an existing ledger without rewriting it."""

import importlib.util
from pathlib import Path

from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine, inspect, text


def test_receipt_document_migration_is_additive_and_repeatable(tmp_path):
    path = Path(__file__).parents[1] / "alembic/versions/20261103_0065_receipt_documents.py"
    spec = importlib.util.spec_from_file_location("receipt_document_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite:///" + str(tmp_path / "existing-ledger.sqlite"))
    try:
        with engine.begin() as connection:
            connection.execute(
                text("CREATE TABLE material_transfers (id INTEGER PRIMARY KEY, serial_no TEXT)")
            )
            connection.execute(text("CREATE TABLE teams (id INTEGER PRIMARY KEY)"))
            connection.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY)"))
            connection.execute(text("INSERT INTO material_transfers VALUES (1, 'KEEP-ORIGINAL')"))
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
                migration.upgrade()
            inspector = inspect(connection)
            assert inspector.has_table("warehouse_receipt_documents")
            assert len(inspector.get_foreign_keys("warehouse_receipt_documents")) == 3
            assert {
                index["name"] for index in inspector.get_indexes("warehouse_receipt_documents")
            } == {"ix_warehouse_receipt_documents_transfer_id", "ix_receipt_documents_owner"}
            assert (
                connection.scalar(text("SELECT serial_no FROM material_transfers WHERE id=1"))
                == "KEEP-ORIGINAL"
            )
    finally:
        engine.dispose()
