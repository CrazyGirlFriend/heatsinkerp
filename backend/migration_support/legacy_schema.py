"""Frozen schema for pre-retirement upgrades; never registered by the application."""

import sqlalchemy as sa


def _legacy_tables(connection):
    metadata = sa.MetaData()
    for name in ("teams", "users"):
        sa.Table(name, metadata, autoload_with=connection)
    tables = []
    tables.append(
        sa.Table(
            "external_inventory_movements",
            metadata,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "work_order_id",
                sa.Integer(),
                sa.ForeignKey("work_orders.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("external_system_name", sa.String(length=80), nullable=False),
            sa.Column("environment", sa.String(length=40), nullable=True),
            sa.Column("external_message_id", sa.String(length=120), nullable=False),
            sa.Column("external_document_no", sa.String(length=120), nullable=True),
            sa.Column("direction", sa.String(length=24), nullable=False),
            sa.Column("material_type", sa.String(length=32), nullable=True),
            sa.Column("quantity", sa.Numeric(precision=14, scale=3), nullable=True),
            sa.Column("unit", sa.String(length=24), nullable=True),
            sa.Column("weight", sa.Numeric(precision=14, scale=3), nullable=True),
            sa.Column("weight_unit", sa.String(length=24), nullable=True),
            sa.Column(
                "sync_status", sa.String(length=24), nullable=False, server_default="pending"
            ),
            sa.Column("retry_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("failure_reason", sa.Text(), nullable=True),
            sa.Column("request_summary", sa.JSON(), nullable=True),
            sa.Column("response_summary", sa.JSON(), nullable=True),
            sa.Column("requested_at", sa.DateTime(), nullable=True),
            sa.Column("confirmed_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint(
                "external_system_name",
                "external_message_id",
                name="uq_external_inventory_system_message",
            ),
            sa.Index("ix_external_inventory_movements_direction", "direction", unique=False),
            sa.Index(
                "ix_external_inventory_movements_external_document_no",
                "external_document_no",
                unique=False,
            ),
            sa.Index("ix_external_inventory_movements_sync_status", "sync_status", unique=False),
            sa.Index(
                "ix_external_inventory_movements_work_order_id", "work_order_id", unique=False
            ),
            sa.Index(
                "ix_external_inventory_order_direction", "work_order_id", "direction", unique=False
            ),
        )
    )
    tables.append(
        sa.Table(
            "material_consumptions",
            metadata,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "report_id",
                sa.Integer(),
                sa.ForeignKey("operation_reports.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("material_code", sa.String(length=64), nullable=False),
            sa.Column("material_name", sa.String(length=160), nullable=True),
            sa.Column("quantity", sa.Numeric(precision=14, scale=3), nullable=False),
            sa.Column("unit", sa.String(length=24), nullable=True),
            sa.Column("batch_no", sa.String(length=80), nullable=True),
            sa.Index("ix_material_consumptions_report_id", "report_id", unique=False),
        )
    )
    tables.append(
        sa.Table(
            "operation_exceptions",
            metadata,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "work_order_id",
                sa.Integer(),
                sa.ForeignKey("work_orders.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "operation_id",
                sa.Integer(),
                sa.ForeignKey("operations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "report_id",
                sa.Integer(),
                sa.ForeignKey("operation_reports.id", ondelete="RESTRICT"),
                nullable=True,
            ),
            sa.Column("kind", sa.String(length=16), nullable=False),
            sa.Column("quantity", sa.Numeric(precision=14, scale=3), nullable=False),
            sa.Column("reason", sa.Text(), nullable=False),
            sa.Column(
                "destination_team_id",
                sa.Integer(),
                sa.ForeignKey("teams.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("destination_team_name", sa.String(length=120), nullable=True),
            sa.Column("operator", sa.String(length=80), nullable=False),
            sa.Column(
                "operator_user_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "operator_team_id",
                sa.Integer(),
                sa.ForeignKey("teams.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("operator_team_name", sa.String(length=120), nullable=True),
            sa.Column("idempotency_key", sa.String(length=100), nullable=False),
            sa.Column("request_hash", sa.String(length=64), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("idempotency_key", name="uq_exception_idempotency_key"),
            sa.Index(
                "ix_operation_exceptions_destination_team_id", "destination_team_id", unique=False
            ),
            sa.Index("ix_operation_exceptions_operation_id", "operation_id", unique=False),
            sa.Index("ix_operation_exceptions_operator_team_id", "operator_team_id", unique=False),
            sa.Index("ix_operation_exceptions_operator_user_id", "operator_user_id", unique=False),
            sa.Index("ix_operation_exceptions_report_id", "report_id", unique=False),
            sa.Index("ix_operation_exceptions_work_order_id", "work_order_id", unique=False),
        )
    )
    tables.append(
        sa.Table(
            "operation_receipts",
            metadata,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "report_id",
                sa.Integer(),
                sa.ForeignKey("operation_reports.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column(
                "transfer_batch_id",
                sa.Integer(),
                sa.ForeignKey("transfer_batches.id", ondelete="RESTRICT"),
                nullable=True,
            ),
            sa.Column(
                "work_order_id",
                sa.Integer(),
                sa.ForeignKey("work_orders.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "from_operation_id",
                sa.Integer(),
                sa.ForeignKey("operations.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column(
                "to_operation_id",
                sa.Integer(),
                sa.ForeignKey("operations.id", ondelete="RESTRICT"),
                nullable=True,
            ),
            sa.Column("received_quantity", sa.Numeric(precision=14, scale=3), nullable=False),
            sa.Column("received_weight", sa.Numeric(precision=14, scale=3), nullable=True),
            sa.Column("operator", sa.String(length=80), nullable=False),
            sa.Column(
                "operator_user_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "operator_team_id",
                sa.Integer(),
                sa.ForeignKey("teams.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("operator_team_name", sa.String(length=120), nullable=True),
            sa.Column("scanned_code", sa.String(length=64), nullable=False),
            sa.Column("idempotency_key", sa.String(length=100), nullable=True),
            sa.Column("received_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("idempotency_key", name="uq_receipt_idempotency_key"),
            sa.Index("ix_operation_receipts_operator_team_id", "operator_team_id", unique=False),
            sa.Index("ix_operation_receipts_operator_user_id", "operator_user_id", unique=False),
            sa.Index("ix_operation_receipts_transfer_batch_id", "transfer_batch_id", unique=False),
            sa.Index("ix_operation_receipts_work_order_id", "work_order_id", unique=False),
            sa.Index("ix_receipts_report", "report_id", unique=False),
        )
    )
    tables.append(
        sa.Table(
            "operation_reports",
            metadata,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "operation_id",
                sa.Integer(),
                sa.ForeignKey("operations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("reported_quantity", sa.Numeric(precision=14, scale=3), nullable=False),
            sa.Column("qualified_quantity", sa.Numeric(precision=14, scale=3), nullable=False),
            sa.Column("scrapped_quantity", sa.Numeric(precision=14, scale=3), nullable=False),
            sa.Column(
                "lost_quantity",
                sa.Numeric(precision=14, scale=3),
                nullable=False,
                server_default=sa.text("0"),
            ),
            sa.Column("scrap_reason", sa.Text(), nullable=True),
            sa.Column("loss_reason", sa.Text(), nullable=True),
            sa.Column(
                "scrap_destination_team_id",
                sa.Integer(),
                sa.ForeignKey("teams.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("scrap_destination_team_name", sa.String(length=120), nullable=True),
            sa.Column("idempotency_key", sa.String(length=100), nullable=True),
            sa.Column("request_hash", sa.String(length=64), nullable=True),
            sa.Column("work_minutes", sa.Integer(), nullable=False),
            sa.Column("operator", sa.String(length=80), nullable=False),
            sa.Column(
                "operator_user_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "operator_team_id",
                sa.Integer(),
                sa.ForeignKey("teams.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("operator_team_name", sa.String(length=120), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("reported_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("operation_id", "idempotency_key", name="uq_report_operation_key"),
            sa.Index("ix_operation_reports_operation_id", "operation_id", unique=False),
            sa.Index("ix_operation_reports_operator_team_id", "operator_team_id", unique=False),
            sa.Index("ix_operation_reports_operator_user_id", "operator_user_id", unique=False),
            sa.Index(
                "ix_operation_reports_scrap_destination_team_id",
                "scrap_destination_team_id",
                unique=False,
            ),
        )
    )
    tables.append(
        sa.Table(
            "operations",
            metadata,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "work_order_id",
                sa.Integer(),
                sa.ForeignKey("work_orders.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("sequence", sa.Integer(), nullable=False),
            sa.Column("code", sa.String(length=64), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column(
                "responsible_team_id",
                sa.Integer(),
                sa.ForeignKey("teams.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("responsible_team_name", sa.String(length=120), nullable=True),
            sa.Column("status", sa.String(length=24), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("work_order_id", "code", name="uq_operation_order_code"),
            sa.UniqueConstraint("work_order_id", "sequence", name="uq_operation_order_sequence"),
            sa.Index("ix_operations_order_status", "work_order_id", "status", unique=False),
            sa.Index("ix_operations_responsible_team_id", "responsible_team_id", unique=False),
        )
    )
    tables.append(
        sa.Table(
            "print_records",
            metadata,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "work_order_id",
                sa.Integer(),
                sa.ForeignKey("work_orders.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "transfer_batch_id",
                sa.Integer(),
                sa.ForeignKey("transfer_batches.id", ondelete="CASCADE"),
                nullable=True,
            ),
            sa.Column("print_type", sa.String(length=40), nullable=False),
            sa.Column("copy_number", sa.Integer(), nullable=False),
            sa.Column("is_reprint", sa.Boolean(), nullable=False),
            sa.Column("printed_by", sa.String(length=80), nullable=False),
            sa.Column(
                "printed_by_user_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "printed_by_team_id",
                sa.Integer(),
                sa.ForeignKey("teams.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("printed_by_team_name", sa.String(length=120), nullable=True),
            sa.Column("reprint_reason", sa.Text(), nullable=True),
            sa.Column("document_snapshot", sa.JSON(), nullable=True),
            sa.Column("printed_at", sa.DateTime(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint(
                "work_order_id",
                "transfer_batch_id",
                "print_type",
                "copy_number",
                name="uq_print_target_type_copy",
            ),
            sa.Index("ix_print_records_printed_by_team_id", "printed_by_team_id", unique=False),
            sa.Index("ix_print_records_printed_by_user_id", "printed_by_user_id", unique=False),
            sa.Index("ix_print_records_transfer_batch_id", "transfer_batch_id", unique=False),
            sa.Index("ix_print_records_work_order_id", "work_order_id", unique=False),
        )
    )
    tables.append(
        sa.Table(
            "product_route_operations",
            metadata,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "product_id",
                sa.Integer(),
                sa.ForeignKey("products.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("sequence", sa.Integer(), nullable=False),
            sa.Column("code", sa.String(length=64), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column(
                "responsible_team_id",
                sa.Integer(),
                sa.ForeignKey("teams.id", ondelete="RESTRICT"),
                nullable=True,
            ),
            sa.UniqueConstraint("product_id", "code", name="uq_product_route_code"),
            sa.UniqueConstraint("product_id", "sequence", name="uq_product_route_sequence"),
            sa.Index(
                "ix_product_route_operations_responsible_team_id",
                "responsible_team_id",
                unique=False,
            ),
        )
    )
    tables.append(
        sa.Table(
            "products",
            metadata,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("code", sa.String(length=64), nullable=False),
            sa.Column("name", sa.String(length=160), nullable=False),
            sa.Column("specification", sa.String(length=240), nullable=True),
            sa.Column("active", sa.Boolean(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.Index("ix_products_code", "code", unique=True),
        )
    )
    tables.append(
        sa.Table(
            "transfer_batch_lines",
            metadata,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "transfer_batch_id",
                sa.Integer(),
                sa.ForeignKey("transfer_batches.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("material_type", sa.String(length=32), nullable=False),
            sa.Column("material_code", sa.String(length=64), nullable=True),
            sa.Column("material_name", sa.String(length=160), nullable=True),
            sa.Column("quantity", sa.Numeric(precision=14, scale=3), nullable=True),
            sa.Column("unit", sa.String(length=24), nullable=True),
            sa.Column("weight", sa.Numeric(precision=14, scale=3), nullable=True),
            sa.Column("weight_unit", sa.String(length=24), nullable=True),
            sa.Column("material_lot_no", sa.String(length=80), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Index("ix_transfer_batch_lines_material_type", "material_type", unique=False),
            sa.Index(
                "ix_transfer_batch_lines_transfer_batch_id", "transfer_batch_id", unique=False
            ),
        )
    )
    tables.append(
        sa.Table(
            "transfer_batches",
            metadata,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("batch_no", sa.String(length=32), nullable=False),
            sa.Column(
                "work_order_id",
                sa.Integer(),
                sa.ForeignKey("work_orders.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("serial_no", sa.String(length=80), nullable=False),
            sa.Column(
                "operation_report_id",
                sa.Integer(),
                sa.ForeignKey("operation_reports.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "source_operation_id",
                sa.Integer(),
                sa.ForeignKey("operations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "next_operation_id",
                sa.Integer(),
                sa.ForeignKey("operations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "source_team_id",
                sa.Integer(),
                sa.ForeignKey("teams.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("source_team_name", sa.String(length=120), nullable=True),
            sa.Column(
                "next_team_id",
                sa.Integer(),
                sa.ForeignKey("teams.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("next_team_name", sa.String(length=120), nullable=True),
            sa.Column(
                "total_quantity",
                sa.Numeric(precision=14, scale=3),
                nullable=False,
                server_default=sa.text("0"),
            ),
            sa.Column("quantity_unit", sa.String(length=24), nullable=True),
            sa.Column(
                "total_weight",
                sa.Numeric(precision=14, scale=3),
                nullable=False,
                server_default=sa.text("0"),
            ),
            sa.Column("weight_unit", sa.String(length=24), nullable=True),
            sa.Column("status", sa.String(length=24), nullable=False),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("idempotency_key", sa.String(length=100), nullable=True),
            sa.Column("request_hash", sa.String(length=64), nullable=True),
            sa.Column("created_by", sa.String(length=80), nullable=False),
            sa.Column(
                "created_by_user_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "created_by_team_id",
                sa.Integer(),
                sa.ForeignKey("teams.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("created_by_team_name", sa.String(length=120), nullable=True),
            sa.Column("locked_at", sa.DateTime(), nullable=True),
            sa.Column("completed_at", sa.DateTime(), nullable=True),
            sa.Column("voided_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("idempotency_key", name="uq_transfer_batch_idempotency_key"),
            sa.Index("ix_transfer_batches_batch_no", "batch_no", unique=True),
            sa.Index("ix_transfer_batches_created_by_team_id", "created_by_team_id", unique=False),
            sa.Index("ix_transfer_batches_created_by_user_id", "created_by_user_id", unique=False),
            sa.Index("ix_transfer_batches_next_operation_id", "next_operation_id", unique=False),
            sa.Index("ix_transfer_batches_next_team_id", "next_team_id", unique=False),
            sa.Index(
                "ix_transfer_batches_operation_report_id", "operation_report_id", unique=False
            ),
            sa.Index("ix_transfer_batches_order_status", "work_order_id", "status", unique=False),
            sa.Index("ix_transfer_batches_serial_created", "serial_no", "created_at", unique=False),
            sa.Index("ix_transfer_batches_serial_no", "serial_no", unique=False),
            sa.Index(
                "ix_transfer_batches_source_operation_id", "source_operation_id", unique=False
            ),
            sa.Index("ix_transfer_batches_source_team_id", "source_team_id", unique=False),
            sa.Index("ix_transfer_batches_status", "status", unique=False),
            sa.Index("ix_transfer_batches_work_order_id", "work_order_id", unique=False),
        )
    )
    tables.append(
        sa.Table(
            "work_order_events",
            metadata,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "work_order_id",
                sa.Integer(),
                sa.ForeignKey("work_orders.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "operation_id",
                sa.Integer(),
                sa.ForeignKey("operations.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("event_type", sa.String(length=48), nullable=False),
            sa.Column("actor", sa.String(length=80), nullable=False),
            sa.Column(
                "actor_user_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "actor_team_id",
                sa.Integer(),
                sa.ForeignKey("teams.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("actor_team_name", sa.String(length=120), nullable=True),
            sa.Column("details", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Index("ix_events_order_created", "work_order_id", "created_at", unique=False),
            sa.Index("ix_work_order_events_actor_team_id", "actor_team_id", unique=False),
            sa.Index("ix_work_order_events_actor_user_id", "actor_user_id", unique=False),
        )
    )
    tables.append(
        sa.Table(
            "work_orders",
            metadata,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("order_no", sa.String(length=64), nullable=False),
            sa.Column("serial_no", sa.String(length=80), nullable=True),
            sa.Column("external_system_name", sa.String(length=80), nullable=True),
            sa.Column("external_item_id", sa.String(length=120), nullable=True),
            sa.Column("customer_name", sa.String(length=160), nullable=True),
            sa.Column("material_name", sa.String(length=160), nullable=True),
            sa.Column("technical_requirements", sa.Text(), nullable=True),
            sa.Column("external_snapshot", sa.JSON(), nullable=True),
            sa.Column(
                "product_id",
                sa.Integer(),
                sa.ForeignKey("products.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("product_code", sa.String(length=64), nullable=True),
            sa.Column("product_name", sa.String(length=160), nullable=False),
            sa.Column("specification", sa.String(length=240), nullable=True),
            sa.Column("planned_quantity", sa.Numeric(precision=14, scale=3), nullable=False),
            sa.Column("status", sa.String(length=24), nullable=False),
            sa.Column("created_by", sa.String(length=80), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.Index("ix_work_orders_external_item_id", "external_item_id", unique=False),
            sa.Index("ix_work_orders_order_no", "order_no", unique=True),
            sa.Index("ix_work_orders_product_id", "product_id", unique=False),
            sa.Index("ix_work_orders_serial_no", "serial_no", unique=True),
            sa.Index("ix_work_orders_status", "status", unique=False),
        )
    )
    return metadata, tables


def create_legacy_tables(connection):
    metadata, tables = _legacy_tables(connection)
    metadata.create_all(connection, tables=tables)


def drop_legacy_tables(connection):
    metadata, tables = _legacy_tables(connection)
    metadata.drop_all(connection, tables=tables)
