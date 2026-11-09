"""Quality issue notifications and independent account receipts."""

import sqlalchemy as sa
from alembic import op

revision = "20261109_0070"
down_revision = "20261105_0069"
branch_labels = None
depends_on = None


def upgrade():
    existing = sa.inspect(op.get_bind()).get_table_names()
    if "quality_notices" not in existing:
        op.create_table(
            "quality_notices",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("event_key", sa.String(160), nullable=False, unique=True),
            sa.Column(
                "inspection_id",
                sa.Integer(),
                sa.ForeignKey("material_inspections.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column(
                "team_id",
                sa.Integer(),
                sa.ForeignKey("teams.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("kind", sa.String(32), nullable=False),
            sa.Column("message", sa.String(300), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_qn_team_id", "quality_notices", ["team_id", "id"])
    if "quality_notice_reads" not in existing:
        op.create_table(
            "quality_notice_reads",
            sa.Column(
                "user_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column(
                "notice_id",
                sa.Integer(),
                sa.ForeignKey("quality_notices.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column("read_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_qnr_notice", "quality_notice_reads", ["notice_id"])


def downgrade():
    if op.get_bind().scalar(sa.text("SELECT count(*) FROM quality_notices")):
        raise RuntimeError("已有质量通知，不能删除")
    op.drop_table("quality_notice_reads")
    op.drop_table("quality_notices")
