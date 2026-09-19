"""Team-owned transfer purposes and separately authorized opening stock."""
from alembic import op
import sqlalchemy as sa

revision = "20260918_0015"
down_revision = "20260918_0014"
branch_labels = None
depends_on = None

CHECKS = {
    "ck_mt_entry_kind_source": (
        "(entry_kind IN ('transfer', 'warehouse_outbound', 'inspection_shipment') AND source_team_id IS NOT NULL AND source_team_code IS NOT NULL AND source_team_name IS NOT NULL) OR "
        "(entry_kind IN ('warehouse_receipt', 'opening_stock') AND source_team_id IS NULL AND source_team_code IS NULL AND source_team_name IS NULL "
        "AND source_transfer_id IS NULL AND dispatch_id IS NULL AND status = 'received' AND stock_tracked = 1)"
    ),
    "ck_mt_entry_destination": (
        "(entry_kind IN ('transfer', 'warehouse_receipt', 'opening_stock') AND next_team_id IS NOT NULL AND next_team_code IS NOT NULL AND next_team_name IS NOT NULL "
        "AND external_destination IS NULL AND status IN ('pending', 'received', 'voided')) OR "
        "(entry_kind IN ('warehouse_outbound', 'inspection_shipment') AND next_team_id IS NULL AND next_team_code IS NULL AND next_team_name IS NULL "
        "AND external_destination IS NOT NULL AND length(trim(external_destination)) > 0 AND source_transfer_id IS NOT NULL AND dispatch_id IS NOT NULL "
        "AND stock_tracked = 0 AND status IN ('pending', 'dispatched', 'voided'))"
    ),
}


def upgrade():
    bind = op.get_bind()
    if bind.dialect.name == "sqlite" and bind.exec_driver_sql("PRAGMA foreign_keys").scalar():
        raise RuntimeError("SQLite upgrade requires foreign_keys=OFF; verify foreign_key_check afterward")
    tables = sa.inspect(bind).get_table_names()
    if "team_purposes" not in tables:
        op.create_table("team_purposes", sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("team_id", sa.Integer(), sa.ForeignKey("teams.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("name", sa.String(80), nullable=False), sa.Column("active", sa.Boolean(), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False), sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("team_id", "name", name="uq_team_purpose_name"))
        op.create_index("ix_team_purposes_team_id", "team_purposes", ["team_id"])
    if "team_setting_events" not in tables:
        op.create_table("team_setting_events", sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("team_id", sa.Integer(), sa.ForeignKey("teams.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("action", sa.String(40), nullable=False), sa.Column("actor", sa.String(80), nullable=False),
            sa.Column("changes", sa.JSON(), nullable=False), sa.Column("created_at", sa.DateTime(), nullable=False))
        op.create_index("ix_team_setting_events_team_id", "team_setting_events", ["team_id"])
    if "opening_stock_submissions" not in tables:
        op.create_table("opening_stock_submissions", sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("team_id", sa.Integer(), sa.ForeignKey("teams.id", ondelete="RESTRICT"), nullable=False, unique=True),
            sa.Column("idempotency_key", sa.String(100), nullable=False, unique=True),
            sa.Column("request_hash", sa.String(64), nullable=False), sa.Column("created_by", sa.String(80), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False))
    if "opening_stock_enabled" not in {c["name"] for c in sa.inspect(bind).get_columns("teams")}:
        op.add_column("teams", sa.Column("opening_stock_enabled", sa.Boolean(), nullable=False, server_default="0"))
    columns = {c["name"] for c in sa.inspect(bind).get_columns("material_transfers")}
    checks = {c["name"]: c["sqltext"] for c in sa.inspect(bind).get_check_constraints("material_transfers")}
    with op.batch_alter_table("material_transfers") as batch:
        if "purpose_id" not in columns:
            batch.add_column(sa.Column("purpose_id", sa.Integer()))
            batch.create_foreign_key("fk_mt_purpose", "team_purposes", ["purpose_id"], ["id"], ondelete="RESTRICT")
        if "purpose_name" not in columns:
            batch.add_column(sa.Column("purpose_name", sa.String(80)))
        if "opening_stock_id" not in columns:
            batch.add_column(sa.Column("opening_stock_id", sa.Integer()))
            batch.create_foreign_key("fk_mt_opening_stock", "opening_stock_submissions", ["opening_stock_id"], ["id"], ondelete="RESTRICT")
            batch.create_index("ix_material_transfers_opening_stock_id", ["opening_stock_id"])
        for name, expression in CHECKS.items():
            if "opening_stock" not in checks.get(name, ""):
                if name in checks:
                    batch.drop_constraint(name, type_="check")
                batch.create_check_constraint(name, expression)
    indexes = {i["name"] for i in sa.inspect(bind).get_indexes("material_transfers")}
    for name, fields in {
        "ix_mt_team_serial_purpose": ["next_team_id", "serial_no", "purpose_id", "received_at"],
        "ix_mt_source_serial_created": ["source_team_id", "serial_no", "created_at"],
    }.items():
        if name not in indexes:
            op.create_index(name, "material_transfers", fields)
    if bind.dialect.name == "sqlite" and bind.exec_driver_sql("PRAGMA foreign_key_check").fetchall():
        raise RuntimeError("Foreign-key violations after opening stock migration")


def downgrade():
    raise RuntimeError("Restore a verified backup; opening stock and purpose history must be preserved.")
