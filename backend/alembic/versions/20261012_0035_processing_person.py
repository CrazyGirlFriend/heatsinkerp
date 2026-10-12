"""Keep the actual processing person's name on each processing record."""

import sqlalchemy as sa
from alembic import op

revision = "20261012_0035"
down_revision = "20261012_0034"
branch_labels = None
depends_on = None


def upgrade():
    columns = {
        column["name"]
        for column in sa.inspect(op.get_bind()).get_columns("material_quantity_adjustments")
    }
    if "processor_name" not in columns:
        op.add_column(
            "material_quantity_adjustments",
            sa.Column("processor_name", sa.String(80), nullable=True),
        )
    if "team_employees" not in sa.inspect(op.get_bind()).get_table_names():
        op.create_table(
            "team_employees",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "team_id",
                sa.Integer(),
                sa.ForeignKey("teams.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("name", sa.String(80), nullable=False),
            sa.Column("active", sa.Boolean(), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("team_id", "name", name="uq_team_employee_name"),
        )
        op.create_index("ix_team_employees_team_id", "team_employees", ["team_id"])


def downgrade():
    raise RuntimeError("Preserve processing person history on rollback")
