"""Warehouse receipt provenance and receiver review, preserving historical rows."""
from alembic import op
import sqlalchemy as sa

revision = "20260916_0013"
down_revision = "20260915_0012"
branch_labels = None
depends_on = None


def upgrade():
    existing = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("material_transfers")}
    for name, kind in (("receipt_kind", sa.String(16)), ("external_source", sa.String(240)),
                       ("return_dispatch_no", sa.String(40)), ("rejection_reason", sa.Text())):
        if name not in existing:
            op.add_column("material_transfers", sa.Column(name, kind, nullable=True))


def downgrade():
    raise RuntimeError("Preserve receipt provenance and review history; do not discard these columns.")
