"""Persist a user's selected preset avatar."""

import sqlalchemy as sa
from alembic import op

revision = "20261009_0029"
down_revision = "20261009_0028"
branch_labels = None
depends_on = None


def upgrade():
    if "avatar_key" not in {
        column["name"] for column in sa.inspect(op.get_bind()).get_columns("users")
    }:
        op.add_column(
            "users", sa.Column("avatar_key", sa.String(32), nullable=False, server_default="")
        )


def downgrade():
    with op.batch_alter_table("users") as batch:
        batch.drop_column("avatar_key")
