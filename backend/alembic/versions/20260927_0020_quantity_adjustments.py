"""Preserve signed receipts; reconcile processing piece changes separately."""
import sqlalchemy as sa
from alembic import op

revision = "20260927_0020"
down_revision = "20260926_0019"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    columns = {col["name"] for col in sa.inspect(connection).get_columns("material_stock_balances")}
    if "adjusted_quantity" not in columns:
        with op.batch_alter_table("material_stock_balances") as batch:
            batch.add_column(sa.Column("adjusted_quantity", sa.Integer(), nullable=False, server_default="0"))
            batch.add_column(sa.Column("revision", sa.Integer(), nullable=False, server_default="0"))
            batch.drop_constraint("ck_msb_reconcile_quantity", type_="check")
            batch.create_check_constraint("ck_msb_reconcile_quantity",
                "received_quantity + adjusted_quantity = on_hand_quantity + reserved_quantity + dispatched_quantity + lost_quantity")
    if "material_quantity_adjustments" not in sa.inspect(connection).get_table_names():
        op.create_table("material_quantity_adjustments",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("source_transfer_id", sa.Integer(), sa.ForeignKey("material_transfers.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("team_id", sa.Integer(), sa.ForeignKey("teams.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("before_quantity", sa.Integer(), nullable=False),
            sa.Column("after_quantity", sa.Integer(), nullable=False),
            sa.Column("weight_snapshot", sa.Numeric(14, 3), nullable=False),
            sa.Column("stock_revision_before", sa.Integer(), nullable=False),
            sa.Column("reason", sa.Text(), nullable=False),
            sa.Column("idempotency_key", sa.String(100), nullable=False, unique=True),
            sa.Column("request_hash", sa.String(64), nullable=False),
            sa.Column("created_by", sa.String(80), nullable=False),
            sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.CheckConstraint("before_quantity >= 0 AND after_quantity >= 0", name="ck_mqa_quantities"),
            sa.CheckConstraint("before_quantity != after_quantity", name="ck_mqa_changed"),
            sa.CheckConstraint("weight_snapshot >= 0", name="ck_mqa_weight"))
        op.create_index("ix_mqa_lot_created", "material_quantity_adjustments", ["source_transfer_id", "created_at", "id"])


def downgrade():
    raise RuntimeError("Retain piece-change records and balances when rolling back application images")
