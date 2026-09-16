"""Index material transfer filters, explicit searches and stable page ordering.

Revision ID: 20260906_0006
Revises: 20260906_0005
"""

from alembic import op
import sqlalchemy as sa


revision = "20260906_0006"
down_revision = "20260906_0005"
branch_labels = None
depends_on = None

INDEXES = (
    ("ix_mt_created", ("created_at", "id")),
    ("ix_mt_status_created", ("status", "created_at", "id")),
    ("ix_mt_source_created", ("source_team_id", "created_at", "id")),
    ("ix_mt_next_created", ("next_team_id", "created_at", "id")),
    ("ix_mt_source_status_created", ("source_team_id", "status", "created_at", "id")),
    ("ix_mt_next_status_created", ("next_team_id", "status", "created_at", "id")),
    ("ix_mt_source_batch_created", ("source_batch_no", "created_at", "id")),
    ("ix_mt_customer_created", ("customer_code", "created_at", "id")),
    ("ix_mt_product_created", ("product_code", "created_at", "id")),
    ("ix_mt_material_created", ("material_name", "created_at", "id")),
    ("ix_mt_type_created", ("material_type", "created_at", "id")),
)


def upgrade() -> None:
    connection = op.get_bind()
    existing = {
        index["name"]: tuple(index["column_names"])
        for index in sa.inspect(connection).get_indexes("material_transfers")
    }
    missing = []
    for name, columns in INDEXES:
        if name in existing:
            if existing[name] != columns:
                raise RuntimeError(f"Index {name} already exists with unexpected columns")
            continue
        missing.append((name, columns))
    # One online ALTER avoids rebuilding/scanning the table once per index.
    # Never silently fall back to copy-table/locked-write DDL on MySQL.
    if missing and connection.dialect.name == "mysql":
        clauses = [
            f"ADD INDEX `{name}` (" + ", ".join(f"`{column}`" for column in columns) + ")"
            for name, columns in missing
        ]
        op.execute(sa.text(
            "ALTER TABLE `material_transfers` " + ", ".join(clauses)
            + ", ALGORITHM=INPLACE, LOCK=NONE"
        ))
    else:
        for name, columns in missing:
            op.create_index(name, "material_transfers", list(columns))


def downgrade() -> None:
    raise RuntimeError("Review index dependencies before rolling back this performance migration.")
