"""Attach processing work and its output lots to delivery commitments."""

import sqlalchemy as sa
from alembic import op

revision = "20261026_0056"
down_revision = "20261026_0055"
branch_labels = None
depends_on = None

TABLES = (
    ("material_transfers", "processing_schedule_id", "fk_mt_processing_schedule"),
    ("material_quantity_adjustments", "production_schedule_id", "fk_mqa_production_schedule"),
)


def upgrade():
    if "final_due_at" not in {
        c["name"] for c in sa.inspect(op.get_bind()).get_columns("production_schedule_tasks")
    }:
        op.add_column(
            "production_schedule_tasks", sa.Column("final_due_at", sa.DateTime(), nullable=True)
        )
        op.execute(
            sa.text(
                "UPDATE production_schedule_tasks SET final_due_at = (SELECT due_at FROM production_schedules WHERE task_id = production_schedule_tasks.id ORDER BY CASE WHEN cancelled_at IS NULL THEN 0 ELSE 1 END, sequence_no DESC, id DESC LIMIT 1)"
            )
        )
    for table, column, constraint in TABLES:
        if column in {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}:
            continue
        with op.batch_alter_table(table) as batch:
            batch.add_column(sa.Column(column, sa.Integer(), nullable=True))
            batch.create_foreign_key(
                constraint, "production_schedules", [column], ["id"], ondelete="RESTRICT"
            )
            batch.create_index(f"ix_{table}_{column}", [column])


def downgrade():
    op.drop_column("production_schedule_tasks", "final_due_at")
    for table, column, constraint in reversed(TABLES):
        with op.batch_alter_table(table) as batch:
            batch.drop_index(f"ix_{table}_{column}")
            batch.drop_constraint(constraint, type_="foreignkey")
            batch.drop_column(column)
