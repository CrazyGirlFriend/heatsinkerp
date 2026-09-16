"""Batch barcode confirmations without rewriting historical lines or numbers.

Revision ID: 20260907_0010
Revises: 20260907_0009
"""
from alembic import op
import sqlalchemy as sa

revision = "20260907_0010"
down_revision = "20260907_0009"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    table = "material_dispatches"
    inspector = sa.inspect(bind)
    columns = {c["name"] for c in inspector.get_columns(table)}
    has_fk = any(f["constrained_columns"] == ["confirmed_by_user_id"] for f in inspector.get_foreign_keys(table))
    has_unique = any(u["column_names"] == ["confirmation_idempotency_key"] for u in inspector.get_unique_constraints(table))
    if bind.dialect.name == "sqlite" and (not has_fk or not has_unique) and bind.exec_driver_sql("PRAGMA foreign_keys").scalar():
        raise RuntimeError("SQLite upgrade requires foreign_keys=OFF before the migration transaction; run foreign_key_check afterward")
    with op.batch_alter_table(table) as batch:
        for name, type_ in (
            ("confirmation_idempotency_key", sa.String(100)), ("confirmed_revision", sa.String(64)),
            ("confirmed_by", sa.String(80)), ("confirmed_by_user_id", sa.Integer()), ("confirmed_at", sa.DateTime()),
        ):
            if name not in columns:
                batch.add_column(sa.Column(name, type_, nullable=True))
        if not has_fk:
            batch.create_foreign_key("fk_md_confirmed_user", "users", ["confirmed_by_user_id"], ["id"], ondelete="SET NULL")
        if not has_unique:
            batch.create_unique_constraint("uq_md_confirmation_key", ["confirmation_idempotency_key"])
    if bind.dialect.name == "sqlite" and bind.exec_driver_sql("PRAGMA foreign_key_check").fetchall():
        raise RuntimeError("Foreign-key violations after batch confirmation migration")


def downgrade():
    raise RuntimeError("Restore a verified backup; batch confirmation history must not be discarded by downgrade.")
