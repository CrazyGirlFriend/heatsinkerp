"""Schedule inbox and per-account read receipts."""

import sqlalchemy as sa
from alembic import op

revision = "20261027_0059"
down_revision = "20261027_0058"
branch_labels = None
depends_on = None


def upgrade():
    tables = sa.inspect(op.get_bind()).get_table_names()
    if "schedule_notices" not in tables:
        op.create_table(
            "schedule_notices",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("event_key", sa.String(160), nullable=False, unique=True),
            sa.Column(
                "schedule_id",
                sa.Integer(),
                sa.ForeignKey("production_schedules.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column(
                "team_id",
                sa.Integer(),
                sa.ForeignKey("teams.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("kind", sa.String(24), nullable=False),
            sa.Column("message", sa.String(300), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_sn_team_id", "schedule_notices", ["team_id", "id"])
    if "schedule_notice_reads" not in tables:
        op.create_table(
            "schedule_notice_reads",
            sa.Column(
                "user_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column(
                "notice_id",
                sa.Integer(),
                sa.ForeignKey("schedule_notices.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column("read_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_snr_notice", "schedule_notice_reads", ["notice_id"])


def downgrade():
    if op.get_bind().scalar(sa.text("SELECT count(*) FROM schedule_notices")):
        raise RuntimeError("已有排期消息，不能删除通知记录")
    op.drop_table("schedule_notice_reads")
    op.drop_table("schedule_notices")
