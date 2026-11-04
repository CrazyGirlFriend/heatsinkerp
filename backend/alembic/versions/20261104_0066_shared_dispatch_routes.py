"""Keep each joint production order's execution route after cutting."""

import sqlalchemy as sa
from alembic import op

revision = "20261104_0066"
down_revision = "20261103_0065"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("shared_material_groups", sa.Column("split_step_index", sa.Integer()))
    with op.batch_alter_table("shared_material_members") as batch:
        batch.add_column(sa.Column("process_route_id", sa.Integer()))
        batch.add_column(sa.Column("process_route_version", sa.Integer()))
        batch.create_foreign_key(
            "fk_shared_member_route",
            "process_routes",
            ["process_route_id"],
            ["id"],
            ondelete="RESTRICT",
        )


def downgrade():
    with op.batch_alter_table("shared_material_members") as batch:
        batch.drop_constraint("fk_shared_member_route", type_="foreignkey")
        batch.drop_column("process_route_version")
        batch.drop_column("process_route_id")
    op.drop_column("shared_material_groups", "split_step_index")
