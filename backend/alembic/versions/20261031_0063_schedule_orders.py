"""Keep the dispatch order spreadsheet with its scheduling task."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.mysql import LONGBLOB

revision = "20261031_0063"
down_revision = "20261030_0062"
branch_labels = None
depends_on = None


def upgrade():
    if sa.inspect(op.get_bind()).has_table("production_schedule_order_files"):
        return
    op.create_table(
        "production_schedule_order_files",
        sa.Column("task_id", sa.Integer(), primary_key=True),
        sa.Column("filename", sa.String(240), nullable=False),
        sa.Column("content", sa.LargeBinary().with_variant(LONGBLOB(), "mysql"), nullable=False),
        sa.Column("document", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["production_schedule_tasks.id"], ondelete="RESTRICT"),
    )


def downgrade():
    raise RuntimeError("订单原件须保留，请通过备份恢复回退")
