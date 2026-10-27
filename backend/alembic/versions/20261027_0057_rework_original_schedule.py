"""Rework retains the original delivery commitment, with no extra target."""

import sqlalchemy as sa
from alembic import op

revision = "20261027_0057"
down_revision = "20261026_0056"
branch_labels = None
depends_on = None


def upgrade():
    if "original_schedule_id" in {
        c["name"] for c in sa.inspect(op.get_bind()).get_columns("process_routes")
    }:
        return
    with op.batch_alter_table("process_routes") as batch:
        batch.add_column(sa.Column("original_schedule_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_pr_original_schedule",
            "production_schedules",
            ["original_schedule_id"],
            ["id"],
            ondelete="RESTRICT",
        )
        batch.create_index("ix_process_routes_original_schedule_id", ["original_schedule_id"])


def downgrade():
    if op.get_bind().scalar(
        sa.text("SELECT count(*) FROM process_routes WHERE original_schedule_id IS NOT NULL")
    ):
        raise RuntimeError("已有返工排期关联，不能删除关联记录")
    with op.batch_alter_table("process_routes") as batch:
        batch.drop_index("ix_process_routes_original_schedule_id")
        batch.drop_constraint("fk_pr_original_schedule", type_="foreignkey")
        batch.drop_column("original_schedule_id")
