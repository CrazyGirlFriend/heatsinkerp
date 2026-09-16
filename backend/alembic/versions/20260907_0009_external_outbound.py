"""Explicit source-confirmed warehouse outbound and inspection shipping.

Revision ID: 20260907_0009
Revises: 20260906_0008
"""
from alembic import op
import sqlalchemy as sa

revision = "20260907_0009"
down_revision = "20260906_0008"
branch_labels = None
depends_on = None

SOURCE_CHECK = (
    "(entry_kind IN ('transfer', 'warehouse_outbound', 'inspection_shipment') AND source_team_id IS NOT NULL AND source_team_code IS NOT NULL AND source_team_name IS NOT NULL) OR "
    "(entry_kind = 'warehouse_receipt' AND source_team_id IS NULL AND source_team_code IS NULL AND source_team_name IS NULL "
    "AND source_transfer_id IS NULL AND dispatch_id IS NULL AND status = 'received' AND stock_tracked = 1)"
)
TRANSFER_DESTINATION_CHECK = (
    "(entry_kind IN ('transfer', 'warehouse_receipt') AND next_team_id IS NOT NULL AND next_team_code IS NOT NULL AND next_team_name IS NOT NULL "
    "AND external_destination IS NULL AND status IN ('pending', 'received', 'voided')) OR "
    "(entry_kind IN ('warehouse_outbound', 'inspection_shipment') AND next_team_id IS NULL AND next_team_code IS NULL AND next_team_name IS NULL "
    "AND external_destination IS NOT NULL AND length(trim(external_destination)) > 0 AND source_transfer_id IS NOT NULL AND dispatch_id IS NOT NULL "
    "AND stock_tracked = 0 AND status IN ('pending', 'dispatched', 'voided'))"
)
DISPATCH_DESTINATION_CHECK = (
    "(entry_kind = 'transfer' AND next_team_id IS NOT NULL AND next_team_code IS NOT NULL AND next_team_name IS NOT NULL AND external_destination IS NULL) OR "
    "(entry_kind IN ('warehouse_outbound', 'inspection_shipment') AND next_team_id IS NULL AND next_team_code IS NULL AND next_team_name IS NULL "
    "AND external_destination IS NOT NULL AND length(trim(external_destination)) > 0)"
)


def upgrade():
    bind = op.get_bind()
    # A SQLite rebuild of referenced tables requires enforcement disabled by
    # the migration connection BEFORE its transaction; validate after rebuild.
    if bind.dialect.name == "sqlite" and bind.exec_driver_sql("PRAGMA foreign_keys").scalar():
        raise RuntimeError("SQLite upgrade requires foreign_keys=OFF before the migration transaction; run foreign_key_check afterward")
    for table in ("material_dispatches", "material_transfers"):
        columns = {c["name"]: c for c in sa.inspect(bind).get_columns(table)}
        checks = {c["name"]: c["sqltext"] for c in sa.inspect(bind).get_check_constraints(table)}
        additions = [sa.Column("external_destination", sa.String(240))]
        if table == "material_dispatches":
            additions.append(sa.Column("entry_kind", sa.String(24), nullable=False, server_default="transfer"))
            new_checks = {"ck_md_entry_destination": DISPATCH_DESTINATION_CHECK}
        else:
            additions.extend([
                sa.Column("dispatched_by", sa.String(80)),
                sa.Column("dispatched_by_user_id", sa.Integer()),
                sa.Column("dispatched_at", sa.DateTime()),
                sa.Column("outbound_idempotency_key", sa.String(100)),
            ])
            new_checks = {"ck_mt_entry_destination": TRANSFER_DESTINATION_CHECK}
        with op.batch_alter_table(table) as batch:
            for col in additions:
                if col.name not in columns:
                    batch.add_column(col)
            for name in ("next_team_id", "next_team_code", "next_team_name"):
                if not columns[name]["nullable"]:
                    batch.alter_column(name, existing_type=columns[name]["type"], nullable=True)
            if table == "material_transfers":
                if "warehouse_outbound" not in checks.get("ck_mt_entry_kind_source", ""):
                    if "ck_mt_entry_kind_source" in checks:
                        batch.drop_constraint("ck_mt_entry_kind_source", type_="check")
                    batch.create_check_constraint("ck_mt_entry_kind_source", SOURCE_CHECK)
            for name, expression in new_checks.items():
                if name not in checks:
                    batch.create_check_constraint(name, expression)
        if table == "material_transfers":
            inspector = sa.inspect(bind)
            with op.batch_alter_table(table) as batch:
                if not any(fk["constrained_columns"] == ["dispatched_by_user_id"] for fk in inspector.get_foreign_keys(table)):
                    batch.create_foreign_key("fk_mt_dispatched_user", "users", ["dispatched_by_user_id"], ["id"], ondelete="SET NULL")
                if not any(u["column_names"] == ["outbound_idempotency_key"] for u in inspector.get_unique_constraints(table)):
                    batch.create_unique_constraint("uq_mt_outbound_key", ["outbound_idempotency_key"])
        index_name = "ix_mt_source_kind_created" if table == "material_transfers" else "ix_md_team_kind_created"
        expected = ["source_team_id", "entry_kind", "created_at", "id"]
        indexes = {idx["name"]: idx["column_names"] for idx in sa.inspect(bind).get_indexes(table)}
        if index_name not in indexes:
            op.create_index(index_name, table, expected)
        elif indexes[index_name] != expected:
            raise RuntimeError("Unexpected existing outbound kind index definition")
    if bind.dialect.name == "sqlite" and bind.exec_driver_sql("PRAGMA foreign_key_check").fetchall():
        raise RuntimeError("Foreign-key violations after external outbound migration")


def downgrade():
    raise RuntimeError("Restore a verified backup; confirmed outbound history must not be discarded by downgrade.")
