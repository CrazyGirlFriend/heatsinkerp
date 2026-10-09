"""Retain measured material mass down to one milligram without revaluing history."""
import sqlalchemy as sa
from alembic import op

revision = "20261009_0030"
down_revision = "20261009_0029"
branch_labels = None
depends_on = None

MASS_COLUMNS = {
    "material_transfers": ("weight", "sludge_gross_weight"),
    "material_stock_balances": tuple(f"{prefix}_weight" for prefix in (
        "received", "on_hand", "reserved", "in_transit", "dispatched", "lost")),
    "material_losses": ("weight",),
    "material_quantity_adjustments": ("weight_snapshot",),
    "warehouse_placements": ("weight",),
}


def upgrade():
    connection = op.get_bind()
    for table, names in MASS_COLUMNS.items():
        columns = {item["name"]: item for item in sa.inspect(connection).get_columns(table)}
        changed = [name for name in names if columns[name]["type"].scale != 6]
        checks = {item["name"]: item["sqltext"] for item in sa.inspect(connection).get_check_constraints(table)}
        reconcile = table == "material_stock_balances" and "round(received_weight, 6)" not in checks.get("ck_msb_reconcile_weight", "")
        if not changed and not reconcile:
            continue
        with op.batch_alter_table(table) as batch:
            for name in changed:
                batch.alter_column(name, existing_type=columns[name]["type"], type_=sa.Numeric(17, 6),
                    existing_nullable=columns[name]["nullable"])
            if reconcile:
                if "ck_msb_reconcile_weight" in checks:
                    batch.drop_constraint("ck_msb_reconcile_weight", type_="check")
                batch.create_check_constraint("ck_msb_reconcile_weight",
                    "round(received_weight, 6) = round(on_hand_weight + reserved_weight + dispatched_weight + lost_weight, 6)")


def downgrade():
    raise RuntimeError("Retain precise material measurements when rolling back application images")
