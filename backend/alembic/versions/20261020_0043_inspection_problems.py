"""QC-maintained defect vocabulary with immutable inspection name snapshots."""

import sqlalchemy as sa
from alembic import op

revision = "20261020_0043"
down_revision = "20261020_0042"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("inspection_problem_types"):
        op.create_table(
            "inspection_problem_types",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "team_id",
                sa.Integer(),
                sa.ForeignKey("teams.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("name", sa.String(80), nullable=False),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("team_id", "name", name="uq_inspection_problem_name"),
        )
        op.create_index(
            "ix_inspection_problem_types_team_id", "inspection_problem_types", ["team_id"]
        )
    if not inspector.has_table("inspection_problems"):
        op.create_table(
            "inspection_problems",
            sa.Column(
                "inspection_id",
                sa.Integer(),
                sa.ForeignKey("material_inspections.id", ondelete="RESTRICT"),
                primary_key=True,
            ),
            sa.Column(
                "problem_type_id",
                sa.Integer(),
                sa.ForeignKey("inspection_problem_types.id", ondelete="RESTRICT"),
                primary_key=True,
            ),
            sa.Column("name", sa.String(80), nullable=False),
        )
        op.create_index(
            "ix_inspection_problems_problem_type_id", "inspection_problems", ["problem_type_id"]
        )


def downgrade():
    raise RuntimeError("Preserve inspection problem identity and history on rollback")
