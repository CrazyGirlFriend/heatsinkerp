"""Independent batch identities; preserve historical CK references."""
from alembic import op
import sqlalchemy as sa

revision = "20260918_0014"
down_revision = "20260916_0013"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("material_dispatches") as batch:
        batch.alter_column("dispatch_no", existing_type=sa.String(32), nullable=True)


def downgrade():
    raise RuntimeError("Independent submissions have no CK number; preserve batch identities.")
