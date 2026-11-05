"""Allow handover-only plans without inventing a first-operation start."""

import sqlalchemy as sa
from alembic import op

revision = "20261105_0067"
down_revision = "20261104_0066"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("production_schedule_batches") as batch:
        batch.alter_column("planned_start_at", existing_type=sa.DateTime(), nullable=True)


def downgrade():
    if op.get_bind().scalar(
        sa.text("SELECT count(*) FROM production_schedule_batches WHERE planned_start_at IS NULL")
    ):
        raise RuntimeError("已有仅填写转交时间的排期，不能恢复必填开始时间")
    with op.batch_alter_table("production_schedule_batches") as batch:
        batch.alter_column("planned_start_at", existing_type=sa.DateTime(), nullable=False)
