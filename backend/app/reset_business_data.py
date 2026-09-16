"""Explicit, backed-up business-data reset; identities and barcode counters survive."""
from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path

from sqlalchemy import delete, exists, func, select

from .database import Base, SessionLocal, engine
from . import models  # noqa: F401


RESET_TABLES = (
    "material_transfer_events", "material_losses", "material_transfers", "material_dispatches",
    "operation_receipts", "operation_exceptions", "print_records", "work_order_events",
    "external_inventory_movements", "transfer_batch_lines", "transfer_batches",
    "material_consumptions", "operation_reports", "operations", "product_route_operations",
    "work_orders", "products",
)


def business_counts(db):
    return {name: db.scalar(select(func.count()).select_from(Base.metadata.tables[name]))
            for name in RESET_TABLES}


def reset_business_data(db):
    """Call only during maintenance after backing up this database."""
    with db.begin():
        before = business_counts(db)
        for name in RESET_TABLES:
            table = Base.metadata.tables[name]
            if name == "material_transfers":
                child = table.alias("child")
                # Delete leaves first: keep RESTRICT FKs and check constraints
                # enabled, including external dispatches' mandatory sources.
                while db.scalar(select(func.count()).select_from(table)):
                    ids = list(db.scalars(select(table.c.id).where(~exists(
                        select(child.c.id).where(child.c.source_transfer_id == table.c.id)
                    )).limit(1000)))
                    if not ids:
                        raise RuntimeError("Cyclic stock sources; reset rolled back")
                    db.execute(delete(table).where(table.c.id.in_(ids)))
            else:
                db.execute(delete(table))
    return before


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--confirm-database")
    parser.add_argument("--backup-file", type=Path)
    args = parser.parse_args()
    target = engine.url.database
    if args.apply:
        if args.confirm_database != target or not args.backup_file or not args.backup_file.is_file():
            parser.error("Applying requires the exact database name/path and an existing backup file")
        if args.backup_file.stat().st_size == 0:
            parser.error("Backup is empty")
        if args.backup_file.suffix == ".gz":
            with gzip.open(args.backup_file, "rb") as backup:
                while backup.read(1024 * 1024):
                    pass  # Validate the entire gzip stream before deleting anything.
        with SessionLocal() as db:
            print(json.dumps({"database": target, "deleted": reset_business_data(db)}, ensure_ascii=False))
    else:
        with SessionLocal() as db:
            print(json.dumps({"database": target, "dry_run": True, "would_delete": business_counts(db)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
