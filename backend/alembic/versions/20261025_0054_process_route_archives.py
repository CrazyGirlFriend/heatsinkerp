"""Keep reconciled duplicates readable without listing them as current engineering."""

import sqlalchemy as sa
from alembic import op

revision = "20261025_0054"
down_revision = "20261025_0053"
branch_labels = None
depends_on = None


def upgrade():
    if not sa.inspect(op.get_bind()).has_table("process_route_archives"):
        op.create_table(
            "process_route_archives",
            sa.Column(
                "route_id",
                sa.Integer(),
                sa.ForeignKey("process_routes.id", ondelete="RESTRICT"),
                primary_key=True,
            ),
            sa.Column(
                "current_route_id",
                sa.Integer(),
                sa.ForeignKey("process_routes.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index(
            "ix_process_route_archives_current_route_id",
            "process_route_archives",
            ["current_route_id"],
        )


def downgrade():
    op.drop_index("ix_process_route_archives_current_route_id", table_name="process_route_archives")
    op.drop_table("process_route_archives")
