"""Unified inspection facts and manual quality feedback; preserve legacy holds."""

import sqlalchemy as sa
from alembic import op

revision = "20261019_0041"
down_revision = "20261019_0040"
branch_labels = None
depends_on = None


def upgrade():
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("material_inspections")}
    for column in (
        sa.Column("kind", sa.String(16), nullable=False, server_default="patrol"),
        sa.Column("scope", sa.String(16), nullable=False, server_default="sample"),
        sa.Column("methods", sa.JSON()),
        sa.Column("items", sa.JSON()),
        sa.Column("dimension_result", sa.Text()),
        sa.Column("weight_result", sa.Text()),
        sa.Column("blocks_outbound", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("feedback_status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("disposition", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("decision_notes", sa.Text()),
        sa.Column("feedback_version", sa.Integer(), nullable=False, server_default="0"),
    ):
        if column.name not in columns:
            op.add_column("material_inspections", column)
    tables = sa.inspect(op.get_bind()).get_table_names()
    indexes = {i["name"] for i in sa.inspect(op.get_bind()).get_indexes("material_inspections")}
    for name, columns in (
        ("ix_inspection_kind_checked", ["kind", "checked_at", "id"]),
        ("ix_inspection_feedback_status", ["feedback_status", "checked_at", "id"]),
    ):
        if name not in indexes:
            op.create_index(name, "material_inspections", columns)
    if "inspection_feedback_teams" not in tables:
        op.create_table(
            "inspection_feedback_teams",
            sa.Column(
                "inspection_id",
                sa.Integer(),
                sa.ForeignKey("material_inspections.id", ondelete="RESTRICT"),
                primary_key=True,
            ),
            sa.Column(
                "team_id",
                sa.Integer(),
                sa.ForeignKey("teams.id", ondelete="RESTRICT"),
                primary_key=True,
            ),
        )
        op.create_index(
            "ix_inspection_feedback_teams_team_id", "inspection_feedback_teams", ["team_id"]
        )
    if "inspection_feedback_events" not in tables:
        op.create_table(
            "inspection_feedback_events",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "inspection_id",
                sa.Integer(),
                sa.ForeignKey("material_inspections.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column(
                "team_id",
                sa.Integer(),
                sa.ForeignKey("teams.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("kind", sa.String(16), nullable=False),
            sa.Column("notes", sa.Text(), nullable=False),
            sa.Column("details", sa.JSON()),
            sa.Column("actor", sa.String(80), nullable=False),
            sa.Column(
                "actor_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")
            ),
            sa.Column("occurred_at", sa.DateTime(), nullable=False),
            sa.Column("idempotency_key", sa.String(100), nullable=False, unique=True),
            sa.Column("request_hash", sa.String(64), nullable=False),
        )
        op.create_index(
            "ix_feedback_event_issue", "inspection_feedback_events", ["inspection_id", "id"]
        )


def downgrade():
    raise RuntimeError("Preserve inspection and quality feedback history")
