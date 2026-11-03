"""Counterparty approval for corrections to received handoffs."""

import sqlalchemy as sa
from alembic import op

revision = "20261103_0064"
down_revision = "20261031_0063"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = inspector.get_table_names()
    checks = {
        item["name"]: item["sqltext"]
        for item in inspector.get_check_constraints("material_transfers")
    }
    if "processing_role" not in checks.get("ck_material_transfers_nonempty", ""):
        if bind.dialect.name == "sqlite" and bind.exec_driver_sql("PRAGMA foreign_keys").scalar():
            raise RuntimeError(
                "SQLite 表重建需先停止写入并关闭 foreign_keys，完成后执行 foreign_key_check"
            )
        with op.batch_alter_table("material_transfers") as batch:
            batch.drop_constraint("ck_material_transfers_nonempty", type_="check")
            batch.create_check_constraint(
                "ck_material_transfers_nonempty",
                "quantity > 0 OR weight > 0 OR (entry_kind = 'processing_output' "
                "AND processing_role = 'remaining' AND status = 'received')",
            )
    if "material_transfer_amendments" not in existing:
        op.create_table(
            "material_transfer_amendments",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "transfer_id",
                sa.Integer(),
                sa.ForeignKey("material_transfers.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column(
                "pending_transfer_id",
                sa.Integer(),
                sa.ForeignKey("material_transfers.id", ondelete="RESTRICT"),
            ),
            sa.Column("base_version", sa.Integer(), nullable=False),
            sa.Column(
                "requester_team_id",
                sa.Integer(),
                sa.ForeignKey("teams.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column(
                "counterparty_team_id",
                sa.Integer(),
                sa.ForeignKey("teams.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("requested_by", sa.String(80), nullable=False),
            sa.Column(
                "requested_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")
            ),
            sa.Column("before", sa.JSON(), nullable=False),
            sa.Column("after", sa.JSON(), nullable=False),
            sa.Column("reason", sa.Text(), nullable=False),
            sa.Column("status", sa.String(16), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("resolved_at", sa.DateTime()),
            sa.Column("resolved_by", sa.String(80)),
            sa.Column(
                "resolved_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")
            ),
            sa.Column("response_reason", sa.Text()),
            sa.UniqueConstraint("pending_transfer_id", name="uq_mta_pending_transfer"),
            sa.CheckConstraint(
                "(status = 'pending' AND pending_transfer_id IS NOT NULL AND pending_transfer_id = transfer_id) OR (status IN ('approved', 'rejected', 'cancelled') AND pending_transfer_id IS NULL)",
                name="ck_mta_pending",
            ),
        )
        op.create_index(
            "ix_mta_transfer_created",
            "material_transfer_amendments",
            ["transfer_id", "created_at", "id"],
        )
    if "transfer_amendment_notices" not in existing:
        op.create_table(
            "transfer_amendment_notices",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("event_key", sa.String(160), nullable=False, unique=True),
            sa.Column(
                "amendment_id",
                sa.Integer(),
                sa.ForeignKey("material_transfer_amendments.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column(
                "team_id",
                sa.Integer(),
                sa.ForeignKey("teams.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("kind", sa.String(32), nullable=False),
            sa.Column("message", sa.String(300), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_tan_team_id", "transfer_amendment_notices", ["team_id", "id"])
    if "transfer_amendment_notice_reads" not in existing:
        op.create_table(
            "transfer_amendment_notice_reads",
            sa.Column(
                "user_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column(
                "notice_id",
                sa.Integer(),
                sa.ForeignKey("transfer_amendment_notices.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column("read_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_tanr_notice", "transfer_amendment_notice_reads", ["notice_id"])


def downgrade():
    raise RuntimeError("交接修改审批与通知包含审计记录，不能删除")
