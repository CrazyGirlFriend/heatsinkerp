"""Record rework submitters and durable team messages."""

import sqlalchemy as sa
from alembic import op

revision = "20261026_0055"
down_revision = "20261025_0054"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("process_routes") as batch:
        batch.add_column(sa.Column("requesting_team_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("requesting_team_name", sa.String(80), nullable=True))
        batch.add_column(sa.Column("requested_by", sa.String(80), nullable=True))
        batch.create_foreign_key(
            "fk_pr_requesting_team", "teams", ["requesting_team_id"], ["id"], ondelete="RESTRICT"
        )
    op.create_table(
        "rework_notices",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "team_id", sa.Integer(), sa.ForeignKey("teams.id", ondelete="RESTRICT"), nullable=False
        ),
        sa.Column(
            "route_id",
            sa.Integer(),
            sa.ForeignKey("process_routes.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("read_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("team_id", "route_id", "kind", name="uq_rework_notice_delivery"),
    )
    op.create_index("ix_rework_notices_team_read", "rework_notices", ["team_id", "read_at", "id"])


def downgrade():
    op.drop_table("rework_notices")
    with op.batch_alter_table("process_routes") as batch:
        batch.drop_constraint("fk_pr_requesting_team", type_="foreignkey")
        batch.drop_column("requested_by")
        batch.drop_column("requesting_team_name")
        batch.drop_column("requesting_team_id")
