"""Allow multiple authorized inventory submissions without changing existing lots."""

import sqlalchemy as sa
from alembic import op

revision = "20261008_0027"
down_revision = "20261008_0026"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table = "opening_stock_submissions"
    index = "ix_opening_stock_submissions_team_id"
    # MySQL requires another team_id index before dropping the FK's unique index.
    if index not in {item["name"] for item in inspector.get_indexes(table)}:
        op.create_index(index, table, ["team_id"])
    names = [
        item["name"] or "uq_opening_stock_submissions_team_id"
        for item in inspector.get_unique_constraints(table)
        if item["column_names"] == ["team_id"]
    ]
    if names:
        with op.batch_alter_table(
            table, naming_convention={"uq": "uq_%(table_name)s_%(column_0_name)s"}
        ) as batch:
            for name in names:
                batch.drop_constraint(name, type_="unique")


def downgrade():
    raise RuntimeError("Multiple inventory submissions must retain their independent records")
