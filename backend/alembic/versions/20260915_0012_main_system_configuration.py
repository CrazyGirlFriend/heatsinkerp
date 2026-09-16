"""Encrypted administrator-managed main-system connection; no inventory changes."""
from alembic import op
import sqlalchemy as sa

revision = "20260915_0012"
down_revision = "20260912_0011"
branch_labels = None
depends_on = None


def upgrade():
    # Historical initial migration creates current metadata on an empty DB.
    if "main_system_configuration" not in sa.inspect(op.get_bind()).get_table_names():
        op.create_table("main_system_configuration",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("enabled", sa.Boolean(), nullable=False),
            sa.Column("base_url", sa.String(500), nullable=False),
            sa.Column("token_ciphertext", sa.Text()),
            sa.Column("timeout_seconds", sa.Numeric(4, 1), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("updated_by", sa.String(160), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.Column("last_test_at", sa.DateTime()),
            sa.Column("last_test_ok", sa.Boolean()),
            sa.Column("last_test_message", sa.String(300)),
            sa.CheckConstraint("id = 1", name="ck_main_system_configuration_singleton"))
    required = {"id", "enabled", "base_url", "token_ciphertext", "timeout_seconds", "version",
                "updated_by", "updated_at", "last_test_at", "last_test_ok", "last_test_message"}
    if not required <= {c["name"] for c in sa.inspect(op.get_bind()).get_columns("main_system_configuration")}:
        raise RuntimeError("Unexpected main-system configuration table definition")


def downgrade():
    raise RuntimeError("Preserve configuration and encrypted credentials; restore a verified backup if needed.")
