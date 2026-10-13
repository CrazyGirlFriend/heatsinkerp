"""Separate the actual sending employee from the account creating the transfer."""

import sqlalchemy as sa
from alembic import op

revision = "20261013_0037"
down_revision = "20261012_0036"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("material_transfers")}
    foreign_keys = {key["name"] for key in inspector.get_foreign_keys("material_transfers")}
    with op.batch_alter_table("material_transfers") as batch:
        if "sent_employee_id" not in columns:
            batch.add_column(sa.Column("sent_employee_id", sa.Integer(), nullable=True))
        if "sent_employee_name" not in columns:
            batch.add_column(sa.Column("sent_employee_name", sa.String(80), nullable=True))
        if "fk_mt_sent_employee" not in foreign_keys:
            batch.create_foreign_key(
                "fk_mt_sent_employee",
                "team_employees",
                ["sent_employee_id"],
                ["id"],
                ondelete="RESTRICT",
            )


def downgrade():
    raise RuntimeError("Preserve sending employee history on rollback")
