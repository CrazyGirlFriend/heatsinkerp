"""Preserve the executed process requirement without inventing historical values."""

import sqlalchemy as sa
from alembic import op

revision = "20261023_0048"
down_revision = "20261023_0047"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    if "process_step_instructions" not in {
        column["name"]
        for column in sa.inspect(connection).get_columns("material_quantity_adjustments")
    }:
        op.add_column(
            "material_quantity_adjustments", sa.Column("process_step_instructions", sa.Text())
        )


def downgrade():
    raise RuntimeError("加工工艺快照不可删除，请通过恢复备份回退")
