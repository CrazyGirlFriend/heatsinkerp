"""Historical table definitions only: no legacy business API is registered.

Definitions are retained verbatim so existing data, foreign keys and Alembic
history stay intact. Do not remove these as if they were unused UI code.
"""
from __future__ import annotations
from datetime import date, datetime
from decimal import Decimal
from typing import Any, TYPE_CHECKING
from sqlalchemy import (Boolean, CheckConstraint, Date, DateTime, ForeignKey, Index,
                        Integer, JSON, Numeric, String, Text, UniqueConstraint)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base
from .model_base import utcnow, TRANSFER_BATCH_NUMBER_TYPE, WORK_ORDER_NUMBER_TYPE


if TYPE_CHECKING:
    from .models import Team


class WorkOrder(Base):
    __tablename__ = "work_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Kept as a string because leading zeroes are part of the business number.
    # New transfer labels encode TransferBatch.batch_no, not this order number.
    order_no: Mapped[str] = mapped_column(
        WORK_ORDER_NUMBER_TYPE, nullable=False, unique=True, index=True
    )
    # Nullable for legacy rows. New small-loop transfer batches require it.
    serial_no: Mapped[str | None] = mapped_column(
        String(80), nullable=True, unique=True, index=True
    )
    external_system_name: Mapped[str | None] = mapped_column(String(80))
    external_item_id: Mapped[str | None] = mapped_column(String(120), index=True)
    customer_name: Mapped[str | None] = mapped_column(String(160))
    material_name: Mapped[str | None] = mapped_column(String(160))
    technical_requirements: Mapped[str | None] = mapped_column(Text)
    external_snapshot: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    product_id: Mapped[int | None] = mapped_column(
        ForeignKey("products.id", ondelete="SET NULL"), index=True
    )
    product_code: Mapped[str | None] = mapped_column(String(64))
    product_name: Mapped[str] = mapped_column(String(160), nullable=False)
    specification: Mapped[str | None] = mapped_column(String(240))
    planned_quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="created", index=True)
    created_by: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utcnow, onupdate=utcnow
    )

    operations: Mapped[list[Operation]] = relationship(
        back_populates="work_order",
        cascade="all, delete-orphan",
        order_by="Operation.sequence",
        lazy="selectin",
    )
    print_records: Mapped[list[PrintRecord]] = relationship(
        back_populates="work_order",
        cascade="all, delete-orphan",
        order_by="PrintRecord.id",
        lazy="selectin",
    )
    events: Mapped[list[WorkOrderEvent]] = relationship(
        back_populates="work_order",
        cascade="all, delete-orphan",
        order_by="WorkOrderEvent.id",
        lazy="selectin",
    )
    transfer_batches: Mapped[list[TransferBatch]] = relationship(
        back_populates="work_order",
        cascade="all, delete-orphan",
        order_by="TransferBatch.id",
        lazy="selectin",
    )
    external_inventory_movements: Mapped[list[ExternalInventoryMovement]] = relationship(
        back_populates="work_order",
        cascade="all, delete-orphan",
        order_by="ExternalInventoryMovement.id",
        lazy="selectin",
    )


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    specification: Mapped[str | None] = mapped_column(String(240))
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utcnow, onupdate=utcnow
    )

    route_operations: Mapped[list[ProductRouteOperation]] = relationship(
        back_populates="product",
        cascade="all, delete-orphan",
        order_by="ProductRouteOperation.sequence",
        lazy="selectin",
    )


class ProductRouteOperation(Base):
    __tablename__ = "product_route_operations"
    __table_args__ = (
        UniqueConstraint("product_id", "sequence", name="uq_product_route_sequence"),
        UniqueConstraint("product_id", "code", name="uq_product_route_code"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    responsible_team_id: Mapped[int | None] = mapped_column(
        ForeignKey("teams.id", ondelete="RESTRICT"), index=True
    )

    product: Mapped[Product] = relationship(back_populates="route_operations")
    responsible_team: Mapped[Team | None] = relationship(lazy="joined")


class Operation(Base):
    __tablename__ = "operations"
    __table_args__ = (
        UniqueConstraint("work_order_id", "sequence", name="uq_operation_order_sequence"),
        UniqueConstraint("work_order_id", "code", name="uq_operation_order_code"),
        Index("ix_operations_order_status", "work_order_id", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    work_order_id: Mapped[int] = mapped_column(
        ForeignKey("work_orders.id", ondelete="CASCADE"), nullable=False
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    responsible_team_id: Mapped[int | None] = mapped_column(
        ForeignKey("teams.id", ondelete="SET NULL"), index=True
    )
    responsible_team_name: Mapped[str | None] = mapped_column(String(120))
    # pending -> ready -> reported -> received
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utcnow, onupdate=utcnow
    )

    work_order: Mapped[WorkOrder] = relationship(back_populates="operations")
    reports: Mapped[list[OperationReport]] = relationship(
        back_populates="operation",
        cascade="all, delete-orphan",
        order_by="OperationReport.id",
        lazy="selectin",
    )
    exceptions: Mapped[list[OperationException]] = relationship(
        back_populates="operation", cascade="all, delete-orphan",
        order_by="OperationException.id", lazy="selectin",
    )

    @property
    def report(self) -> OperationReport | None:
        return self.reports[0] if self.reports else None

    @report.setter
    def report(self, value: OperationReport | None) -> None:
        self.reports = [value] if value is not None else []


class OperationReport(Base):
    __tablename__ = "operation_reports"
    __table_args__ = (
        UniqueConstraint("operation_id", "idempotency_key", name="uq_report_operation_key"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    operation_id: Mapped[int] = mapped_column(
        ForeignKey("operations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    reported_quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    qualified_quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    scrapped_quantity: Mapped[Decimal] = mapped_column(
        Numeric(14, 3), nullable=False, default=Decimal("0")
    )
    lost_quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False, default=Decimal("0"), server_default="0")
    scrap_reason: Mapped[str | None] = mapped_column(Text)
    loss_reason: Mapped[str | None] = mapped_column(Text)
    scrap_destination_team_id: Mapped[int | None] = mapped_column(ForeignKey("teams.id", ondelete="SET NULL"), index=True)
    scrap_destination_team_name: Mapped[str | None] = mapped_column(String(120))
    idempotency_key: Mapped[str | None] = mapped_column(String(100))
    request_hash: Mapped[str | None] = mapped_column(String(64))
    work_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    operator: Mapped[str] = mapped_column(String(80), nullable=False)
    operator_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    operator_team_id: Mapped[int | None] = mapped_column(
        ForeignKey("teams.id", ondelete="SET NULL"), index=True
    )
    operator_team_name: Mapped[str | None] = mapped_column(String(120))
    notes: Mapped[str | None] = mapped_column(Text)
    reported_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utcnow, onupdate=utcnow
    )

    operation: Mapped[Operation] = relationship(back_populates="reports")
    materials: Mapped[list[MaterialConsumption]] = relationship(
        back_populates="report",
        cascade="all, delete-orphan",
        order_by="MaterialConsumption.id",
        lazy="selectin",
    )
    receipts: Mapped[list[OperationReceipt]] = relationship(
        back_populates="report",
        cascade="all, delete-orphan",
        order_by="OperationReceipt.id",
        lazy="selectin",
    )
    exceptions: Mapped[list[OperationException]] = relationship(
        back_populates="report", order_by="OperationException.id", lazy="selectin",
    )
    transfer_batches: Mapped[list[TransferBatch]] = relationship(
        back_populates="operation_report",
        cascade="all, delete-orphan",
        order_by="TransferBatch.id",
        lazy="selectin",
    )

    @property
    def receipt(self) -> OperationReceipt | None:
        return self.receipts[0] if self.receipts else None

    @receipt.setter
    def receipt(self, value: OperationReceipt | None) -> None:
        self.receipts = [value] if value is not None else []


class MaterialConsumption(Base):
    __tablename__ = "material_consumptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    report_id: Mapped[int] = mapped_column(
        ForeignKey("operation_reports.id", ondelete="CASCADE"), nullable=False, index=True
    )
    material_code: Mapped[str] = mapped_column(String(64), nullable=False)
    material_name: Mapped[str | None] = mapped_column(String(160))
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    unit: Mapped[str | None] = mapped_column(String(24))
    batch_no: Mapped[str | None] = mapped_column(String(80))

    report: Mapped[OperationReport] = relationship(back_populates="materials")


class OperationReceipt(Base):
    __tablename__ = "operation_receipts"
    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_receipt_idempotency_key"),
        Index("ix_receipts_report", "report_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    report_id: Mapped[int] = mapped_column(
        ForeignKey("operation_reports.id", ondelete="RESTRICT"), nullable=False
    )
    # NULL identifies a legacy direct receipt made against an operation report.
    transfer_batch_id: Mapped[int | None] = mapped_column(
        ForeignKey("transfer_batches.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    work_order_id: Mapped[int] = mapped_column(
        ForeignKey("work_orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    from_operation_id: Mapped[int] = mapped_column(
        ForeignKey("operations.id", ondelete="RESTRICT"), nullable=False
    )
    to_operation_id: Mapped[int | None] = mapped_column(
        ForeignKey("operations.id", ondelete="RESTRICT")
    )
    received_quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    received_weight: Mapped[Decimal | None] = mapped_column(Numeric(14, 3))
    operator: Mapped[str] = mapped_column(String(80), nullable=False)
    operator_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    operator_team_id: Mapped[int | None] = mapped_column(
        ForeignKey("teams.id", ondelete="SET NULL"), index=True
    )
    operator_team_name: Mapped[str | None] = mapped_column(String(120))
    scanned_code: Mapped[str] = mapped_column(String(64), nullable=False)
    idempotency_key: Mapped[str | None] = mapped_column(String(100))
    received_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    report: Mapped[OperationReport] = relationship(back_populates="receipts")
    transfer_batch: Mapped[TransferBatch | None] = relationship(back_populates="receipts")


class TransferBatch(Base):
    """A persisted, independently printable transfer from one route step to the next."""

    __tablename__ = "transfer_batches"
    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_transfer_batch_idempotency_key"),
        Index("ix_transfer_batches_order_status", "work_order_id", "status"),
        Index("ix_transfer_batches_serial_created", "serial_no", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    batch_no: Mapped[str] = mapped_column(
        TRANSFER_BATCH_NUMBER_TYPE, nullable=False, unique=True, index=True
    )
    work_order_id: Mapped[int] = mapped_column(
        ForeignKey("work_orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    serial_no: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    operation_report_id: Mapped[int] = mapped_column(
        ForeignKey("operation_reports.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_operation_id: Mapped[int] = mapped_column(
        ForeignKey("operations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    next_operation_id: Mapped[int] = mapped_column(
        ForeignKey("operations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_team_id: Mapped[int | None] = mapped_column(
        ForeignKey("teams.id", ondelete="SET NULL"), index=True
    )
    source_team_name: Mapped[str | None] = mapped_column(String(120))
    next_team_id: Mapped[int | None] = mapped_column(
        ForeignKey("teams.id", ondelete="SET NULL"), index=True
    )
    next_team_name: Mapped[str | None] = mapped_column(String(120))
    total_quantity: Mapped[Decimal] = mapped_column(
        Numeric(14, 3), nullable=False, default=Decimal("0"), server_default="0"
    )
    quantity_unit: Mapped[str | None] = mapped_column(String(24))
    total_weight: Mapped[Decimal] = mapped_column(
        Numeric(14, 3), nullable=False, default=Decimal("0"), server_default="0"
    )
    weight_unit: Mapped[str | None] = mapped_column(String(24))
    status: Mapped[str] = mapped_column(
        String(24), nullable=False, default="pending_receipt", index=True
    )
    notes: Mapped[str | None] = mapped_column(Text)
    idempotency_key: Mapped[str | None] = mapped_column(String(100))
    request_hash: Mapped[str | None] = mapped_column(String(64))
    created_by: Mapped[str] = mapped_column(String(80), nullable=False)
    created_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    created_by_team_id: Mapped[int | None] = mapped_column(
        ForeignKey("teams.id", ondelete="SET NULL"), index=True
    )
    created_by_team_name: Mapped[str | None] = mapped_column(String(120))
    locked_at: Mapped[datetime | None] = mapped_column(DateTime)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    voided_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utcnow, onupdate=utcnow
    )

    work_order: Mapped[WorkOrder] = relationship(back_populates="transfer_batches")
    operation_report: Mapped[OperationReport] = relationship(back_populates="transfer_batches")
    source_operation: Mapped[Operation] = relationship(foreign_keys=[source_operation_id])
    next_operation: Mapped[Operation] = relationship(foreign_keys=[next_operation_id])
    lines: Mapped[list[TransferBatchLine]] = relationship(
        back_populates="transfer_batch",
        cascade="all, delete-orphan",
        order_by="TransferBatchLine.id",
        lazy="selectin",
    )
    receipts: Mapped[list[OperationReceipt]] = relationship(
        back_populates="transfer_batch",
        order_by="OperationReceipt.id",
        lazy="selectin",
    )
    print_records: Mapped[list[PrintRecord]] = relationship(
        back_populates="transfer_batch",
        order_by="PrintRecord.id",
        lazy="selectin",
    )


class TransferBatchLine(Base):
    __tablename__ = "transfer_batch_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    transfer_batch_id: Mapped[int] = mapped_column(
        ForeignKey("transfer_batches.id", ondelete="CASCADE"), nullable=False, index=True
    )
    material_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    material_code: Mapped[str | None] = mapped_column(String(64))
    material_name: Mapped[str | None] = mapped_column(String(160))
    quantity: Mapped[Decimal | None] = mapped_column(Numeric(14, 3))
    unit: Mapped[str | None] = mapped_column(String(24))
    weight: Mapped[Decimal | None] = mapped_column(Numeric(14, 3))
    weight_unit: Mapped[str | None] = mapped_column(String(24))
    material_lot_no: Mapped[str | None] = mapped_column(String(80))
    notes: Mapped[str | None] = mapped_column(Text)

    transfer_batch: Mapped[TransferBatch] = relationship(back_populates="lines")


class OperationException(Base):
    __tablename__ = "operation_exceptions"
    __table_args__ = (UniqueConstraint("idempotency_key", name="uq_exception_idempotency_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    work_order_id: Mapped[int] = mapped_column(ForeignKey("work_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    operation_id: Mapped[int] = mapped_column(ForeignKey("operations.id", ondelete="CASCADE"), nullable=False, index=True)
    report_id: Mapped[int | None] = mapped_column(ForeignKey("operation_reports.id", ondelete="RESTRICT"), index=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False, default=Decimal("0"))
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    destination_team_id: Mapped[int | None] = mapped_column(ForeignKey("teams.id", ondelete="SET NULL"), index=True)
    destination_team_name: Mapped[str | None] = mapped_column(String(120))
    operator: Mapped[str] = mapped_column(String(80), nullable=False)
    operator_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    operator_team_id: Mapped[int | None] = mapped_column(ForeignKey("teams.id", ondelete="SET NULL"), index=True)
    operator_team_name: Mapped[str | None] = mapped_column(String(120))
    idempotency_key: Mapped[str] = mapped_column(String(100), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    operation: Mapped[Operation] = relationship(back_populates="exceptions")
    report: Mapped[OperationReport | None] = relationship(back_populates="exceptions")


class PrintRecord(Base):
    __tablename__ = "print_records"
    __table_args__ = (
        UniqueConstraint(
            "work_order_id", "transfer_batch_id", "print_type", "copy_number",
            name="uq_print_target_type_copy",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    work_order_id: Mapped[int] = mapped_column(
        ForeignKey("work_orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    transfer_batch_id: Mapped[int | None] = mapped_column(
        ForeignKey("transfer_batches.id", ondelete="CASCADE"), nullable=True, index=True
    )
    print_type: Mapped[str] = mapped_column(String(40), nullable=False, default="process_sheet")
    copy_number: Mapped[int] = mapped_column(Integer, nullable=False)
    is_reprint: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    printed_by: Mapped[str] = mapped_column(String(80), nullable=False)
    printed_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    printed_by_team_id: Mapped[int | None] = mapped_column(
        ForeignKey("teams.id", ondelete="SET NULL"), index=True
    )
    printed_by_team_name: Mapped[str | None] = mapped_column(String(120))
    reprint_reason: Mapped[str | None] = mapped_column(Text)
    document_snapshot: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    # Business timestamp deliberately truncated to minute precision.
    printed_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    work_order: Mapped[WorkOrder] = relationship(back_populates="print_records")
    transfer_batch: Mapped[TransferBatch | None] = relationship(back_populates="print_records")


class WorkOrderEvent(Base):
    __tablename__ = "work_order_events"
    __table_args__ = (Index("ix_events_order_created", "work_order_id", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    work_order_id: Mapped[int] = mapped_column(
        ForeignKey("work_orders.id", ondelete="CASCADE"), nullable=False
    )
    operation_id: Mapped[int | None] = mapped_column(
        ForeignKey("operations.id", ondelete="SET NULL")
    )
    event_type: Mapped[str] = mapped_column(String(48), nullable=False)
    actor: Mapped[str] = mapped_column(String(80), nullable=False)
    actor_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    actor_team_id: Mapped[int | None] = mapped_column(
        ForeignKey("teams.id", ondelete="SET NULL"), index=True
    )
    actor_team_name: Mapped[str | None] = mapped_column(String(120))
    details: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    work_order: Mapped[WorkOrder] = relationship(back_populates="events")


class ExternalInventoryMovement(Base):
    """Audit/outbox skeleton for the future company-system integration.

    Rows in this table are local records only. No ERP transport is implemented in
    this phase, and API responses explicitly expose that fact.
    """

    __tablename__ = "external_inventory_movements"
    __table_args__ = (
        UniqueConstraint(
            "external_system_name", "external_message_id",
            name="uq_external_inventory_system_message",
        ),
        Index("ix_external_inventory_order_direction", "work_order_id", "direction"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    work_order_id: Mapped[int] = mapped_column(
        ForeignKey("work_orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    external_system_name: Mapped[str] = mapped_column(String(80), nullable=False)
    environment: Mapped[str | None] = mapped_column(String(40))
    external_message_id: Mapped[str] = mapped_column(String(120), nullable=False)
    external_document_no: Mapped[str | None] = mapped_column(String(120), index=True)
    direction: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    material_type: Mapped[str | None] = mapped_column(String(32))
    quantity: Mapped[Decimal | None] = mapped_column(Numeric(14, 3))
    unit: Mapped[str | None] = mapped_column(String(24))
    weight: Mapped[Decimal | None] = mapped_column(Numeric(14, 3))
    weight_unit: Mapped[str | None] = mapped_column(String(24))
    sync_status: Mapped[str] = mapped_column(
        String(24), nullable=False, default="pending", server_default="pending", index=True
    )
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    failure_reason: Mapped[str | None] = mapped_column(Text)
    request_summary: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    response_summary: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    requested_at: Mapped[datetime | None] = mapped_column(DateTime)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utcnow, onupdate=utcnow
    )

    work_order: Mapped[WorkOrder] = relationship(back_populates="external_inventory_movements")
