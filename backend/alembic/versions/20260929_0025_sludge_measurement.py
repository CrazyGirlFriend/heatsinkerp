"""Keep measured sludge weight and content percentage without revaluing old stock."""
import sqlalchemy as sa
from alembic import op

revision = "20260929_0025"
down_revision = "20260928_0024"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("material_transfers") as batch:
        batch.add_column(sa.Column("sludge_gross_weight", sa.Numeric(14, 3), nullable=True))
        batch.add_column(sa.Column("sludge_content_percent", sa.Numeric(5, 2), nullable=True))
        batch.create_check_constraint("ck_mt_sludge_measurement",
            "(sludge_gross_weight IS NULL AND sludge_content_percent IS NULL) OR "
            "(material_type IS NOT NULL AND material_type = 'sludge' AND sludge_gross_weight IS NOT NULL AND sludge_content_percent IS NOT NULL "
            "AND sludge_gross_weight > 0 AND sludge_content_percent > 0 AND sludge_content_percent <= 100)")


def downgrade():
    raise RuntimeError("Sludge measurements are audit data; retain them when rolling back application code")
