"""QC dispositions, original daily reports and outsourced batch provenance."""

import sqlalchemy as sa
from alembic import op

revision = "20261119_0076"
down_revision = "20261117_0075"
branch_labels = None
depends_on = None


def upgrade():
    # The initial migration creates current model tables on a fresh installation.
    inspector = sa.inspect(op.get_bind())
    for table, column in (
        (
            "material_transfers",
            sa.Column("is_outsourced", sa.Boolean(), nullable=False, server_default=sa.false()),
        ),
        ("material_inspections", sa.Column("failure_lines", sa.JSON(), nullable=True)),
        (
            "material_quantity_adjustments",
            sa.Column("report_template", sa.String(24), nullable=True),
        ),
    ):
        if column.name not in {item["name"] for item in inspector.get_columns(table)}:
            op.add_column(table, column)


def downgrade():
    op.drop_column("material_quantity_adjustments", "report_template")
    op.drop_column("material_inspections", "failure_lines")
    op.drop_column("material_transfers", "is_outsourced")
