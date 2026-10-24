"""Index current-version lookups for the engineering workbench."""

import sqlalchemy as sa
from alembic import op

revision = "20261024_0051"
down_revision = "20261024_0050"
branch_labels = None
depends_on = None


def upgrade():
    indexes = sa.inspect(op.get_bind()).get_indexes("process_routes")
    if not any(index["name"] == "ix_process_routes_parent_state" for index in indexes):
        op.create_index("ix_process_routes_parent_state", "process_routes", ["parent_id", "state"])


def downgrade():
    op.drop_index("ix_process_routes_parent_state", table_name="process_routes")
