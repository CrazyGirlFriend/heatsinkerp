"""Add independently maintained business contacts to scheduling tasks."""

import sqlalchemy as sa
from alembic import op

revision = "20261023_0046"
down_revision = "20261022_0045"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("business_people"):
        op.create_table(
            "business_people",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("name", sa.String(80), nullable=False, unique=True),
            sa.Column("active", sa.Boolean(), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False),
        )
    columns = {column["name"] for column in inspector.get_columns("production_schedule_tasks")}
    has_fk = any(
        fk["constrained_columns"] == ["business_person_id"]
        for fk in inspector.get_foreign_keys("production_schedule_tasks")
    )
    has_index = any(
        index["column_names"] == ["business_person_id"]
        for index in inspector.get_indexes("production_schedule_tasks")
    )
    if "business_person_id" not in columns or not has_fk or not has_index:
        with op.batch_alter_table("production_schedule_tasks") as batch:
            if "business_person_id" not in columns:
                batch.add_column(sa.Column("business_person_id", sa.Integer(), nullable=True))
            if not has_fk:
                batch.create_foreign_key(
                    "fk_pst_business_person",
                    "business_people",
                    ["business_person_id"],
                    ["id"],
                    ondelete="RESTRICT",
                )
            if not has_index:
                batch.create_index(
                    "ix_production_schedule_tasks_business_person_id", ["business_person_id"]
                )


def downgrade():
    raise RuntimeError("业务人员与排期关联需要保留，请通过恢复备份回退")
