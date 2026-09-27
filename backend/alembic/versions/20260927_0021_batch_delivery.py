"""Put delivery requirements on origin documents; preserve historical plans."""

import sqlalchemy as sa
from alembic import op

revision = "20260927_0021"
down_revision = "20260927_0020"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    if "delivery_date" in {
        c["name"] for c in sa.inspect(connection).get_columns("material_transfers")
    }:
        return
    with op.batch_alter_table("material_transfers") as batch:
        batch.add_column(sa.Column("delivery_date", sa.Date(), nullable=True))
        batch.add_column(sa.Column("delivery_quantity", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("delivery_origin_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_mt_delivery_origin",
            "material_transfers",
            ["delivery_origin_id"],
            ["id"],
            ondelete="RESTRICT",
        )
        batch.create_index("ix_material_transfers_delivery_origin_id", ["delivery_origin_id"])
        batch.create_check_constraint(
            "ck_mt_delivery_pair",
            "(delivery_date IS NULL AND delivery_quantity IS NULL) OR "
            "(delivery_date IS NOT NULL AND delivery_quantity IS NOT NULL AND delivery_quantity > 0)",
        )
        batch.create_check_constraint(
            "ck_mt_delivery_origin",
            "delivery_origin_id IS NULL OR (delivery_date IS NULL AND delivery_quantity IS NULL)",
        )
    # Follow explicit source links only. Dates are never guessed from creation times or notes.
    parents = {
        row.id: row.source_transfer_id
        for row in connection.execute(
            sa.text("SELECT id, source_transfer_id FROM material_transfers")
        )
    }
    roots = {}
    for identity in parents:
        path, node, seen = [], identity, set()
        while node not in roots and node in parents and node not in seen:
            seen.add(node)
            path.append(node)
            if parents[node] is None:
                roots[node] = node
                break
            node = parents[node]
        root = roots.get(node)
        if root is not None:
            roots.update((item, root) for item in path)
    rows = [
        {"identity": identity, "origin": root}
        for identity, root in roots.items()
        if identity != root
    ]
    for start in range(0, len(rows), 1000):
        connection.execute(
            sa.text("UPDATE material_transfers SET delivery_origin_id=:origin WHERE id=:identity"),
            rows[start : start + 1000],
        )


def downgrade():
    raise RuntimeError("Retain batch delivery requirements when rolling back application images")
