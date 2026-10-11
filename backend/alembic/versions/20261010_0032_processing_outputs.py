"""Split machining inventory into traceable outputs without restating old receipts."""

import sqlalchemy as sa
from alembic import op

revision = "20261010_0032"
down_revision = "20261010_0031"
branch_labels = None
depends_on = None


SOURCE = (
    "(entry_kind IN ('transfer', 'warehouse_outbound', 'inspection_shipment') AND source_team_id IS NOT NULL AND source_team_code IS NOT NULL AND source_team_name IS NOT NULL) OR "
    "(entry_kind IN ('warehouse_receipt', 'opening_stock') AND source_team_id IS NULL AND source_team_code IS NULL AND source_team_name IS NULL "
    "AND source_transfer_id IS NULL AND dispatch_id IS NULL AND status = 'received' AND stock_tracked = 1) OR "
    "(entry_kind IN ('serial_reallocation', 'processing_output') AND source_team_id IS NOT NULL AND source_team_id = next_team_id AND source_team_code IS NOT NULL AND source_team_name IS NOT NULL "
    "AND source_transfer_id IS NOT NULL AND dispatch_id IS NULL AND status = 'received' AND stock_tracked = 1)"
)
DESTINATION = (
    "(entry_kind IN ('transfer', 'warehouse_receipt', 'opening_stock', 'serial_reallocation', 'processing_output') AND next_team_id IS NOT NULL AND next_team_code IS NOT NULL AND next_team_name IS NOT NULL "
    "AND external_destination IS NULL AND status IN ('pending', 'received', 'voided')) OR "
    "(entry_kind IN ('warehouse_outbound', 'inspection_shipment') AND next_team_id IS NULL AND next_team_code IS NULL AND next_team_name IS NULL "
    "AND external_destination IS NOT NULL AND length(trim(external_destination)) > 0 AND source_transfer_id IS NOT NULL AND dispatch_id IS NOT NULL "
    "AND stock_tracked = 0 AND status IN ('pending', 'dispatched', 'voided'))"
)


def upgrade():
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("material_quantity_adjustments")}
    with op.batch_alter_table("material_quantity_adjustments") as batch:
        if "after_weight" not in columns:
            batch.add_column(sa.Column("after_weight", sa.Numeric(17, 6), nullable=True))
        if "outputs" not in columns:
            batch.add_column(sa.Column("outputs", sa.JSON(), nullable=True))
    columns = {c["name"] for c in inspector.get_columns("material_stock_balances")}
    checks = {
        c["name"]: c["sqltext"] for c in inspector.get_check_constraints("material_stock_balances")
    }
    with op.batch_alter_table("material_stock_balances") as batch:
        for name, kind in (
            ("converted_quantity", sa.Integer()),
            ("converted_weight", sa.Numeric(17, 6)),
        ):
            if name not in columns:
                batch.add_column(sa.Column(name, kind, nullable=False, server_default="0"))
        if "adjusted_weight" not in columns:
            batch.add_column(
                sa.Column("adjusted_weight", sa.Numeric(17, 6), nullable=False, server_default="0")
            )
        if "adjusted_weight" not in checks.get("ck_msb_reconcile_weight", ""):
            if "ck_msb_reconcile_weight" in checks:
                batch.drop_constraint("ck_msb_reconcile_weight", type_="check")
            batch.create_check_constraint(
                "ck_msb_reconcile_weight",
                "round(received_weight + adjusted_weight, 6) = round(on_hand_weight + reserved_weight + dispatched_weight + lost_weight, 6)",
            )
    columns = {c["name"] for c in inspector.get_columns("material_transfers")}
    checks = {
        c["name"]: c["sqltext"] for c in inspector.get_check_constraints("material_transfers")
    }
    with op.batch_alter_table("material_transfers") as batch:
        if "processing_role" not in columns:
            batch.add_column(sa.Column("processing_role", sa.String(16), nullable=True))
        # Extend the existing constraints; keep every historical entry kind.
        for name, updated in (
            ("ck_mt_entry_kind_source", SOURCE),
            ("ck_mt_entry_destination", DESTINATION),
        ):
            expression = checks.get(name, "")
            if "processing_output" not in expression:
                if expression:
                    batch.drop_constraint(name, type_="check")
                batch.create_check_constraint(name, updated)


def downgrade():
    raise RuntimeError("Preserve processing outputs and measured-weight history on rollback")
