"""Record processing progress and actual specifications without rewriting receipts."""
import sqlalchemy as sa
from alembic import op

revision = "20261010_0031"
down_revision = "20261009_0030"
branch_labels = None
depends_on = None


def upgrade():
    table = "material_quantity_adjustments"
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns(table)}
    checks = {check["name"]: check["sqltext"] for check in inspector.get_check_constraints(table)}
    if "processing_status" in checks.get("ck_mqa_changed", ""):
        return
    with op.batch_alter_table(table) as batch:
        for name, length in (("processing_status", 20), ("before_specification", 240), ("after_specification", 240)):
            if name not in columns:
                batch.add_column(sa.Column(name, sa.String(length), nullable=True))
        if "ck_mqa_changed" in checks:
            batch.drop_constraint("ck_mqa_changed", type_="check")
        batch.create_check_constraint("ck_mqa_changed",
            "before_quantity != after_quantity OR processing_status IS NOT NULL OR coalesce(before_specification, '') != coalesce(after_specification, '')")


def downgrade():
    raise RuntimeError("Preserve processing registrations and specifications on application rollback")
