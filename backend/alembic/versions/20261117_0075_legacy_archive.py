"""Consolidate retired workflow rows without changing current business records.

Run with writers stopped and a verified full backup. Every source row is copied
and compared before any source table is removed. Decimal values and timestamps
use exact strings in the archive; source table, ID and original field names stay.
"""

from datetime import date, datetime
from decimal import Decimal

import sqlalchemy as sa
from alembic import op

revision = "20261117_0075"
down_revision = "20261117_0074"
branch_labels = None
depends_on = None

LEGACY_TABLES = (
    "work_orders",
    "products",
    "product_route_operations",
    "operations",
    "operation_reports",
    "material_consumptions",
    "operation_receipts",
    "transfer_batches",
    "transfer_batch_lines",
    "operation_exceptions",
    "print_records",
    "work_order_events",
    "external_inventory_movements",
)


def archive_value(value):
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def upgrade():
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    existing = set(inspector.get_table_names())
    remaining = set(LEGACY_TABLES) & existing
    dependencies = {}
    for name in existing:
        referenced = {fk["referred_table"] for fk in inspector.get_foreign_keys(name)}
        if name not in remaining and referenced & remaining:
            raise RuntimeError(f"Active table still references legacy workflow: {name}")
        if name in remaining:
            dependencies[name] = referenced & remaining
    drop_order = []
    while remaining:
        leaves = sorted(
            name
            for name in remaining
            if not any(name in dependencies[other] for other in remaining)
        )
        if not leaves:
            raise RuntimeError("Unexpected cyclic references in legacy workflow")
        drop_order.extend(leaves)
        remaining.difference_update(leaves)
    if "legacy_records" not in existing:
        op.create_table(
            "legacy_records",
            sa.Column("source_table", sa.String(64), primary_key=True),
            sa.Column("source_id", sa.Integer(), primary_key=True),
            sa.Column("data", sa.JSON(), nullable=False),
        )
    metadata = sa.MetaData()
    archive = sa.Table("legacy_records", metadata, autoload_with=connection)
    # Verify all tables before DDL, since MySQL commits DDL independently.
    for name in drop_order:
        source = sa.Table(name, metadata, autoload_with=connection, resolve_fks=False)
        last_id = None
        while True:
            query = sa.select(source).order_by(source.c.id).limit(500)
            if last_id is not None:
                query = query.where(source.c.id > last_id)
            rows = connection.execute(query).mappings().all()
            if not rows:
                break
            expected = {
                row["id"]: {key: archive_value(value) for key, value in row.items()} for row in rows
            }
            condition = sa.and_(archive.c.source_table == name, archive.c.source_id.in_(expected))
            saved = dict(
                connection.execute(
                    sa.select(archive.c.source_id, archive.c.data).where(condition)
                ).all()
            )
            if any(saved[key] != expected[key] for key in saved):
                raise RuntimeError(f"Legacy archive differs from source: {name}")
            missing = [
                {"source_table": name, "source_id": key, "data": data}
                for key, data in expected.items()
                if key not in saved
            ]
            if missing:
                connection.execute(archive.insert(), missing)
            verified = dict(
                connection.execute(
                    sa.select(archive.c.source_id, archive.c.data).where(condition)
                ).all()
            )
            if verified != expected:
                raise RuntimeError(f"Legacy archive verification failed: {name}")
            last_id = rows[-1]["id"]
    for name in drop_order:
        op.drop_table(name)


def downgrade():
    raise RuntimeError("旧工单已归档；恢复旧程序前请恢复迁移前完整备份")
