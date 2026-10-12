"""Shared physical origins and their order requirements; no historical reallocation."""

import sqlalchemy as sa
from alembic import op

revision = "20261012_0033"
down_revision = "20261010_0032"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    if "shared_material_groups" not in tables:
        op.create_table(
            "shared_material_groups",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("batch_no", sa.String(40), nullable=False, unique=True),
        )
    if "shared_material_members" not in tables:
        op.create_table(
            "shared_material_members",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "group_id",
                sa.Integer(),
                sa.ForeignKey("shared_material_groups.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("serial_no", sa.String(80), nullable=False),
            sa.Column("customer_code", sa.String(80)),
            sa.Column("finished_specification", sa.String(240)),
            sa.Column("delivery_date", sa.Date()),
            sa.Column("delivery_quantity", sa.Integer()),
            sa.UniqueConstraint("group_id", "serial_no", name="uq_shared_material_member"),
            sa.CheckConstraint(
                "(delivery_date IS NULL AND delivery_quantity IS NULL) OR (delivery_date IS NOT NULL AND delivery_quantity IS NOT NULL AND delivery_quantity > 0)",
                name="ck_shared_material_delivery",
            ),
        )
    indexes = {
        index["name"] for index in sa.inspect(op.get_bind()).get_indexes("shared_material_members")
    }
    for column in ("group_id", "serial_no"):
        name = f"ix_shared_material_members_{column}"
        if name not in indexes:
            op.create_index(name, "shared_material_members", [column])
    columns = {column["name"] for column in inspector.get_columns("material_transfers")}
    with op.batch_alter_table("material_transfers") as batch:
        if "shared_group_id" not in columns:
            batch.add_column(sa.Column("shared_group_id", sa.Integer()))
            batch.create_foreign_key(
                "fk_mt_shared_group",
                "shared_material_groups",
                ["shared_group_id"],
                ["id"],
                ondelete="RESTRICT",
            )
            batch.create_index("ix_material_transfers_shared_group_id", ["shared_group_id"])
        if "shared_unallocated" not in columns:
            batch.add_column(
                sa.Column("shared_unallocated", sa.Boolean(), nullable=False, server_default="0")
            )


def downgrade():
    raise RuntimeError("Preserve shared material origins and allocation history on rollback")
