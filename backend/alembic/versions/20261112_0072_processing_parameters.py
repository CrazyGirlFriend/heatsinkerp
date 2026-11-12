"""Keep furnace and machine parameters on each immutable processing record."""

import sqlalchemy as sa
from alembic import op

revision = "20261112_0072"
down_revision = "20261112_0071"
branch_labels = None
depends_on = None


def upgrade():
    for name, data_type in (
        ("furnace_no", sa.String(80)),
        ("temperature_requirement", sa.String(160)),
        ("actual_temperature_c", sa.Numeric(7, 2)),
        ("holding_minutes", sa.Integer()),
        ("machine_no", sa.String(80)),
    ):
        op.add_column("material_quantity_adjustments", sa.Column(name, data_type, nullable=True))


def downgrade():
    for name in (
        "machine_no",
        "holding_minutes",
        "actual_temperature_c",
        "temperature_requirement",
        "furnace_no",
    ):
        op.drop_column("material_quantity_adjustments", name)
