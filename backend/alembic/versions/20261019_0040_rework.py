"""Rework facts and inherited inspection holds; historical work remains initial."""

import sqlalchemy as sa
from alembic import op

revision = "20261019_0040"
down_revision = "20261019_0039"
branch_labels = None
depends_on = None


def upgrade():
    action = next(
        column
        for column in sa.inspect(op.get_bind()).get_columns("material_transfer_events")
        if column["name"] == "action"
    )
    if (action["type"].length or 0) < 32:
        with op.batch_alter_table("material_transfer_events") as batch:
            batch.alter_column(
                "action", existing_type=sa.String(16), type_=sa.String(32), existing_nullable=False
            )
    for table, columns in (
        (
            "material_transfers",
            [
                sa.Column("rework_pending", sa.Boolean(), nullable=False, server_default="0"),
                sa.Column("rework_count", sa.Integer(), nullable=False, server_default="0"),
                sa.Column("inspection_hold_root_id", sa.Integer()),
            ],
        ),
        (
            "material_quantity_adjustments",
            [
                sa.Column("work_kind", sa.String(16), nullable=False, server_default="initial"),
                sa.Column("rework_of_id", sa.Integer()),
                sa.Column("rework_round", sa.Integer(), nullable=False, server_default="0"),
            ],
        ),
    ):
        existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}
        for column in columns:
            if column.name not in existing:
                op.add_column(table, column)
    indexes = {i["name"] for i in sa.inspect(op.get_bind()).get_indexes("material_transfers")}
    if "ix_material_transfers_inspection_hold_root_id" not in indexes:
        op.create_index(
            "ix_material_transfers_inspection_hold_root_id",
            "material_transfers",
            ["inspection_hold_root_id"],
        )
    fks = sa.inspect(op.get_bind()).get_foreign_keys("material_quantity_adjustments")
    if not any(f["constrained_columns"] == ["rework_of_id"] for f in fks):
        with op.batch_alter_table("material_quantity_adjustments") as batch:
            batch.create_foreign_key(
                "fk_mqa_rework_of",
                "material_quantity_adjustments",
                ["rework_of_id"],
                ["id"],
                ondelete="RESTRICT",
            )
    op.execute(
        sa.text(
            "UPDATE material_transfers SET inspection_hold_root_id = id WHERE id IN (SELECT source_transfer_id FROM material_inspections WHERE parent_id IS NULL AND failed_quantity > 0 AND released_at IS NULL)"
        )
    )


def downgrade():
    raise RuntimeError("Preserve rework and inspection genealogy")
