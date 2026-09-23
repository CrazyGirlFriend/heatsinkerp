"""Durable notification outbox; existing business rows are unchanged."""

import sqlalchemy as sa
from alembic import op

revision = "20260923_0018"
down_revision = "20260923_0017"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    if "notification_outbox" not in sa.inspect(connection).get_table_names():
        op.create_table(
            "notification_outbox",
            sa.Column("id", sa.String(32), primary_key=True),
            sa.Column("payload", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("available_at", sa.DateTime(), nullable=False),
            sa.Column("attempts", sa.Integer(), nullable=False),
            sa.Column("lease_owner", sa.String(64)),
            sa.Column("lease_until", sa.DateTime()),
            sa.Column("published_at", sa.DateTime()),
            sa.Column("last_error", sa.String(80)),
            sa.CheckConstraint("attempts >= 0", name="ck_notification_outbox_attempts"),
        )
    expected = ["published_at", "available_at", "lease_until", "created_at"]
    indexes = {
        index["name"]: index["column_names"]
        for index in sa.inspect(connection).get_indexes("notification_outbox")
    }
    if "ix_notification_outbox_ready" not in indexes:
        op.create_index("ix_notification_outbox_ready", "notification_outbox", expected)
    elif indexes["ix_notification_outbox_ready"] != expected:
        raise RuntimeError("Unexpected notification index; inspect before retrying")


def downgrade():
    raise RuntimeError("Preserve undelivered messages; restore a verified matching backup")
