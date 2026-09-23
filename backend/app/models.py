"""Current material ledger and identity models; historical tables register separately."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base
from .model_base import TRANSFER_BATCH_NUMBER_TYPE, utcnow


class MainSystemConfiguration(Base):
    __tablename__ = "main_system_configuration"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False)
    base_url: Mapped[str] = mapped_column(String(500), nullable=False)
    token_ciphertext: Mapped[str | None] = mapped_column(Text)
    timeout_seconds: Mapped[Decimal] = mapped_column(Numeric(4, 1), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_by: Mapped[str] = mapped_column(String(160), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    last_test_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_test_ok: Mapped[bool | None] = mapped_column(Boolean)
    last_test_message: Mapped[str | None] = mapped_column(String(300))
    __table_args__ = (CheckConstraint("id = 1", name="ck_main_system_configuration_singleton"),)


class TransferBatchNumberSequence(Base):
    """One locked counter row per UTC creation date."""

    __tablename__ = "transfer_batch_number_sequences"

    sequence_date: Mapped[date] = mapped_column(Date, primary_key=True)
    last_value: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utcnow, onupdate=utcnow
    )


class NotificationOutbox(Base):
    """Durable notifications committed alongside business rows, not stock tasks."""

    __tablename__ = "notification_outbox"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    available_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    lease_owner: Mapped[str | None] = mapped_column(String(64))
    lease_until: Mapped[datetime | None] = mapped_column(DateTime)
    published_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_error: Mapped[str | None] = mapped_column(String(80))
    __table_args__ = (
        Index(
            "ix_notification_outbox_ready",
            "published_at",
            "available_at",
            "lease_until",
            "created_at",
        ),
        CheckConstraint("attempts >= 0", name="ck_notification_outbox_attempts"),
    )


class SerialUrgency(Base):
    __tablename__ = "serial_urgencies"
    serial_no: Mapped[str] = mapped_column(String(80), primary_key=True)
    urgent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    reason: Mapped[str | None] = mapped_column(String(500))
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_by: Mapped[str] = mapped_column(String(80), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    __table_args__ = (Index("ix_su_urgent_serial", "urgent", "serial_no"),)


class SerialUrgencyEvent(Base):
    __tablename__ = "serial_urgency_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    serial_no: Mapped[str] = mapped_column(String(80), nullable=False)
    urgent: Mapped[bool] = mapped_column(Boolean, nullable=False)
    reason: Mapped[str | None] = mapped_column(String(500))
    actor: Mapped[str] = mapped_column(String(80), nullable=False)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    occurred_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    __table_args__ = (Index("ix_sue_serial_time", "serial_no", "occurred_at", "id"),)


class TeamPurpose(Base):
    __tablename__ = "team_purposes"
    __table_args__ = (UniqueConstraint("team_id", "name", name="uq_team_purpose_name"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id", ondelete="RESTRICT"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class TeamSettingEvent(Base):
    __tablename__ = "team_setting_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id", ondelete="RESTRICT"), index=True)
    action: Mapped[str] = mapped_column(String(40))
    actor: Mapped[str] = mapped_column(String(80))
    changes: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class OpeningStockSubmission(Base):
    __tablename__ = "opening_stock_submissions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id", ondelete="RESTRICT"), unique=True)
    idempotency_key: Mapped[str] = mapped_column(String(100), unique=True)
    request_hash: Mapped[str] = mapped_column(String(64))
    created_by: Mapped[str] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class MaterialTransfer(Base):
    """A material batch: internal handoff, warehouse intake, or external exit.

    This is deliberately separate from the legacy work-order/process models.
    The team code/name columns are immutable business snapshots; foreign keys
    retain the original team identity and prevent referenced teams being
    deleted through a database connection that bypasses the API.
    """

    __tablename__ = "material_transfers"
    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_material_transfers_idempotency_key"),
        UniqueConstraint(
            "receipt_idempotency_key",
            name="uq_material_transfers_receipt_idempotency_key",
        ),
        CheckConstraint("quantity >= 0", name="ck_material_transfers_quantity_nonnegative"),
        CheckConstraint("weight >= 0", name="ck_material_transfers_weight_nonnegative"),
        CheckConstraint("quantity > 0 OR weight > 0", name="ck_material_transfers_nonempty"),
        CheckConstraint(
            "finished_quantity IS NULL OR finished_quantity >= 0",
            name="ck_material_transfers_finished_quantity",
        ),
        CheckConstraint(
            "(entry_kind IN ('transfer', 'warehouse_outbound', 'inspection_shipment') AND source_team_id IS NOT NULL AND source_team_code IS NOT NULL AND source_team_name IS NOT NULL) OR "
            "(entry_kind IN ('warehouse_receipt', 'opening_stock') AND source_team_id IS NULL AND source_team_code IS NULL AND source_team_name IS NULL "
            "AND source_transfer_id IS NULL AND dispatch_id IS NULL AND status = 'received' AND stock_tracked = 1)",
            name="ck_mt_entry_kind_source",
        ),
        CheckConstraint(
            "(entry_kind IN ('transfer', 'warehouse_receipt', 'opening_stock') AND next_team_id IS NOT NULL AND next_team_code IS NOT NULL AND next_team_name IS NOT NULL "
            "AND external_destination IS NULL AND status IN ('pending', 'received', 'voided')) OR "
            "(entry_kind IN ('warehouse_outbound', 'inspection_shipment') AND next_team_id IS NULL AND next_team_code IS NULL AND next_team_name IS NULL "
            "AND external_destination IS NOT NULL AND length(trim(external_destination)) > 0 AND source_transfer_id IS NOT NULL AND dispatch_id IS NOT NULL "
            "AND stock_tracked = 0 AND status IN ('pending', 'dispatched', 'voided'))",
            name="ck_mt_entry_destination",
        ),
        Index("ix_material_transfers_serial_created", "serial_no", "created_at"),
        Index("ix_material_transfers_source_status", "source_team_id", "status"),
        Index("ix_material_transfers_next_status", "next_team_id", "status"),
        Index("ix_mt_created", "created_at", "id"),
        Index("ix_mt_status_created", "status", "created_at", "id"),
        Index("ix_mt_source_created", "source_team_id", "created_at", "id"),
        Index("ix_mt_next_created", "next_team_id", "created_at", "id"),
        Index("ix_mt_source_status_created", "source_team_id", "status", "created_at", "id"),
        Index("ix_mt_next_status_created", "next_team_id", "status", "created_at", "id"),
        Index("ix_mt_source_batch_created", "source_batch_no", "created_at", "id"),
        Index("ix_mt_customer_created", "customer_code", "created_at", "id"),
        Index("ix_mt_product_created", "product_code", "created_at", "id"),
        Index("ix_mt_material_created", "material_name", "created_at", "id"),
        Index("ix_mt_type_created", "material_type", "created_at", "id"),
        Index("ix_mt_stock_lot", "next_team_id", "status", "stock_tracked", "received_at", "id"),
        Index("ix_mt_stock_source_status", "source_transfer_id", "status"),
        Index("ix_mt_intake_created", "next_team_id", "entry_kind", "created_at", "id"),
        Index("ix_mt_source_kind_created", "source_team_id", "entry_kind", "created_at", "id"),
        Index(
            "ix_mt_team_serial_purpose", "next_team_id", "serial_no", "purpose_id", "received_at"
        ),
        Index("ix_mt_source_serial_created", "source_team_id", "serial_no", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    batch_no: Mapped[str] = mapped_column(
        TRANSFER_BATCH_NUMBER_TYPE, nullable=False, unique=True, index=True
    )
    serial_no: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    urgency: Mapped[SerialUrgency | None] = relationship(
        primaryjoin="foreign(MaterialTransfer.serial_no) == SerialUrgency.serial_no",
        viewonly=True,
        lazy="selectin",
        uselist=False,
    )
    entry_kind: Mapped[str] = mapped_column(
        String(24), nullable=False, default="transfer", server_default="transfer"
    )
    purpose_id: Mapped[int | None] = mapped_column(
        ForeignKey("team_purposes.id", ondelete="RESTRICT")
    )
    purpose_name: Mapped[str | None] = mapped_column(String(80))
    opening_stock_id: Mapped[int | None] = mapped_column(
        ForeignKey("opening_stock_submissions.id", ondelete="RESTRICT"), index=True
    )
    external_destination: Mapped[str | None] = mapped_column(String(240))
    # Receipt-specific provenance: do not inherit this as the source of later handoffs.
    receipt_kind: Mapped[str | None] = mapped_column(String(16))
    external_source: Mapped[str | None] = mapped_column(String(240))
    return_dispatch_no: Mapped[str | None] = mapped_column(String(40))
    rejection_reason: Mapped[str | None] = mapped_column(Text)
    material_type: Mapped[str | None] = mapped_column(String(32))
    source_batch_no: Mapped[str | None] = mapped_column(String(80))
    material_name: Mapped[str | None] = mapped_column(String(160))
    finished_specification: Mapped[str | None] = mapped_column(String(240))
    transfer_specification: Mapped[str | None] = mapped_column(String(240))
    finished_quantity: Mapped[int | None] = mapped_column(Integer)
    customer_code: Mapped[str | None] = mapped_column(String(80))
    technical_requirements: Mapped[str | None] = mapped_column(Text)
    product_code: Mapped[str | None] = mapped_column(String(80))
    part_no: Mapped[str | None] = mapped_column(String(80))
    material_shape: Mapped[str | None] = mapped_column(String(80))
    material_description: Mapped[str | None] = mapped_column(Text)
    outsourced_unit: Mapped[str | None] = mapped_column(String(160))
    purpose_category: Mapped[str | None] = mapped_column(String(80))
    category_level3: Mapped[str | None] = mapped_column(String(80))
    order_category: Mapped[str | None] = mapped_column(String(80))
    special_process: Mapped[str | None] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    # A received transfer is a stock lot at its destination. External exits
    # never create stock; historical unlinked receipts remain untracked.
    stock_tracked: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    source_transfer_id: Mapped[int | None] = mapped_column(
        ForeignKey("material_transfers.id", ondelete="RESTRICT")
    )
    dispatch_id: Mapped[int | None] = mapped_column(
        ForeignKey("material_dispatches.id", ondelete="RESTRICT"), index=True
    )
    source_team_id: Mapped[int | None] = mapped_column(
        ForeignKey("teams.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    source_team_code: Mapped[str | None] = mapped_column(String(64))
    source_team_name: Mapped[str | None] = mapped_column(String(120))
    next_team_id: Mapped[int | None] = mapped_column(
        ForeignKey("teams.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    next_team_code: Mapped[str | None] = mapped_column(String(64))
    next_team_name: Mapped[str | None] = mapped_column(String(120))
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    weight: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="pending", server_default="pending", index=True
    )
    notes: Mapped[str | None] = mapped_column(Text)
    idempotency_key: Mapped[str | None] = mapped_column(String(100))
    request_hash: Mapped[str | None] = mapped_column(String(64))

    created_by: Mapped[str] = mapped_column(String(80), nullable=False)
    created_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    received_by: Mapped[str | None] = mapped_column(String(80))
    received_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    receipt_idempotency_key: Mapped[str | None] = mapped_column(String(100))
    received_at: Mapped[datetime | None] = mapped_column(DateTime)
    dispatched_by: Mapped[str | None] = mapped_column(String(80))
    dispatched_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    dispatched_at: Mapped[datetime | None] = mapped_column(DateTime)
    outbound_idempotency_key: Mapped[str | None] = mapped_column(String(100), unique=True)
    voided_by: Mapped[str | None] = mapped_column(String(80))
    voided_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    voided_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utcnow, onupdate=utcnow
    )

    source_team: Mapped[Team | None] = relationship(foreign_keys=[source_team_id], lazy="joined")
    next_team: Mapped[Team | None] = relationship(foreign_keys=[next_team_id], lazy="joined")
    stock_source: Mapped[MaterialTransfer | None] = relationship(
        remote_side=[id], foreign_keys=[source_transfer_id], lazy="selectin"
    )
    dispatch: Mapped[MaterialDispatch | None] = relationship(
        foreign_keys=[dispatch_id], lazy="selectin"
    )
    losses: Mapped[list[MaterialLoss]] = relationship(
        foreign_keys="MaterialLoss.source_transfer_id",
        back_populates="source_transfer",
        order_by="MaterialLoss.id",
    )
    history: Mapped[list[MaterialTransferEvent]] = relationship(
        back_populates="transfer", order_by="MaterialTransferEvent.id", lazy="select"
    )


class MaterialStockBalance(Base):
    """Current lot amounts, updated in the same transaction as their ledger."""

    __tablename__ = "material_stock_balances"
    transfer_id: Mapped[int] = mapped_column(
        ForeignKey("material_transfers.id", ondelete="CASCADE"), primary_key=True
    )
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id", ondelete="RESTRICT"))
    received_quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    received_weight: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    on_hand_quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    on_hand_weight: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    reserved_quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    reserved_weight: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    in_transit_quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    in_transit_weight: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    dispatched_quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    dispatched_weight: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    lost_quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    lost_weight: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    __table_args__ = (
        Index("ix_msb_team_lot", "team_id", "transfer_id"),
        *(
            CheckConstraint(f"{prefix}_{amount} >= 0", name=f"ck_msb_{prefix}_{amount}")
            for prefix in ("received", "on_hand", "reserved", "in_transit", "dispatched", "lost")
            for amount in ("quantity", "weight")
        ),
        *(
            CheckConstraint(
                f"round(received_{amount}, 3) = round(on_hand_{amount} + reserved_{amount} + dispatched_{amount} + lost_{amount}, 3)",
                name=f"ck_msb_reconcile_{amount}",
            )
            for amount in ("quantity", "weight")
        ),
        *(
            CheckConstraint(
                f"in_transit_{amount} <= reserved_{amount}", name=f"ck_msb_transit_{amount}"
            )
            for amount in ("quantity", "weight")
        ),
    )


class MaterialDispatch(Base):
    """Atomic submission/retry ledger; only historical submissions have a CK number."""

    __tablename__ = "material_dispatches"
    __table_args__ = (
        Index("ix_md_team_created", "source_team_id", "created_at", "id"),
        Index("ix_md_team_kind_created", "source_team_id", "entry_kind", "created_at", "id"),
        CheckConstraint(
            "(entry_kind = 'transfer' AND next_team_id IS NOT NULL AND next_team_code IS NOT NULL AND next_team_name IS NOT NULL AND external_destination IS NULL) OR "
            "(entry_kind IN ('warehouse_outbound', 'inspection_shipment') AND next_team_id IS NULL AND next_team_code IS NULL AND next_team_name IS NULL "
            "AND external_destination IS NOT NULL AND length(trim(external_destination)) > 0)",
            name="ck_md_entry_destination",
        ),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    dispatch_no: Mapped[str | None] = mapped_column(String(32), unique=True, nullable=True)
    source_team_id: Mapped[int] = mapped_column(
        ForeignKey("teams.id", ondelete="RESTRICT"), nullable=False
    )
    entry_kind: Mapped[str] = mapped_column(
        String(24), nullable=False, default="transfer", server_default="transfer"
    )
    external_destination: Mapped[str | None] = mapped_column(String(240))
    next_team_id: Mapped[int | None] = mapped_column(ForeignKey("teams.id", ondelete="RESTRICT"))
    next_team_code: Mapped[str | None] = mapped_column(String(64))
    next_team_name: Mapped[str | None] = mapped_column(String(120))
    notes: Mapped[str | None] = mapped_column(Text)
    idempotency_key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_by: Mapped[str] = mapped_column(String(80), nullable=False)
    created_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    confirmation_idempotency_key: Mapped[str | None] = mapped_column(String(100), unique=True)
    confirmed_revision: Mapped[str | None] = mapped_column(String(64))
    confirmed_by: Mapped[str | None] = mapped_column(String(80))
    confirmed_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime)


class MaterialLoss(Base):
    """Append-only losses against a received lot; never overwrite its receipt."""

    __tablename__ = "material_losses"
    __table_args__ = (
        CheckConstraint("quantity >= 0", name="ck_ml_quantity"),
        CheckConstraint("weight >= 0", name="ck_ml_weight"),
        CheckConstraint("quantity > 0 OR weight > 0", name="ck_ml_nonempty"),
        Index("ix_ml_team_created", "team_id", "created_at", "id"),
        Index("ix_ml_lot_created", "source_transfer_id", "created_at", "id"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    loss_no: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    source_transfer_id: Mapped[int] = mapped_column(
        ForeignKey("material_transfers.id", ondelete="RESTRICT"), nullable=False
    )
    team_id: Mapped[int] = mapped_column(
        ForeignKey("teams.id", ondelete="RESTRICT"), nullable=False
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    weight: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_by: Mapped[str] = mapped_column(String(80), nullable=False)
    created_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    source_transfer: Mapped[MaterialTransfer] = relationship(
        foreign_keys=[source_transfer_id], back_populates="losses", lazy="joined"
    )


class MaterialTransferEvent(Base):
    """Append-only business audit, committed atomically with each handoff change."""

    __tablename__ = "material_transfer_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    transfer_id: Mapped[int] = mapped_column(
        ForeignKey("material_transfers.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    action: Mapped[str] = mapped_column(String(16), nullable=False)
    actor: Mapped[str] = mapped_column(String(80), nullable=False)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    occurred_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    changes: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    transfer: Mapped[MaterialTransfer] = relationship(back_populates="history")


class AdminAuditEvent(Base):
    """Immutable IDs are snapshots, not FKs: deleting identities retains history."""

    __tablename__ = "admin_audit_events"
    __table_args__ = (Index("ix_admin_audit_target", "target_type", "target_id", "id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor_user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    actor: Mapped[str] = mapped_column(String(80), nullable=False)
    target_type: Mapped[str] = mapped_column(String(16), nullable=False)
    target_id: Mapped[int] = mapped_column(Integer, nullable=False)
    action: Mapped[str] = mapped_column(String(16), nullable=False)
    request_id: Mapped[str | None] = mapped_column(String(32))
    changes: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)


class Team(Base):
    __tablename__ = "teams"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(String(240))
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    kind: Mapped[str] = mapped_column(
        String(16), nullable=False, default="production", server_default="production"
    )
    opening_stock_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utcnow, onupdate=utcnow
    )


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(80), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    team_id: Mapped[int | None] = mapped_column(
        ForeignKey("teams.id", ondelete="RESTRICT"), index=True
    )
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utcnow, onupdate=utcnow
    )

    team: Mapped[Team | None] = relationship(lazy="joined")
    sessions: Mapped[list[AuthSession]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    user: Mapped[User] = relationship(back_populates="sessions", lazy="joined")


# Register ledger/outbox hooks for HTTP and maintenance ORM writers alike.
# Preserve historical table metadata without reviving the old workflows.
from . import (  # noqa: E402
    inventory_events,  # noqa: F401
    legacy_models,  # noqa: E402,F401
    stock_balances,  # noqa: E402,F401
)
