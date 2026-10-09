"""Allow audited same-team stock reallocations between serial numbers."""

from alembic import op

revision = "20261009_0028"
down_revision = "20261008_0027"
branch_labels = None
depends_on = None

SOURCE = (
    "(entry_kind IN ('transfer', 'warehouse_outbound', 'inspection_shipment') AND source_team_id IS NOT NULL AND source_team_code IS NOT NULL AND source_team_name IS NOT NULL) OR "
    "(entry_kind IN ('warehouse_receipt', 'opening_stock') AND source_team_id IS NULL AND source_team_code IS NULL AND source_team_name IS NULL "
    "AND source_transfer_id IS NULL AND dispatch_id IS NULL AND status = 'received' AND stock_tracked = 1) OR "
    "(entry_kind = 'serial_reallocation' AND source_team_id IS NOT NULL AND source_team_id = next_team_id AND source_team_code IS NOT NULL AND source_team_name IS NOT NULL "
    "AND source_transfer_id IS NOT NULL AND dispatch_id IS NULL AND status = 'received' AND stock_tracked = 1)"
)
DESTINATION = (
    "(entry_kind IN ('transfer', 'warehouse_receipt', 'opening_stock', 'serial_reallocation') AND next_team_id IS NOT NULL AND next_team_code IS NOT NULL AND next_team_name IS NOT NULL "
    "AND external_destination IS NULL AND status IN ('pending', 'received', 'voided')) OR "
    "(entry_kind IN ('warehouse_outbound', 'inspection_shipment') AND next_team_id IS NULL AND next_team_code IS NULL AND next_team_name IS NULL "
    "AND external_destination IS NOT NULL AND length(trim(external_destination)) > 0 AND source_transfer_id IS NOT NULL AND dispatch_id IS NOT NULL "
    "AND stock_tracked = 0 AND status IN ('pending', 'dispatched', 'voided'))"
)


def upgrade():
    with op.batch_alter_table("material_transfers") as batch:
        batch.drop_constraint("ck_mt_entry_kind_source", type_="check")
        batch.drop_constraint("ck_mt_entry_destination", type_="check")
        batch.create_check_constraint("ck_mt_entry_kind_source", SOURCE)
        batch.create_check_constraint("ck_mt_entry_destination", DESTINATION)


def downgrade():
    raise RuntimeError("Serial reallocations must retain their stock and source batch links")
