"""Retain administrative history independently of deleted accounts and teams."""

import sqlalchemy as sa
from alembic import op

revision = "20260920_0016"
down_revision = "20260918_0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Initial installations already create current metadata in migration 0001.
    schema = sa.inspect(op.get_bind())
    if "admin_audit_events" not in schema.get_table_names():
        op.create_table(
            "admin_audit_events",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("actor_user_id", sa.Integer(), nullable=False),
            sa.Column("actor", sa.String(80), nullable=False),
            sa.Column("target_type", sa.String(16), nullable=False),
            sa.Column("target_id", sa.Integer(), nullable=False),
            sa.Column("action", sa.String(16), nullable=False),
            sa.Column("request_id", sa.String(32)),
            sa.Column("changes", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
    expected = {
        "id",
        "actor_user_id",
        "actor",
        "target_type",
        "target_id",
        "action",
        "request_id",
        "changes",
        "created_at",
    }
    if not expected <= {column["name"] for column in schema.get_columns("admin_audit_events")}:
        raise RuntimeError("Unexpected administrative audit table; inspect schema before retrying")
    indexes = {
        index["name"]: index["column_names"] for index in schema.get_indexes("admin_audit_events")
    }
    fields = ["target_type", "target_id", "id"]
    if "ix_admin_audit_target" not in indexes:
        # MySQL DDL can commit the table before an interrupted index creation.
        op.create_index("ix_admin_audit_target", "admin_audit_events", fields)
    elif indexes["ix_admin_audit_target"] != fields:
        raise RuntimeError("Unexpected administrative audit index; inspect schema before retrying")


def downgrade() -> None:
    raise RuntimeError("Restore a verified backup; administrative audit history must be preserved.")
