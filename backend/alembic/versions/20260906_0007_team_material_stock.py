"""Tracked received lots, atomic dispatches and append-only material losses.

Revision ID: 20260906_0007
Revises: 20260906_0006
"""
from alembic import op
import sqlalchemy as sa

revision = "20260906_0007"
down_revision = "20260906_0006"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    tables = sa.inspect(bind).get_table_names()
    if "material_dispatches" not in tables:
        op.create_table("material_dispatches",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("dispatch_no", sa.String(32), nullable=False, unique=True),
            sa.Column("source_team_id", sa.Integer(), sa.ForeignKey("teams.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("next_team_id", sa.Integer(), sa.ForeignKey("teams.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("next_team_code", sa.String(64), nullable=False),
            sa.Column("next_team_name", sa.String(120), nullable=False),
            sa.Column("notes", sa.Text()),
            sa.Column("idempotency_key", sa.String(100), nullable=False, unique=True),
            sa.Column("request_hash", sa.String(64), nullable=False),
            sa.Column("created_by", sa.String(80), nullable=False),
            sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
    columns = {c["name"] for c in sa.inspect(bind).get_columns("material_transfers")}
    foreign_keys = {tuple(fk["constrained_columns"]): fk for fk in sa.inspect(bind).get_foreign_keys("material_transfers")}
    with op.batch_alter_table("material_transfers") as batch:
        if "stock_tracked" not in columns:
            batch.add_column(sa.Column("stock_tracked", sa.Boolean(), nullable=False, server_default=sa.false()))
        if "source_transfer_id" not in columns:
            batch.add_column(sa.Column("source_transfer_id", sa.Integer()))
        if "dispatch_id" not in columns:
            batch.add_column(sa.Column("dispatch_id", sa.Integer()))
        # MySQL DDL can commit a column before a later FK statement fails.
        # A retry must repair that partially applied migration as well.
        for column, target, name in (("source_transfer_id", "material_transfers", "fk_mt_source_transfer"),
                                     ("dispatch_id", "material_dispatches", "fk_mt_dispatch")):
            existing = foreign_keys.get((column,))
            if existing is None:
                batch.create_foreign_key(name, target, [column], ["id"], ondelete="RESTRICT")
            elif existing["referred_table"] != target or existing["referred_columns"] != ["id"]:
                raise RuntimeError(f"Unexpected existing foreign key for {column}")
    if "material_losses" not in tables:
        op.create_table("material_losses",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("loss_no", sa.String(32), nullable=False, unique=True),
            sa.Column("source_transfer_id", sa.Integer(), sa.ForeignKey("material_transfers.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("team_id", sa.Integer(), sa.ForeignKey("teams.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("quantity", sa.Integer(), nullable=False),
            sa.Column("weight", sa.Numeric(14, 3), nullable=False),
            sa.Column("reason", sa.Text(), nullable=False),
            sa.Column("idempotency_key", sa.String(100), nullable=False, unique=True),
            sa.Column("request_hash", sa.String(64), nullable=False),
            sa.Column("created_by", sa.String(80), nullable=False),
            sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.CheckConstraint("quantity >= 0", name="ck_ml_quantity"),
            sa.CheckConstraint("weight >= 0", name="ck_ml_weight"),
            sa.CheckConstraint("quantity > 0 OR weight > 0", name="ck_ml_nonempty"),
        )
    for table, name, cols in (
        ("material_dispatches", "ix_md_team_created", ["source_team_id", "created_at", "id"]),
        ("material_transfers", "ix_material_transfers_dispatch_id", ["dispatch_id"]),
        ("material_transfers", "ix_mt_stock_lot", ["next_team_id", "status", "stock_tracked", "received_at", "id"]),
        ("material_transfers", "ix_mt_stock_source_status", ["source_transfer_id", "status"]),
        ("material_losses", "ix_ml_team_created", ["team_id", "created_at", "id"]),
        ("material_losses", "ix_ml_lot_created", ["source_transfer_id", "created_at", "id"]),
    ):
        existing = {index["name"]: index["column_names"] for index in sa.inspect(bind).get_indexes(table)}
        if name not in existing:
            op.create_index(name, table, cols)
        elif existing[name] != cols:
            raise RuntimeError(f"Unexpected existing index definition: {name}")
    if bind.dialect.name == "sqlite" and bind.exec_driver_sql("PRAGMA foreign_key_check").fetchall():
        raise RuntimeError("Foreign-key violations after stock migration")


def downgrade():
    raise RuntimeError("Restore a verified backup; stock history must not be discarded by downgrade.")
