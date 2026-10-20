"""Record team task and business snapshots without inventing legacy work."""

import sqlalchemy as sa
from alembic import op

revision = "20261020_0042"
down_revision = "20261019_0041"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("team_processing_tasks"):
        op.create_table(
            "team_processing_tasks",
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
            sa.UniqueConstraint("team_id", "name", name="uq_team_processing_task_name"),
        )
        op.create_index("ix_team_processing_tasks_team_id", "team_processing_tasks", ["team_id"])
    columns = {column["name"] for column in inspector.get_columns("material_quantity_adjustments")}
    foreign_keys = {
        tuple(key["constrained_columns"])
        for key in inspector.get_foreign_keys("material_quantity_adjustments")
    }
    indexes = {key["name"] for key in inspector.get_indexes("material_quantity_adjustments")}
    with op.batch_alter_table("material_quantity_adjustments") as batch:
        for name, kind in (
            ("processing_task_id", sa.Integer()),
            ("processing_task_name", sa.String(80)),
            ("purpose_id", sa.Integer()),
            ("purpose_name", sa.String(80)),
        ):
            if name not in columns:
                batch.add_column(sa.Column(name, kind, nullable=True))
        for column, table, name in (
            ("processing_task_id", "team_processing_tasks", "fk_mqa_processing_task"),
            ("purpose_id", "team_purposes", "fk_mqa_purpose"),
        ):
            if (column,) not in foreign_keys:
                batch.create_foreign_key(name, table, [column], ["id"], ondelete="RESTRICT")
        for name, fields in (
            ("ix_mqa_team_task_day", ["team_id", "processing_task_id", "processing_date"]),
            ("ix_mqa_team_purpose_day", ["team_id", "purpose_id", "processing_date"]),
        ):
            if name not in indexes:
                batch.create_index(name, fields)


def downgrade():
    raise RuntimeError("Preserve task identity and processing history on rollback")
