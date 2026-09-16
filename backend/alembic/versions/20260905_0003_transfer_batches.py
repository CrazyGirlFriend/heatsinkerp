"""Add persisted transfer batches, weight receipts, and external-movement outbox.

Revision ID: 20260905_0003
Revises: 20260903_0002

The initial migration imports current ORM metadata, so a fresh database may
already contain this revision's objects. Every upgrade step is reflection-based
and safe to skip in that case. Existing work orders and legacy receipts remain
unchanged; their new foreign keys are nullable.
"""

from alembic import op
import sqlalchemy as sa


revision = "20260905_0003"
down_revision = "20260903_0002"
branch_labels = None
depends_on = None

NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_name)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
}


def _inspector():
    return sa.inspect(op.get_bind())


def _tables():
    return set(_inspector().get_table_names())


def _columns(table):
    return {column["name"] for column in _inspector().get_columns(table)}


def _has_index(table, columns, *, unique=None):
    for index in _inspector().get_indexes(table):
        if index["column_names"] == columns and (
            unique is None or bool(index["unique"]) is unique
        ):
            return True
    return False


def _ensure_index(table, name, columns, *, unique=False):
    if not _has_index(table, columns, unique=unique):
        op.create_index(name, table, columns, unique=unique)


def _has_fk(table, columns, referred_table):
    return any(
        fk["constrained_columns"] == columns and fk["referred_table"] == referred_table
        for fk in _inspector().get_foreign_keys(table)
    )


def _upgrade_work_orders():
    additions = [
        sa.Column("serial_no", sa.String(80), nullable=True),
        sa.Column("external_system_name", sa.String(80), nullable=True),
        sa.Column("external_item_id", sa.String(120), nullable=True),
        sa.Column("customer_name", sa.String(160), nullable=True),
        sa.Column("material_name", sa.String(160), nullable=True),
        sa.Column("technical_requirements", sa.Text(), nullable=True),
        sa.Column("external_snapshot", sa.JSON(), nullable=True),
    ]
    existing = _columns("work_orders")
    for column in additions:
        if column.name not in existing:
            op.add_column("work_orders", column)
    _ensure_index("work_orders", "ix_work_orders_serial_no", ["serial_no"], unique=True)
    _ensure_index("work_orders", "ix_work_orders_external_item_id", ["external_item_id"])


def _create_new_tables():
    tables = _tables()
    if "transfer_batch_number_sequences" not in tables:
        op.create_table(
            "transfer_batch_number_sequences",
            sa.Column("sequence_date", sa.Date(), primary_key=True),
            sa.Column("last_value", sa.Integer(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )

    if "transfer_batches" not in tables:
        op.create_table(
            "transfer_batches",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("batch_no", sa.String(32), nullable=False),
            sa.Column("work_order_id", sa.Integer(), nullable=False),
            sa.Column("serial_no", sa.String(80), nullable=False),
            sa.Column("operation_report_id", sa.Integer(), nullable=False),
            sa.Column("source_operation_id", sa.Integer(), nullable=False),
            sa.Column("next_operation_id", sa.Integer(), nullable=False),
            sa.Column("source_team_id", sa.Integer(), nullable=True),
            sa.Column("source_team_name", sa.String(120), nullable=True),
            sa.Column("next_team_id", sa.Integer(), nullable=True),
            sa.Column("next_team_name", sa.String(120), nullable=True),
            sa.Column("total_quantity", sa.Numeric(14, 3), nullable=False, server_default="0"),
            sa.Column("quantity_unit", sa.String(24), nullable=True),
            sa.Column("total_weight", sa.Numeric(14, 3), nullable=False, server_default="0"),
            sa.Column("weight_unit", sa.String(24), nullable=True),
            sa.Column("status", sa.String(24), nullable=False, server_default="pending_receipt"),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("idempotency_key", sa.String(100), nullable=True),
            sa.Column("request_hash", sa.String(64), nullable=True),
            sa.Column("created_by", sa.String(80), nullable=False),
            sa.Column("created_by_user_id", sa.Integer(), nullable=True),
            sa.Column("created_by_team_id", sa.Integer(), nullable=True),
            sa.Column("created_by_team_name", sa.String(120), nullable=True),
            sa.Column("locked_at", sa.DateTime(), nullable=True),
            sa.Column("completed_at", sa.DateTime(), nullable=True),
            sa.Column("voided_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["work_order_id"], ["work_orders.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["operation_report_id"], ["operation_reports.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["source_operation_id"], ["operations.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["next_operation_id"], ["operations.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["source_team_id"], ["teams.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["next_team_id"], ["teams.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["created_by_team_id"], ["teams.id"], ondelete="SET NULL"),
            sa.UniqueConstraint("batch_no", name="uq_transfer_batches_batch_no"),
            sa.UniqueConstraint("idempotency_key", name="uq_transfer_batch_idempotency_key"),
        )

    if "transfer_batch_lines" not in tables:
        op.create_table(
            "transfer_batch_lines",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("transfer_batch_id", sa.Integer(), nullable=False),
            sa.Column("material_type", sa.String(32), nullable=False),
            sa.Column("material_code", sa.String(64), nullable=True),
            sa.Column("material_name", sa.String(160), nullable=True),
            sa.Column("quantity", sa.Numeric(14, 3), nullable=True),
            sa.Column("unit", sa.String(24), nullable=True),
            sa.Column("weight", sa.Numeric(14, 3), nullable=True),
            sa.Column("weight_unit", sa.String(24), nullable=True),
            sa.Column("material_lot_no", sa.String(80), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.ForeignKeyConstraint(["transfer_batch_id"], ["transfer_batches.id"], ondelete="CASCADE"),
        )

    if "external_inventory_movements" not in tables:
        op.create_table(
            "external_inventory_movements",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("work_order_id", sa.Integer(), nullable=False),
            sa.Column("external_system_name", sa.String(80), nullable=False),
            sa.Column("environment", sa.String(40), nullable=True),
            sa.Column("external_message_id", sa.String(120), nullable=False),
            sa.Column("external_document_no", sa.String(120), nullable=True),
            sa.Column("direction", sa.String(24), nullable=False),
            sa.Column("material_type", sa.String(32), nullable=True),
            sa.Column("quantity", sa.Numeric(14, 3), nullable=True),
            sa.Column("unit", sa.String(24), nullable=True),
            sa.Column("weight", sa.Numeric(14, 3), nullable=True),
            sa.Column("weight_unit", sa.String(24), nullable=True),
            sa.Column("sync_status", sa.String(24), nullable=False, server_default="pending"),
            sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("failure_reason", sa.Text(), nullable=True),
            sa.Column("request_summary", sa.JSON(), nullable=True),
            sa.Column("response_summary", sa.JSON(), nullable=True),
            sa.Column("requested_at", sa.DateTime(), nullable=True),
            sa.Column("confirmed_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["work_order_id"], ["work_orders.id"], ondelete="CASCADE"),
            sa.UniqueConstraint(
                "external_system_name", "external_message_id",
                name="uq_external_inventory_system_message",
            ),
        )

    index_specs = {
        "transfer_batches": [
            ("ix_transfer_batches_batch_no", ["batch_no"], True),
            ("ix_transfer_batches_work_order_id", ["work_order_id"], False),
            ("ix_transfer_batches_serial_no", ["serial_no"], False),
            ("ix_transfer_batches_operation_report_id", ["operation_report_id"], False),
            ("ix_transfer_batches_source_operation_id", ["source_operation_id"], False),
            ("ix_transfer_batches_next_operation_id", ["next_operation_id"], False),
            ("ix_transfer_batches_source_team_id", ["source_team_id"], False),
            ("ix_transfer_batches_next_team_id", ["next_team_id"], False),
            ("ix_transfer_batches_status", ["status"], False),
            ("ix_transfer_batches_created_by_user_id", ["created_by_user_id"], False),
            ("ix_transfer_batches_created_by_team_id", ["created_by_team_id"], False),
            ("ix_transfer_batches_order_status", ["work_order_id", "status"], False),
            ("ix_transfer_batches_serial_created", ["serial_no", "created_at"], False),
        ],
        "transfer_batch_lines": [
            ("ix_transfer_batch_lines_transfer_batch_id", ["transfer_batch_id"], False),
            ("ix_transfer_batch_lines_material_type", ["material_type"], False),
        ],
        "external_inventory_movements": [
            ("ix_external_inventory_movements_work_order_id", ["work_order_id"], False),
            ("ix_external_inventory_movements_external_document_no", ["external_document_no"], False),
            ("ix_external_inventory_movements_direction", ["direction"], False),
            ("ix_external_inventory_movements_sync_status", ["sync_status"], False),
            ("ix_external_inventory_order_direction", ["work_order_id", "direction"], False),
        ],
    }
    for table, specs in index_specs.items():
        for name, columns, unique in specs:
            _ensure_index(table, name, columns, unique=unique)


def _upgrade_receipts():
    table = "operation_receipts"
    existing = _columns(table)
    missing = []
    if "transfer_batch_id" not in existing:
        missing.append(sa.Column("transfer_batch_id", sa.Integer(), nullable=True))
    if "received_weight" not in existing:
        missing.append(sa.Column("received_weight", sa.Numeric(14, 3), nullable=True))
    needs_fk = not _has_fk(table, ["transfer_batch_id"], "transfer_batches")
    if missing or needs_fk:
        with op.batch_alter_table(table, naming_convention=NAMING_CONVENTION) as batch:
            for column in missing:
                batch.add_column(column)
            if needs_fk:
                batch.create_foreign_key(
                    "fk_receipts_transfer_batch", "transfer_batches",
                    ["transfer_batch_id"], ["id"], ondelete="RESTRICT",
                )
    _ensure_index(table, "ix_operation_receipts_transfer_batch_id", ["transfer_batch_id"])


def _upgrade_print_records():
    table = "print_records"
    existing = _columns(table)
    missing = []
    if "transfer_batch_id" not in existing:
        missing.append(sa.Column("transfer_batch_id", sa.Integer(), nullable=True))
    if "reprint_reason" not in existing:
        missing.append(sa.Column("reprint_reason", sa.Text(), nullable=True))
    if "document_snapshot" not in existing:
        missing.append(sa.Column("document_snapshot", sa.JSON(), nullable=True))
    uniques = _inspector().get_unique_constraints(table)
    old_uniques = [
        item for item in uniques
        if item["column_names"] == ["work_order_id", "print_type", "copy_number"]
    ]
    has_new_unique = any(
        item["column_names"]
        == ["work_order_id", "transfer_batch_id", "print_type", "copy_number"]
        for item in uniques
    )
    needs_fk = not _has_fk(table, ["transfer_batch_id"], "transfer_batches")
    if missing or old_uniques or not has_new_unique or needs_fk:
        with op.batch_alter_table(table, naming_convention=NAMING_CONVENTION) as batch:
            for column in missing:
                batch.add_column(column)
            for constraint in old_uniques:
                batch.drop_constraint(
                    constraint["name"] or "uq_print_records_work_order_id",
                    type_="unique",
                )
            if needs_fk:
                batch.create_foreign_key(
                    "fk_print_records_transfer_batch", "transfer_batches",
                    ["transfer_batch_id"], ["id"], ondelete="CASCADE",
                )
            if not has_new_unique:
                batch.create_unique_constraint(
                    "uq_print_target_type_copy",
                    ["work_order_id", "transfer_batch_id", "print_type", "copy_number"],
                )
    _ensure_index(table, "ix_print_records_transfer_batch_id", ["transfer_batch_id"])


def upgrade() -> None:
    _upgrade_work_orders()
    _create_new_tables()
    _upgrade_receipts()
    _upgrade_print_records()
    if op.get_bind().dialect.name == "sqlite":
        violations = op.get_bind().exec_driver_sql("PRAGMA foreign_key_check").fetchall()
        if violations:
            raise RuntimeError("Foreign-key violations found after transfer-batch migration")


def downgrade() -> None:
    raise RuntimeError(
        "Transfer batches and external movement audit rows cannot be safely "
        "downgraded in place. Restore a verified pre-upgrade backup instead."
    )
