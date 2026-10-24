"""Hourly team delivery commitments with explicit physical-batch fulfillment."""

import sqlalchemy as sa
from alembic import op

revision = "20261022_0044"
down_revision = "20261020_0043"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("production_schedules"):
        op.create_table(
            "production_schedules",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("serial_no", sa.String(80), nullable=False),
            sa.Column(
                "team_id",
                sa.Integer(),
                sa.ForeignKey("teams.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("next_team_id", sa.Integer(), sa.ForeignKey("teams.id", ondelete="RESTRICT")),
            sa.Column("external_destination", sa.String(240)),
            sa.Column(
                "predecessor_id",
                sa.Integer(),
                sa.ForeignKey("production_schedules.id", ondelete="RESTRICT"),
            ),
            sa.Column("sequence_no", sa.Integer(), nullable=False),
            sa.Column("due_at", sa.DateTime(), nullable=False),
            sa.Column("initial_due_at", sa.DateTime(), nullable=False),
            sa.Column("target_quantity", sa.Integer()),
            sa.Column("target_weight", sa.Numeric(17, 6)),
            sa.Column("notes", sa.Text()),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("cancelled_at", sa.DateTime()),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.Column("idempotency_key", sa.String(100), nullable=False, unique=True),
            sa.Column("request_hash", sa.String(64), nullable=False),
            sa.CheckConstraint("sequence_no > 0 AND version > 0", name="ck_ps_positive_revision"),
            sa.CheckConstraint(
                "(target_quantity IS NULL OR target_quantity > 0) AND "
                "(target_weight IS NULL OR target_weight > 0) AND "
                "(target_quantity IS NOT NULL OR target_weight IS NOT NULL)",
                name="ck_ps_target",
            ),
            sa.CheckConstraint(
                "(next_team_id IS NOT NULL AND external_destination IS NULL) OR "
                "(next_team_id IS NULL AND external_destination IS NOT NULL)",
                name="ck_ps_destination",
            ),
        )
        op.create_index(
            "ix_ps_team_due", "production_schedules", ["team_id", "cancelled_at", "due_at", "id"]
        )
        op.create_index("ix_ps_team_serial", "production_schedules", ["team_id", "serial_no", "id"])
        op.create_index("ix_ps_due", "production_schedules", ["due_at", "id"])
        op.create_index("ix_ps_serial_due", "production_schedules", ["serial_no", "due_at", "id"])
        op.create_index("ix_ps_predecessor", "production_schedules", ["predecessor_id"])
    if not inspector.has_table("production_schedule_sources"):
        op.create_table(
            "production_schedule_sources",
            sa.Column(
                "schedule_id",
                sa.Integer(),
                sa.ForeignKey("production_schedules.id", ondelete="RESTRICT"),
                primary_key=True,
            ),
            sa.Column(
                "source_transfer_id",
                sa.Integer(),
                sa.ForeignKey("material_transfers.id", ondelete="RESTRICT"),
                primary_key=True,
            ),
            sa.Column("quantity", sa.Integer()),
            sa.Column("weight", sa.Numeric(17, 6)),
            sa.CheckConstraint(
                "(quantity IS NULL OR quantity > 0) AND (weight IS NULL OR weight > 0) AND "
                "(quantity IS NOT NULL OR weight IS NOT NULL)",
                name="ck_pss_amount",
            ),
        )
        op.create_index(
            "ix_pss_source", "production_schedule_sources", ["source_transfer_id", "schedule_id"]
        )
    if not inspector.has_table("production_schedule_deliveries"):
        op.create_table(
            "production_schedule_deliveries",
            sa.Column(
                "transfer_id",
                sa.Integer(),
                sa.ForeignKey("material_transfers.id", ondelete="RESTRICT"),
                primary_key=True,
            ),
            sa.Column(
                "schedule_id",
                sa.Integer(),
                sa.ForeignKey("production_schedules.id", ondelete="RESTRICT"),
                nullable=False,
            ),
        )
        op.create_index(
            "ix_production_schedule_deliveries_schedule_id",
            "production_schedule_deliveries",
            ["schedule_id"],
        )
    if not inspector.has_table("production_schedule_events"):
        op.create_table(
            "production_schedule_events",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "schedule_id",
                sa.Integer(),
                sa.ForeignKey("production_schedules.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("action", sa.String(24), nullable=False),
            sa.Column("actor", sa.String(80), nullable=False),
            sa.Column("actor_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
            sa.Column("before", sa.JSON()),
            sa.Column("after", sa.JSON(), nullable=False),
            sa.Column("occurred_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_pse_schedule", "production_schedule_events", ["schedule_id", "id"])


def downgrade():
    raise RuntimeError("Preserve delivery commitments and fulfillment audit on rollback")
