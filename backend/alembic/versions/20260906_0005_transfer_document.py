"""Add material document snapshots, optimistic version and append-only history.

Revision ID: 20260906_0005
Revises: 20260906_0004
"""

from alembic import op
import sqlalchemy as sa


revision = "20260906_0005"
down_revision = "20260906_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    table = "material_transfers"
    columns = {column["name"] for column in inspector.get_columns(table)}
    checks = {check["name"] for check in inspector.get_check_constraints(table)}
    additions = [
        sa.Column("material_type", sa.String(32)),
        sa.Column("source_batch_no", sa.String(80)),
        sa.Column("material_name", sa.String(160)),
        sa.Column("finished_specification", sa.String(240)),
        sa.Column("transfer_specification", sa.String(240)),
        sa.Column("finished_quantity", sa.Integer()),
        sa.Column("customer_code", sa.String(80)),
        sa.Column("technical_requirements", sa.Text()),
        sa.Column("product_code", sa.String(80)),
        sa.Column("part_no", sa.String(80)),
        sa.Column("material_shape", sa.String(80)),
        sa.Column("material_description", sa.Text()),
        sa.Column("outsourced_unit", sa.String(160)),
        sa.Column("purpose_category", sa.String(80)),
        sa.Column("category_level3", sa.String(80)),
        sa.Column("order_category", sa.String(80)),
        sa.Column("special_process", sa.Text()),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
    ]
    new_checks = {
        "ck_material_transfers_quantity_nonnegative": "quantity >= 0",
        "ck_material_transfers_weight_nonnegative": "weight >= 0",
        "ck_material_transfers_nonempty": "quantity > 0 OR weight > 0",
        "ck_material_transfers_finished_quantity": "finished_quantity IS NULL OR finished_quantity >= 0",
    }
    # Batch operations also support existing SQLite databases. No fabricated
    # metadata or historical events are backfilled for pre-upgrade records.
    with op.batch_alter_table(table) as batch:
        for column in additions:
            if column.name not in columns:
                batch.add_column(column)
        for name in ("ck_material_transfers_quantity_positive", "ck_material_transfers_weight_positive"):
            if name in checks:
                batch.drop_constraint(name, type_="check")
        for name, expression in new_checks.items():
            if name not in checks:
                batch.create_check_constraint(name, expression)

    if "material_transfer_events" not in sa.inspect(connection).get_table_names():
        op.create_table(
            "material_transfer_events",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("transfer_id", sa.Integer(), nullable=False),
            sa.Column("action", sa.String(16), nullable=False),
            sa.Column("actor", sa.String(80), nullable=False),
            sa.Column("actor_user_id", sa.Integer(), nullable=True),
            sa.Column("occurred_at", sa.DateTime(), nullable=False),
            sa.Column("changes", sa.JSON(), nullable=False),
            sa.ForeignKeyConstraint(["transfer_id"], ["material_transfers.id"], ondelete="RESTRICT"),
            sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        )
    indexes = {index["name"] for index in sa.inspect(connection).get_indexes("material_transfer_events")}
    if "ix_material_transfer_events_transfer_id" not in indexes:
        op.create_index("ix_material_transfer_events_transfer_id", "material_transfer_events", ["transfer_id"])
    if connection.dialect.name == "sqlite":
        if connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall():
            raise RuntimeError("Foreign-key violations after transfer-document migration")


def downgrade() -> None:
    raise RuntimeError("Restore a verified backup; downgrading would lose material document and audit data.")
