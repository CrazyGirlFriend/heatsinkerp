"""On-site inspection records and explicit passing rechecks."""

import sqlalchemy as sa
from alembic import op

revision = "20261019_0039"
down_revision = "20261019_0038"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("material_inspections"):
        op.create_table(
            "material_inspections",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "processing_record_id",
                sa.Integer(),
                sa.ForeignKey("material_quantity_adjustments.id", ondelete="RESTRICT"),
            ),
            sa.Column("processor_name", sa.String(80)),
            sa.Column(
                "source_transfer_id",
                sa.Integer(),
                sa.ForeignKey("material_transfers.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column(
                "team_id",
                sa.Integer(),
                sa.ForeignKey("teams.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column(
                "inspection_team_id",
                sa.Integer(),
                sa.ForeignKey("teams.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column(
                "inspector_employee_id",
                sa.Integer(),
                sa.ForeignKey("team_employees.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("inspector_name", sa.String(80), nullable=False),
            sa.Column("checked_at", sa.DateTime(), nullable=False),
            sa.Column("batch_quantity", sa.Integer(), nullable=False),
            sa.Column("sample_quantity", sa.Integer(), nullable=False),
            sa.Column("failed_quantity", sa.Integer(), nullable=False),
            sa.Column("notes", sa.Text(), nullable=False),
            sa.Column(
                "parent_id",
                sa.Integer(),
                sa.ForeignKey("material_inspections.id", ondelete="RESTRICT"),
            ),
            sa.Column("released_at", sa.DateTime()),
            sa.Column("idempotency_key", sa.String(100), nullable=False, unique=True),
            sa.Column("request_hash", sa.String(64), nullable=False),
            sa.Column("created_by", sa.String(80), nullable=False),
            sa.Column(
                "created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")
            ),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.CheckConstraint(
                "sample_quantity > 0 AND failed_quantity >= 0 AND failed_quantity <= sample_quantity",
                name="ck_inspection_sample",
            ),
        )
    indexes = {
        item["name"] for item in sa.inspect(op.get_bind()).get_indexes("material_inspections")
    }
    for name, columns in (
        ("ix_inspection_team_checked", ["team_id", "checked_at", "id"]),
        ("ix_inspection_checked", ["checked_at", "id"]),
        ("ix_inspection_lot_hold", ["source_transfer_id", "parent_id", "released_at"]),
    ):
        if name not in indexes:
            op.create_index(name, "material_inspections", columns)


def downgrade():
    raise RuntimeError("Preserve inspection and release history")
