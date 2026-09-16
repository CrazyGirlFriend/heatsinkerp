"""Explicit warehouse manual stock origins, without fabricated source teams.

Revision ID: 20260906_0008
Revises: 20260906_0007
"""
from alembic import op
import sqlalchemy as sa

revision = "20260906_0008"
down_revision = "20260906_0007"
branch_labels = None
depends_on = None

SOURCE_CHECK = (
    "(entry_kind = 'transfer' AND source_team_id IS NOT NULL AND source_team_code IS NOT NULL AND source_team_name IS NOT NULL) OR "
    "(entry_kind = 'warehouse_receipt' AND source_team_id IS NULL AND source_team_code IS NULL AND source_team_name IS NULL "
    "AND source_transfer_id IS NULL AND dispatch_id IS NULL AND status = 'received' AND stock_tracked = 1)"
)


def upgrade():
    bind = op.get_bind()
    columns = {column["name"]: column for column in sa.inspect(bind).get_columns("material_transfers")}
    checks = {check["name"] for check in sa.inspect(bind).get_check_constraints("material_transfers")}
    alter_sources = [name for name in ("source_team_id", "source_team_code", "source_team_name") if not columns[name]["nullable"]]
    needs_rebuild = alter_sources or "ck_mt_entry_kind_source" not in checks
    if bind.dialect.name == "sqlite" and needs_rebuild and bind.exec_driver_sql("PRAGMA foreign_keys").scalar():
        # SQLite cannot change NOT NULL in place, and referenced tables must
        # not be dropped with enforcement enabled. Alembic's normal SQLite
        # connection has it disabled; custom runners must do so BEFORE a txn.
        raise RuntimeError("SQLite upgrade requires foreign_keys=OFF before the migration transaction; run foreign_key_check afterward")
    with op.batch_alter_table("material_transfers") as batch:
        if "entry_kind" not in columns:
            batch.add_column(sa.Column("entry_kind", sa.String(24), nullable=False, server_default="transfer"))
        for name in alter_sources:
            batch.alter_column(name, existing_type=columns[name]["type"], nullable=True)
        if "ck_mt_entry_kind_source" not in checks:
            batch.create_check_constraint("ck_mt_entry_kind_source", SOURCE_CHECK)
    indexes = {index["name"]: index["column_names"] for index in sa.inspect(bind).get_indexes("material_transfers")}
    expected = ["next_team_id", "entry_kind", "created_at", "id"]
    if "ix_mt_intake_created" not in indexes:
        op.create_index("ix_mt_intake_created", "material_transfers", expected)
    elif indexes["ix_mt_intake_created"] != expected:
        raise RuntimeError("Unexpected existing warehouse intake index definition")
    if bind.dialect.name == "sqlite" and bind.exec_driver_sql("PRAGMA foreign_key_check").fetchall():
        raise RuntimeError("Foreign-key violations after warehouse receipt migration")


def downgrade():
    raise RuntimeError("Restore a verified backup; warehouse stock origins must not be discarded by downgrade.")
