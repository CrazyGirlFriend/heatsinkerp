"""Keep original drawing files within each process-route version."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.mysql import LONGBLOB

revision = "20261024_0050"
down_revision = "20261024_0049"
branch_labels = None
depends_on = None


def upgrade():
    if sa.inspect(op.get_bind()).has_table("process_route_drawings"):
        return
    op.create_table(
        "process_route_drawings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("route_id", sa.Integer(), nullable=False),
        sa.Column("filename", sa.String(240), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("content", sa.LargeBinary().with_variant(LONGBLOB(), "mysql"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["route_id"], ["process_routes.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("route_id", "sha256", name="uq_process_route_drawing"),
    )
    op.create_index("ix_process_route_drawings_route_id", "process_route_drawings", ["route_id"])


def downgrade():
    raise RuntimeError("图纸原件不可直接删除，请通过备份恢复回退")
