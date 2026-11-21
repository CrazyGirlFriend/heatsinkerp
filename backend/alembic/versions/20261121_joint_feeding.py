"""Bind each joint feeding serial to its selected processing plan."""

import sqlalchemy as sa
from alembic import op

revision = "20261121_joint_feeding"
down_revision = "20261120_0077"
branch_labels = None
depends_on = None

table = "shared_material_members"


def upgrade():
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns(table)}
    with op.batch_alter_table(table) as batch:
        if "feeding_schedule_id" not in columns:
            batch.add_column(sa.Column("feeding_schedule_id", sa.Integer()))
        if "task_batch_number" not in columns:
            batch.add_column(sa.Column("task_batch_number", sa.Integer()))
        if not any(
            key["constrained_columns"] == ["feeding_schedule_id"]
            for key in inspector.get_foreign_keys(table)
        ):
            batch.create_foreign_key(
                "fk_shared_feeding_plan",
                "production_schedules",
                ["feeding_schedule_id"],
                ["id"],
                ondelete="RESTRICT",
            )
        if not any(
            key["column_names"] == ["feeding_schedule_id"] for key in inspector.get_indexes(table)
        ):
            batch.create_index(
                "ix_shared_material_members_feeding_schedule_id", ["feeding_schedule_id"]
            )


def downgrade():
    with op.batch_alter_table(table) as batch:
        batch.drop_index("ix_shared_material_members_feeding_schedule_id")
        batch.drop_constraint("fk_shared_feeding_plan", type_="foreignkey")
        batch.drop_column("feeding_schedule_id")
        batch.drop_column("task_batch_number")
