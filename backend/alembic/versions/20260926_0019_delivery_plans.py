"""Add delivery plans without changing existing stock or transfer records."""

import sqlalchemy as sa
from alembic import op

revision = "20260926_0019"
down_revision = "20260923_0018"
branch_labels = None
depends_on = None


def upgrade():
    if "serial_delivery_plans" not in sa.inspect(op.get_bind()).get_table_names():
        op.create_table(
            "serial_delivery_plans",
            sa.Column("serial_no", sa.String(80), primary_key=True),
            sa.Column("installments", sa.JSON(), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("updated_by", sa.String(80), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.CheckConstraint("version > 0", name="ck_delivery_plan_version"),
        )


def downgrade():
    raise RuntimeError("Retain recorded delivery plans when rolling back application images")
