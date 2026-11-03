"""Keep warehouse supplemental originals with their confirmed receipt."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.mysql import LONGBLOB

revision = "20261103_0065"
down_revision = "20261103_0064"
branch_labels = None
depends_on = None


def upgrade():
    if sa.inspect(op.get_bind()).has_table("warehouse_receipt_documents"):
        return
    op.create_table(
        "warehouse_receipt_documents",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("team_id", sa.Integer(), nullable=False),
        sa.Column("transfer_id", sa.Integer()),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("filename", sa.String(240), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("content", sa.LargeBinary().with_variant(LONGBLOB(), "mysql"), nullable=False),
        sa.Column("parsed", sa.JSON(), nullable=False),
        sa.Column("pending_key", sa.String(64), unique=True),
        sa.Column("uploaded_by_user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("confirmed_at", sa.DateTime()),
        sa.ForeignKeyConstraint(["team_id"], ["teams.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["transfer_id"], ["material_transfers.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["uploaded_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.CheckConstraint(
            "kind IN ('process', 'drawing', 'order')", name="ck_receipt_document_kind"
        ),
    )
    op.create_index(
        "ix_warehouse_receipt_documents_transfer_id", "warehouse_receipt_documents", ["transfer_id"]
    )
    op.create_index(
        "ix_receipt_documents_owner",
        "warehouse_receipt_documents",
        ["uploaded_by_user_id", "team_id"],
    )


def downgrade():
    raise RuntimeError("入库原件须保留，请通过备份恢复回退")
