"""Preserve worker identity, processing date and actual daily output."""

import sqlalchemy as sa
from alembic import op

revision = "20261019_0038"
down_revision = "20261013_0037"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("material_quantity_adjustments")}
    foreign_keys = {
        tuple(key["constrained_columns"])
        for key in inspector.get_foreign_keys("material_quantity_adjustments")
    }
    indexes = {key["name"] for key in inspector.get_indexes("material_quantity_adjustments")}
    fields = {
        "processor_employee_id": sa.Integer(),
        "processing_date": sa.Date(),
        "processing_mode": sa.String(16),
        "input_quantity": sa.Integer(),
        "completed_quantity": sa.Integer(),
        "scrap_quantity": sa.Integer(),
        "input_weight": sa.Numeric(17, 6),
        "completed_weight": sa.Numeric(17, 6),
        "scrap_weight": sa.Numeric(17, 6),
    }
    with op.batch_alter_table("material_quantity_adjustments") as batch:
        for name, kind in fields.items():
            if name not in columns:
                batch.add_column(sa.Column(name, kind, nullable=True))
        if ("processor_employee_id",) not in foreign_keys:
            batch.create_foreign_key(
                "fk_mqa_processor",
                "team_employees",
                ["processor_employee_id"],
                ["id"],
                ondelete="RESTRICT",
            )
        if "ix_mqa_team_day_worker" not in indexes:
            batch.create_index(
                "ix_mqa_team_day_worker", ["team_id", "processing_date", "processor_employee_id"]
            )
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("material_transfers")}
    if "sent_processing_status" not in columns:
        op.add_column(
            "material_transfers", sa.Column("sent_processing_status", sa.String(20), nullable=True)
        )


def downgrade():
    raise RuntimeError("Preserve actual worker and production history on rollback")
