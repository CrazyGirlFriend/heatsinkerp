"""Reset current material records only; stop application writes and back up first."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from pathlib import Path

from sqlalchemy import MetaData, Table, delete, exists, func, inspect, or_, select, update
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session

from . import models  # noqa: F401
from .database import Base, SessionLocal, engine

RESET_TABLES = (
    "schedule_notice_reads",
    "schedule_notices",
    "production_schedule_events",
    "production_schedule_deliveries",
    "production_schedule_batches",
    "production_schedule_sources",
    "production_schedules",
    "production_schedule_tasks",
    "warehouse_placements",
    "serial_delivery_plans",
    "material_stock_balances",
    "material_transfer_events",
    "material_losses",
    "inspection_feedback_events",
    "inspection_feedback_teams",
    "inspection_problems",
    "material_inspections",
    "material_quantity_adjustments",
    "material_transfers",
    "shared_material_members",
    "shared_material_groups",
    "material_dispatches",
    "opening_stock_submissions",
    "serial_urgency_events",
    "serial_urgencies",
)

# These nullable links may be unused by normal engineering records. Never clear
# them: a referenced batch, inspection or commitment must keep its history.
PROTECTED_ROUTE_REFERENCES = {
    "rework_source_transfer_id": "material_transfers",
    "rework_of_id": "material_quantity_adjustments",
    "rework_inspection_id": "material_inspections",
    "original_schedule_id": "production_schedules",
}


def business_counts(db: Session) -> dict[str, int]:
    return {
        name: db.scalar(select(func.count()).select_from(Base.metadata.tables[name]))
        for name in RESET_TABLES
    }


def _fingerprints(connection: Connection, names: set[str]) -> dict[str, str]:
    """Compare protected contents without logging rows or loading them all at once."""
    result = {}
    for name in sorted(names):
        table = Table(name, MetaData(), autoload_with=connection)
        keys = list(table.primary_key.columns)
        if not keys:
            raise RuntimeError("Cannot verify protected table without primary key: " + name)
        digest = hashlib.sha256()
        for row in connection.execute(select(table).order_by(*keys)).yield_per(1000):
            digest.update(json.dumps(list(row), sort_keys=True, default=str).encode())
            digest.update(b"\n")
        result[name] = digest.hexdigest()
    return result


def reset_business_data(db: Session) -> dict[str, int]:
    """Maintenance only. Scope and protected contents are verified before commit."""
    with db.begin():
        connection = db.connection()
        schema = inspect(connection)
        names = set(schema.get_table_names())
        if not set(RESET_TABLES) <= names:
            raise RuntimeError("Material schema does not match reset scope")
        protected = names - set(RESET_TABLES)
        # Fail closed on future dependencies, even if an ON DELETE CASCADE would
        # otherwise silently remove records outside the approved material scope.
        for name in protected:
            for fk in schema.get_foreign_keys(name):
                if fk["referred_table"] not in RESET_TABLES:
                    continue
                columns = fk["constrained_columns"]
                if (
                    name != "process_routes"
                    or len(columns) != 1
                    or PROTECTED_ROUTE_REFERENCES.get(columns[0]) != fk["referred_table"]
                ):
                    raise RuntimeError("Unapproved dependent table: " + name)
                table = Table(name, MetaData(), autoload_with=connection)
                if connection.scalar(select(exists().where(table.c[columns[0]].is_not(None)))):
                    raise RuntimeError(
                        "Protected engineering references material data: " + columns[0]
                    )
        fingerprints = _fingerprints(connection, protected)
        before = business_counts(db)
        # Both ends are within the reset scope. Break these nullable commitment
        # links before deleting schedules; keep foreign-key checks enabled.
        for name, column in (
            ("material_transfers", "processing_schedule_id"),
            ("material_quantity_adjustments", "production_schedule_id"),
        ):
            table = Base.metadata.tables[name]
            db.execute(update(table).where(table.c[column].is_not(None)).values({column: None}))
        for name in RESET_TABLES:
            table = Base.metadata.tables[name]
            references = {
                "production_schedules": ("predecessor_id",),
                "material_transfers": ("source_transfer_id", "delivery_origin_id"),
                "material_quantity_adjustments": ("rework_of_id",),
                "material_inspections": ("parent_id",),
            }.get(name)
            if references:
                child = table.alias("child")
                # Keep RESTRICT FKs enabled; remove descendants before sources.
                while db.scalar(select(func.count()).select_from(table)):
                    ids = list(
                        db.scalars(
                            select(table.c.id)
                            .where(
                                ~exists(
                                    select(child.c.id).where(
                                        or_(*(child.c[key] == table.c.id for key in references))
                                    )
                                )
                            )
                            .limit(1000)
                        )
                    )
                    if not ids:
                        raise RuntimeError("Cyclic material history; reset rolled back")
                    db.execute(delete(table).where(table.c.id.in_(ids)))
            else:
                db.execute(delete(table))
        if any(business_counts(db).values()):
            raise RuntimeError("Material rows remain; reset rolled back")
        if fingerprints != _fingerprints(connection, protected):
            raise RuntimeError("Protected data changed; reset rolled back")
    return before


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--confirm-database")
    parser.add_argument("--backup-file", type=Path)
    parser.add_argument("--backup-sha256")
    parser.add_argument(
        "--maintenance-confirmed",
        action="store_true",
        help="Confirm application writes have been stopped",
    )
    args = parser.parse_args()
    target = engine.url.database
    if args.apply:
        if (
            args.confirm_database != target
            or not args.backup_file
            or not args.backup_file.is_file()
        ):
            parser.error(
                "Applying requires the exact database name/path and an existing backup file"
            )
        if not args.maintenance_confirmed:
            parser.error("Stop application writes first and pass --maintenance-confirmed")
        with args.backup_file.open("rb") as backup:
            checksum = hashlib.file_digest(backup, "sha256").hexdigest()
        if checksum != args.backup_sha256:
            parser.error("A matching --backup-sha256 is required")
        if args.backup_file.stat().st_size == 0:
            parser.error("Backup is empty")
        if args.backup_file.suffix == ".gz":
            with gzip.open(args.backup_file, "rb") as backup:
                if not backup.read(1):
                    parser.error("Decompressed backup is empty")
                while backup.read(1024 * 1024):
                    pass  # Validate the entire gzip stream before deleting anything.
        with SessionLocal() as db:
            print(
                json.dumps(
                    {"database": target, "deleted": reset_business_data(db)}, ensure_ascii=False
                )
            )
    else:
        with SessionLocal() as db:
            print(
                json.dumps(
                    {"database": target, "dry_run": True, "would_delete": business_counts(db)},
                    ensure_ascii=False,
                )
            )


if __name__ == "__main__":
    main()
