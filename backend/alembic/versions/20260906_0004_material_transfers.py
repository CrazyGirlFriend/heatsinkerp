"""Add process-independent material transfers without changing legacy flow data.

Revision ID: 20260906_0004
Revises: 20260905_0003
"""

from alembic import op
import sqlalchemy as sa


revision = "20260906_0004"
down_revision = "20260905_0003"
branch_labels = None
depends_on = None


def _inspector():
    return sa.inspect(op.get_bind())


def _has_index(table: str, columns: list[str], *, unique: bool | None = None) -> bool:
    return any(
        index["column_names"] == columns
        and (unique is None or bool(index["unique"]) is unique)
        for index in _inspector().get_indexes(table)
    )


def _ensure_index(
    table: str, name: str, columns: list[str], *, unique: bool = False
) -> None:
    if not _has_index(table, columns, unique=unique):
        op.create_index(name, table, columns, unique=unique)


def upgrade() -> None:
    if "material_transfers" not in _inspector().get_table_names():
        op.create_table(
            "material_transfers",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("batch_no", sa.String(32), nullable=False),
            sa.Column("serial_no", sa.String(80), nullable=False),
            sa.Column("source_team_id", sa.Integer(), nullable=False),
            sa.Column("source_team_code", sa.String(64), nullable=False),
            sa.Column("source_team_name", sa.String(120), nullable=False),
            sa.Column("next_team_id", sa.Integer(), nullable=False),
            sa.Column("next_team_code", sa.String(64), nullable=False),
            sa.Column("next_team_name", sa.String(120), nullable=False),
            sa.Column("quantity", sa.Integer(), nullable=False),
            sa.Column("weight", sa.Numeric(14, 3), nullable=False),
            sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("idempotency_key", sa.String(100), nullable=True),
            sa.Column("request_hash", sa.String(64), nullable=True),
            sa.Column("created_by", sa.String(80), nullable=False),
            sa.Column("created_by_user_id", sa.Integer(), nullable=True),
            sa.Column("received_by", sa.String(80), nullable=True),
            sa.Column("received_by_user_id", sa.Integer(), nullable=True),
            sa.Column("receipt_idempotency_key", sa.String(100), nullable=True),
            sa.Column("received_at", sa.DateTime(), nullable=True),
            sa.Column("voided_by", sa.String(80), nullable=True),
            sa.Column("voided_by_user_id", sa.Integer(), nullable=True),
            sa.Column("voided_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.CheckConstraint("quantity > 0", name="ck_material_transfers_quantity_positive"),
            sa.CheckConstraint("weight > 0", name="ck_material_transfers_weight_positive"),
            sa.ForeignKeyConstraint(["source_team_id"], ["teams.id"], ondelete="RESTRICT"),
            sa.ForeignKeyConstraint(["next_team_id"], ["teams.id"], ondelete="RESTRICT"),
            sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["received_by_user_id"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["voided_by_user_id"], ["users.id"], ondelete="SET NULL"),
            sa.UniqueConstraint("batch_no", name="uq_material_transfers_batch_no"),
            sa.UniqueConstraint(
                "idempotency_key", name="uq_material_transfers_idempotency_key"
            ),
            sa.UniqueConstraint(
                "receipt_idempotency_key",
                name="uq_material_transfers_receipt_idempotency_key",
            ),
        )

    for name, columns, unique in (
        ("ix_material_transfers_batch_no", ["batch_no"], True),
        ("ix_material_transfers_serial_no", ["serial_no"], False),
        ("ix_material_transfers_source_team_id", ["source_team_id"], False),
        ("ix_material_transfers_next_team_id", ["next_team_id"], False),
        ("ix_material_transfers_status", ["status"], False),
        ("ix_material_transfers_created_by_user_id", ["created_by_user_id"], False),
        ("ix_material_transfers_received_by_user_id", ["received_by_user_id"], False),
        ("ix_material_transfers_voided_by_user_id", ["voided_by_user_id"], False),
        ("ix_material_transfers_serial_created", ["serial_no", "created_at"], False),
        ("ix_material_transfers_source_status", ["source_team_id", "status"], False),
        ("ix_material_transfers_next_status", ["next_team_id", "status"], False),
    ):
        _ensure_index("material_transfers", name, columns, unique=unique)

    if op.get_bind().dialect.name == "sqlite":
        violations = op.get_bind().exec_driver_sql("PRAGMA foreign_key_check").fetchall()
        if violations:
            raise RuntimeError("Foreign-key violations found after material-transfer migration")


def downgrade() -> None:
    raise RuntimeError(
        "Material transfer audit rows cannot be safely downgraded in place. "
        "Restore a verified pre-upgrade backup instead."
    )

