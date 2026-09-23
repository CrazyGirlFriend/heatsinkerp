import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from app.models import NotificationOutbox
from sqlalchemy import create_engine, inspect, text


@pytest.mark.parametrize("existing", [False, True])
def test_outbox_migration_is_repeatable_and_preserves_pending_messages(existing):
    file = Path(__file__).parents[1] / "alembic/versions/20260923_0018_notification_outbox.py"
    spec = importlib.util.spec_from_file_location("outbox_migration", file)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            if existing:
                NotificationOutbox.__table__.create(connection)
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
                connection.execute(
                    text(
                        "INSERT INTO notification_outbox "
                        "(id, payload, created_at, available_at, attempts) VALUES "
                        "('pending', '{}', '2026-09-23', '2026-09-23', 0)"
                    )
                )
                migration.upgrade()
            assert (
                connection.scalar(
                    text("SELECT COUNT(*) FROM notification_outbox WHERE published_at IS NULL")
                )
                == 1
            )
            indexes = inspect(connection).get_indexes("notification_outbox")
            assert next(
                index for index in indexes if index["name"] == "ix_notification_outbox_ready"
            )["column_names"] == ["published_at", "available_at", "lease_until", "created_at"]
    finally:
        engine.dispose()
