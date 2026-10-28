"""Team-owned batch quantities and processing periods; preserve old commitments."""

import sqlalchemy as sa
from alembic import op

revision = "20261027_0058"
down_revision = "20261027_0057"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if "production_schedule_batches" not in sa.inspect(bind).get_table_names():
        op.create_table(
            "production_schedule_batches",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "schedule_id",
                sa.Integer(),
                sa.ForeignKey("production_schedules.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("batch_number", sa.Integer(), nullable=False),
            sa.Column("planned_start_at", sa.DateTime(), nullable=False),
            sa.Column("due_at", sa.DateTime(), nullable=False),
            sa.Column("target_quantity", sa.Integer()),
            sa.Column("target_weight", sa.Numeric(17, 6)),
            sa.Column("upstream_batch_ids", sa.JSON(), nullable=False),
            sa.CheckConstraint("batch_number > 0", name="ck_psb_number"),
            sa.CheckConstraint("planned_start_at < due_at", name="ck_psb_period"),
            sa.CheckConstraint(
                "(target_quantity IS NULL OR target_quantity > 0) AND (target_weight IS NULL OR target_weight > 0) AND (target_quantity IS NOT NULL OR target_weight IS NOT NULL)",
                name="ck_psb_target",
            ),
        )
        op.create_index(
            "ix_production_schedule_batches_schedule_id",
            "production_schedule_batches",
            ["schedule_id"],
        )
    if "schedule_batch_id" not in {
        c["name"] for c in sa.inspect(bind).get_columns("production_schedule_deliveries")
    }:
        with op.batch_alter_table("production_schedule_deliveries") as batch:
            batch.add_column(sa.Column("schedule_batch_id", sa.Integer(), nullable=True))
            batch.create_foreign_key(
                "fk_psd_batch",
                "production_schedule_batches",
                ["schedule_batch_id"],
                ["id"],
                ondelete="RESTRICT",
            )
            batch.create_index(
                "ix_production_schedule_deliveries_schedule_batch_id", ["schedule_batch_id"]
            )


def downgrade():
    if op.get_bind().scalar(sa.text("SELECT count(*) FROM production_schedule_batches")):
        raise RuntimeError("已有班组分批排期，不能删除计划记录")
    with op.batch_alter_table("production_schedule_deliveries") as batch:
        batch.drop_index("ix_production_schedule_deliveries_schedule_batch_id")
        batch.drop_constraint("fk_psd_batch", type_="foreignkey")
        batch.drop_column("schedule_batch_id")
    op.drop_table("production_schedule_batches")
