"""Record the operator's quality result on the processing record."""

import sqlalchemy as sa
from alembic import op

revision = "20261120_0077"
down_revision = "20261119_0076"
branch_labels = None
depends_on = None


def upgrade():
    table = "material_quantity_adjustments"
    existing = {col["name"] for col in sa.inspect(op.get_bind()).get_columns(table)}
    for column in (
        sa.Column("failed_quantity", sa.Integer()),
        sa.Column("failed_weight", sa.Numeric(17, 6)),
        sa.Column("failure_reason", sa.Text()),
    ):
        if column.name not in existing:
            op.add_column(table, column)


def downgrade():
    for name in ("failure_reason", "failed_weight", "failed_quantity"):
        op.drop_column("material_quantity_adjustments", name)
