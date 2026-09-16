"""Serial-level urgency and immutable administrative audit; stock is untouched."""
from alembic import op
import sqlalchemy as sa

revision = "20260912_0011"
down_revision = "20260907_0010"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    tables = sa.inspect(bind).get_table_names()
    # The historical baseline uses current metadata on a fresh database.
    # Preserve tables it already created, and support retry after MySQL DDL.
    if "serial_urgencies" not in tables:
        op.create_table("serial_urgencies",
            sa.Column("serial_no", sa.String(80), primary_key=True),
            sa.Column("urgent", sa.Boolean(), nullable=False),
            sa.Column("reason", sa.String(500)),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("updated_by", sa.String(80), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False))
    if "serial_urgency_events" not in tables:
        op.create_table("serial_urgency_events",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("serial_no", sa.String(80), nullable=False),
            sa.Column("urgent", sa.Boolean(), nullable=False),
            sa.Column("reason", sa.String(500)),
            sa.Column("actor", sa.String(80), nullable=False),
            sa.Column("actor_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
            sa.Column("occurred_at", sa.DateTime(), nullable=False))
    for table, required in (
        ("serial_urgencies", {"serial_no", "urgent", "reason", "version", "updated_by", "updated_at"}),
        ("serial_urgency_events", {"id", "serial_no", "urgent", "reason", "actor", "actor_id", "occurred_at"}),
    ):
        if not required <= {column["name"] for column in sa.inspect(bind).get_columns(table)}:
            raise RuntimeError(f"Unexpected existing table definition: {table}")
    for table, name, columns in (
        ("serial_urgencies", "ix_su_urgent_serial", ["urgent", "serial_no"]),
        ("serial_urgency_events", "ix_sue_serial_time", ["serial_no", "occurred_at", "id"]),
    ):
        indexes = {index["name"]: index["column_names"] for index in sa.inspect(bind).get_indexes(table)}
        if name not in indexes:
            op.create_index(name, table, columns)
        elif indexes[name] != columns:
            raise RuntimeError(f"Unexpected existing index definition: {name}")


def downgrade():
    raise RuntimeError("Restore a verified backup; urgency audit must not be discarded.")
