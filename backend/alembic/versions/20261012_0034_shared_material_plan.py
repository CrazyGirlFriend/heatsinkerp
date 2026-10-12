"""Keep the original cutting plan alongside actual shared-lot processing."""

import sqlalchemy as sa
from alembic import op

revision = "20261012_0034"
down_revision = "20261012_0033"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("shared_material_members")}
    checks = {check["name"] for check in inspector.get_check_constraints("shared_material_members")}
    with op.batch_alter_table("shared_material_members") as batch:
        for name, kind in (
            ("planned_weight", sa.Numeric(17, 6)),
            ("planned_quantity", sa.Integer()),
            ("planned_specification", sa.String(240)),
        ):
            if name not in columns:
                batch.add_column(sa.Column(name, kind, nullable=True))
        if "ck_shared_material_plan" not in checks:
            batch.create_check_constraint(
                "ck_shared_material_plan",
                "(planned_weight IS NULL AND planned_quantity IS NULL AND planned_specification IS NULL) OR "
                "(planned_weight IS NOT NULL AND planned_weight > 0 AND planned_quantity IS NOT NULL AND planned_quantity > 0 "
                "AND planned_specification IS NOT NULL AND length(trim(planned_specification)) > 0)",
            )


def downgrade():
    raise RuntimeError("Preserve shared material plans on rollback")
