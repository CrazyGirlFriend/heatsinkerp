"""Separate physical slot allocation from document history and inventory ownership."""

import sqlalchemy as sa
from alembic import op

revision = "20260928_0024"
down_revision = "20260928_0023"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    # Initialize exactly once. Re-running must not restore historic locations
    # after returns have intentionally become unassigned.
    if "warehouse_placements" in sa.inspect(connection).get_table_names():
        return
    op.create_table(
        "warehouse_placements",
        sa.Column(
            "location_id",
            sa.Integer(),
            sa.ForeignKey("warehouse_locations.id", ondelete="RESTRICT"),
            primary_key=True,
        ),
        sa.Column(
            "transfer_id",
            sa.Integer(),
            sa.ForeignKey("material_transfers.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("weight", sa.Numeric(14, 3), nullable=False),
        sa.CheckConstraint("quantity >= 0 AND weight >= 0", name="ck_wp_nonnegative"),
    )
    op.create_index("ix_wp_transfer", "warehouse_placements", ["transfer_id"])
    # External pending stock has not physically left. Internal pending has.
    # Preserve legacy shared slots; new claims remain forbidden until empty.
    connection.execute(
        sa.text("""INSERT INTO warehouse_placements (location_id, transfer_id, quantity, weight)
        SELECT w.id, m.id,
          CASE WHEN m.status='pending' THEN m.quantity ELSE b.on_hand_quantity+b.reserved_quantity-b.in_transit_quantity END,
          CASE WHEN m.status='pending' THEN m.weight ELSE b.on_hand_weight+b.reserved_weight-b.in_transit_weight END
        FROM warehouse_locations w JOIN material_transfers m ON m.next_team_id=w.team_id AND m.warehouse_location=w.name
        LEFT JOIN material_stock_balances b ON b.transfer_id=m.id
        WHERE m.status='pending' OR (m.status='received' AND
          (b.on_hand_quantity+b.reserved_quantity-b.in_transit_quantity>0 OR b.on_hand_weight+b.reserved_weight-b.in_transit_weight>0))
    """)
    )


def downgrade():
    raise RuntimeError(
        "Physical locations cannot be reconstructed from historical document names; retain placement records"
    )
