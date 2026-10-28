"""Keep the order spreadsheet with its engineering version."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.mysql import LONGBLOB

revision = "20261028_0060"
down_revision = "20261027_0059"
branch_labels = None
depends_on = None


def upgrade():
    if sa.inspect(op.get_bind()).has_table("process_route_order_files"):
        return
    op.create_table(
        "process_route_order_files",
        sa.Column("route_id", sa.Integer(), primary_key=True),
        sa.Column("filename", sa.String(240), nullable=False),
        sa.Column("content", sa.LargeBinary().with_variant(LONGBLOB(), "mysql"), nullable=False),
        sa.ForeignKeyConstraint(["route_id"], ["process_routes.id"], ondelete="RESTRICT"),
    )


def downgrade():
    raise RuntimeError("订单原件须保留，请通过备份恢复回退")
