"""Allow signed book stock while retaining ledger reconciliation and audit data."""

from alembic import op
import sqlalchemy as sa

revision = "20261008_0026"
down_revision = "20260929_0025"
branch_labels = None
depends_on = None


def upgrade():
    # Check names also make a resumed MySQL DDL migration safe after interruption.
    bind = op.get_bind()
    stock_checks = {
        c["name"] for c in sa.inspect(bind).get_check_constraints("material_stock_balances")
    }
    with op.batch_alter_table("material_stock_balances") as batch:
        for name in ("ck_msb_on_hand_quantity", "ck_msb_on_hand_weight"):
            if name in stock_checks:
                batch.drop_constraint(name, type_="check")
    checks = {
        c["name"]: c
        for c in sa.inspect(bind).get_check_constraints("material_quantity_adjustments")
    }
    with op.batch_alter_table("material_quantity_adjustments") as batch:
        for name in ("ck_mqa_quantities", "ck_mqa_weight"):
            if name in checks:
                batch.drop_constraint(name, type_="check")
        batch.create_check_constraint("ck_mqa_quantities", "after_quantity >= 0")


def downgrade():
    raise RuntimeError(
        "Signed stock and audit snapshots cannot be reverted without resolving book shortages"
    )
