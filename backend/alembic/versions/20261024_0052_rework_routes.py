"""Engineering-authored rework instructions linked to physical batches."""

import sqlalchemy as sa
from alembic import op

revision = "20261024_0052"
down_revision = "20261024_0051"
branch_labels = None
depends_on = None


CK_MT_ENTRY_KIND_SOURCE = "(entry_kind IN ('transfer', 'warehouse_outbound', 'inspection_shipment') AND source_team_id IS NOT NULL AND source_team_code IS NOT NULL AND source_team_name IS NOT NULL) OR (entry_kind IN ('warehouse_receipt', 'opening_stock') AND source_team_id IS NULL AND source_team_code IS NULL AND source_team_name IS NULL AND source_transfer_id IS NULL AND dispatch_id IS NULL AND status = 'received' AND stock_tracked = 1) OR (entry_kind IN ('serial_reallocation', 'processing_output', 'rework_split') AND source_team_id IS NOT NULL AND source_team_id = next_team_id AND source_team_code IS NOT NULL AND source_team_name IS NOT NULL AND source_transfer_id IS NOT NULL AND dispatch_id IS NULL AND status = 'received' AND stock_tracked = 1)"

CK_MT_ENTRY_DESTINATION = "(entry_kind IN ('transfer', 'warehouse_receipt', 'opening_stock', 'serial_reallocation', 'processing_output', 'rework_split') AND next_team_id IS NOT NULL AND next_team_code IS NOT NULL AND next_team_name IS NOT NULL AND external_destination IS NULL AND status IN ('pending', 'received', 'voided')) OR (entry_kind IN ('warehouse_outbound', 'inspection_shipment') AND next_team_id IS NULL AND next_team_code IS NULL AND next_team_name IS NULL AND external_destination IS NOT NULL AND length(trim(external_destination)) > 0 AND source_transfer_id IS NOT NULL AND dispatch_id IS NOT NULL AND stock_tracked = 0 AND status IN ('pending', 'dispatched', 'voided'))"


def upgrade():
    with op.batch_alter_table("process_routes") as batch:
        batch.add_column(
            sa.Column("route_kind", sa.String(16), nullable=False, server_default="normal")
        )
        batch.add_column(sa.Column("rework_source_transfer_id", sa.Integer()))
        batch.add_column(sa.Column("rework_of_id", sa.Integer()))
        batch.add_column(sa.Column("rework_inspection_id", sa.Integer()))
        batch.add_column(sa.Column("resume_route_id", sa.Integer()))
        batch.add_column(sa.Column("resume_step_index", sa.Integer()))
        batch.add_column(sa.Column("resume_step_complete", sa.Boolean()))
        batch.add_column(sa.Column("resume_team_id", sa.Integer()))
        batch.add_column(sa.Column("rework_round", sa.Integer()))
        batch.add_column(sa.Column("request_reason", sa.Text()))
        batch.add_column(sa.Column("request_key", sa.String(100)))
        batch.add_column(sa.Column("request_hash", sa.String(64)))
        batch.create_foreign_key(
            "fk_pr_rework_source",
            "material_transfers",
            ["rework_source_transfer_id"],
            ["id"],
            ondelete="RESTRICT",
        )
        batch.create_foreign_key(
            "fk_pr_rework_work",
            "material_quantity_adjustments",
            ["rework_of_id"],
            ["id"],
            ondelete="RESTRICT",
        )
        batch.create_foreign_key(
            "fk_pr_resume_route", "process_routes", ["resume_route_id"], ["id"], ondelete="RESTRICT"
        )
        batch.create_foreign_key(
            "fk_pr_resume_team", "teams", ["resume_team_id"], ["id"], ondelete="RESTRICT"
        )
        batch.create_foreign_key(
            "fk_pr_rework_inspection",
            "material_inspections",
            ["rework_inspection_id"],
            ["id"],
            ondelete="RESTRICT",
        )
        batch.create_unique_constraint("uq_pr_request_key", ["request_key"])
        batch.create_index(
            "ix_process_routes_rework_source_transfer_id", ["rework_source_transfer_id"]
        )
        batch.create_index("ix_pr_kind_updated", ["route_kind", "updated_at", "id"])
    with op.batch_alter_table("material_transfers") as batch:
        batch.drop_constraint("ck_mt_entry_destination", type_="check")
        batch.create_check_constraint("ck_mt_entry_destination", CK_MT_ENTRY_DESTINATION)
        batch.drop_constraint("ck_mt_entry_kind_source", type_="check")
        batch.create_check_constraint("ck_mt_entry_kind_source", CK_MT_ENTRY_KIND_SOURCE)
        batch.add_column(sa.Column("rework_route_id", sa.Integer()))
        batch.create_foreign_key(
            "fk_mt_rework_route", "process_routes", ["rework_route_id"], ["id"], ondelete="RESTRICT"
        )
        batch.create_index("ix_material_transfers_rework_route_id", ["rework_route_id"])
    policy = sa.table(
        "process_route_policy",
        sa.column("id", sa.Integer()),
        sa.column("enforced_after", sa.DateTime()),
    )
    if op.get_bind().execute(sa.select(policy.c.id).where(policy.c.id == 1)).first() is None:
        op.get_bind().execute(
            policy.insert().values(id=1, enforced_after=sa.func.current_timestamp())
        )


def downgrade():
    if (
        op.get_bind()
        .execute(
            sa.text("SELECT 1 FROM material_transfers WHERE entry_kind = 'rework_split' LIMIT 1")
        )
        .first()
    ):
        raise RuntimeError("已有返工数据，不能回退工艺关联迁移")
    with op.batch_alter_table("material_transfers") as batch:
        batch.drop_constraint("ck_mt_entry_kind_source", type_="check")
        batch.create_check_constraint(
            "ck_mt_entry_kind_source", CK_MT_ENTRY_KIND_SOURCE.replace(", 'rework_split'", "")
        )
        batch.drop_constraint("ck_mt_entry_destination", type_="check")
        batch.create_check_constraint(
            "ck_mt_entry_destination", CK_MT_ENTRY_DESTINATION.replace(", 'rework_split'", "")
        )
        batch.drop_index("ix_material_transfers_rework_route_id")
        batch.drop_constraint("fk_mt_rework_route", type_="foreignkey")
        batch.drop_column("rework_route_id")
    with op.batch_alter_table("process_routes") as batch:
        batch.drop_index("ix_pr_kind_updated")
        batch.drop_index("ix_process_routes_rework_source_transfer_id")
        batch.drop_constraint("uq_pr_request_key", type_="unique")
        for name in (
            "fk_pr_rework_inspection",
            "fk_pr_rework_source",
            "fk_pr_rework_work",
            "fk_pr_resume_route",
            "fk_pr_resume_team",
        ):
            batch.drop_constraint(name, type_="foreignkey")
        for name in (
            "route_kind",
            "rework_source_transfer_id",
            "rework_of_id",
            "rework_inspection_id",
            "resume_route_id",
            "resume_step_index",
            "resume_step_complete",
            "resume_team_id",
            "rework_round",
            "request_reason",
            "request_key",
            "request_hash",
        ):
            batch.drop_column(name)
