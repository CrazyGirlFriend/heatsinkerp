"""Keep the source withdrawals of a pooled warehouse feeding."""

import sqlalchemy as sa
from alembic import op

revision = "20261121_pooled_feeding"
down_revision = "20261121_joint_feeding"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    if "pooled_feeding" not in {c["name"] for c in inspector.get_columns("material_transfers")}:
        op.add_column(
            "material_transfers",
            sa.Column("pooled_feeding", sa.Boolean(), nullable=False, server_default="0"),
        )
    if not inspector.has_table("warehouse_feeding_sources"):
        op.create_table(
            "warehouse_feeding_sources",
            sa.Column(
                "transfer_id",
                sa.Integer(),
                sa.ForeignKey("material_transfers.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column(
                "source_transfer_id",
                sa.Integer(),
                sa.ForeignKey("material_transfers.id", ondelete="RESTRICT"),
                primary_key=True,
            ),
            sa.Column("quantity", sa.Integer(), nullable=False),
            sa.Column("weight", sa.Numeric(17, 6), nullable=False),
        )
        op.create_index(
            "ix_warehouse_feeding_sources_source_transfer_id",
            "warehouse_feeding_sources",
            ["source_transfer_id"],
        )


def downgrade():
    if op.get_bind().scalar(sa.text("SELECT COUNT(*) FROM warehouse_feeding_sources")):
        raise RuntimeError(
            "Cannot remove the source allocations of existing pooled warehouse batches"
        )
    op.drop_table("warehouse_feeding_sources")
    op.drop_column("material_transfers", "pooled_feeding")
