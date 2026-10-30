"""Independent rework message receipts for the unified inbox."""

import sqlalchemy as sa
from alembic import op

revision = "20261029_0061"
down_revision = "20261028_0060"
branch_labels = None
depends_on = None


def upgrade():
    if "rework_notice_reads" not in sa.inspect(op.get_bind()).get_table_names():
        op.create_table(
            "rework_notice_reads",
            sa.Column(
                "user_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column(
                "notice_id",
                sa.Integer(),
                sa.ForeignKey("rework_notices.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column("read_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_rnr_notice", "rework_notice_reads", ["notice_id"])
    # Legacy shared read_at cannot identify a reader. Do not guess account receipts.


def downgrade():
    if op.get_bind().scalar(sa.text("SELECT count(*) FROM rework_notice_reads")):
        raise RuntimeError("已有个人返工消息已读记录，不能删除")
    op.drop_table("rework_notice_reads")
