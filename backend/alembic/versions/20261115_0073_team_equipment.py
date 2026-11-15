"""Managed team equipment with immutable processing number snapshots."""

import sqlalchemy as sa
from alembic import op

revision = "20261115_0073"
down_revision = "20261112_0072"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    columns = {item["name"] for item in inspector.get_columns("material_quantity_adjustments")}
    # The historical baseline creates current metadata for a new installation.
    if not inspector.has_table("team_equipment"):
        op.create_table(
            "team_equipment",
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
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("team_id", "name", name="uq_team_equipment_name"),
        )
        op.create_index("ix_team_equipment_team_id", "team_equipment", ["team_id"])
    if "equipment_id" not in columns:
        with op.batch_alter_table("material_quantity_adjustments") as batch:
            batch.add_column(sa.Column("equipment_id", sa.Integer(), nullable=True))
            batch.create_foreign_key(
                "fk_mqa_equipment", "team_equipment", ["equipment_id"], ["id"], ondelete="RESTRICT"
            )
            batch.create_index("ix_material_quantity_adjustments_equipment_id", ["equipment_id"])


def downgrade():
    with op.batch_alter_table("material_quantity_adjustments") as batch:
        batch.drop_index("ix_material_quantity_adjustments_equipment_id")
        batch.drop_constraint("fk_mqa_equipment", type_="foreignkey")
        batch.drop_column("equipment_id")
    op.drop_index("ix_team_equipment_team_id", table_name="team_equipment")
    op.drop_table("team_equipment")
