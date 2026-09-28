"""Record the warehouse location on each receiving batch."""

import sqlalchemy as sa
from alembic import op

revision = "20260928_0022"
down_revision = "20260927_0021"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("material_transfers")}
    indexes = {index["name"] for index in inspector.get_indexes("material_transfers")}
    with op.batch_alter_table("material_transfers") as batch:
        if "warehouse_location" not in columns:
            batch.add_column(sa.Column("warehouse_location", sa.String(80), nullable=True))
        if "ix_mt_warehouse_location" not in indexes:
            batch.create_index("ix_mt_warehouse_location", ["next_team_id", "warehouse_location"])


def downgrade():
    raise RuntimeError("Retain recorded warehouse locations when rolling back application images")
