"""Fresh installations already contain columns from current ORM metadata."""

import importlib.util
from pathlib import Path

import pytest
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from app.database import Base
from sqlalchemy import create_engine, inspect


@pytest.mark.parametrize(
    ("filename", "tables"),
    [
        (
            "20261104_0066_shared_dispatch_routes.py",
            ["shared_material_groups", "shared_material_members"],
        ),
        ("20261105_0069_unified_team_tasks.py", ["team_processing_tasks"]),
    ],
)
def test_upgrade_accepts_current_metadata_without_duplicate_constraints(filename, tables):
    path = Path(__file__).parents[1] / "alembic/versions" / filename
    spec = importlib.util.spec_from_file_location("current_schema_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            Base.metadata.create_all(connection)

            def schema():
                inspector = inspect(connection)
                return {
                    table: {
                        "columns": sorted(c["name"] for c in inspector.get_columns(table)),
                        "foreign_keys": inspector.get_foreign_keys(table),
                        "unique": inspector.get_unique_constraints(table),
                    }
                    for table in tables
                }

            original = schema()
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
                migration.upgrade()
            assert schema() == original
            # ORM-created SQLite constraints may be unnamed. Downgrade must
            # also work for a fresh installation, not only a legacy upgrade.
            with Operations.context(MigrationContext.configure(connection)):
                migration.downgrade()
                migration.upgrade()
            rebuilt = schema()
            for table in tables:
                assert rebuilt[table]["columns"] == original[table]["columns"]
                assert len(rebuilt[table]["foreign_keys"]) == len(original[table]["foreign_keys"])
                assert len(rebuilt[table]["unique"]) == len(original[table]["unique"])
    finally:
        engine.dispose()
