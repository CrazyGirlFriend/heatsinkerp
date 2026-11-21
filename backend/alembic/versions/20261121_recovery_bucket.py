"""Allow a weighed recovery bucket to leave the warehouse without a source lot."""

import sqlalchemy as sa
from alembic import op

revision = "20261121_recovery"
down_revision = "20261121_pooled_feeding"
branch_labels = None
depends_on = None

PREVIOUS = "(entry_kind IN ('transfer', 'warehouse_receipt', 'opening_stock', 'serial_reallocation', 'processing_output', 'rework_split') AND next_team_id IS NOT NULL AND next_team_code IS NOT NULL AND next_team_name IS NOT NULL AND external_destination IS NULL AND status IN ('pending', 'received', 'voided')) OR (entry_kind IN ('warehouse_outbound', 'inspection_shipment') AND next_team_id IS NULL AND next_team_code IS NULL AND next_team_name IS NULL AND external_destination IS NOT NULL AND length(trim(external_destination)) > 0 AND source_transfer_id IS NOT NULL AND dispatch_id IS NOT NULL AND stock_tracked = 0 AND status IN ('pending', 'dispatched', 'voided'))"
CURRENT = "(entry_kind IN ('transfer', 'warehouse_receipt', 'opening_stock', 'serial_reallocation', 'processing_output', 'rework_split') AND next_team_id IS NOT NULL AND next_team_code IS NOT NULL AND next_team_name IS NOT NULL AND external_destination IS NULL AND status IN ('pending', 'received', 'voided')) OR (entry_kind IN ('warehouse_outbound', 'inspection_shipment') AND next_team_id IS NULL AND next_team_code IS NULL AND next_team_name IS NULL AND external_destination IS NOT NULL AND length(trim(external_destination)) > 0 AND dispatch_id IS NOT NULL AND (source_transfer_id IS NOT NULL OR (entry_kind = 'warehouse_outbound' AND serial_no = '' AND quantity = 0 AND material_type IS NOT NULL AND material_type IN ('waste', 'slag', 'sludge', 'scrap_chips'))) AND stock_tracked = 0 AND status IN ('pending', 'dispatched', 'voided'))"


def replace_check(condition):
    with op.batch_alter_table("material_transfers") as batch:
        batch.drop_constraint("ck_mt_entry_destination", type_="check")
        batch.create_check_constraint("ck_mt_entry_destination", condition)


def upgrade():
    replace_check(CURRENT)


def downgrade():
    if (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT 1 FROM material_transfers WHERE entry_kind = 'warehouse_outbound' AND source_transfer_id IS NULL LIMIT 1"
            )
        )
        .first()
    ):
        raise RuntimeError("存在无来源批次的回收料出库单，旧版本无法保存这些单据")
    replace_check(PREVIOUS)
