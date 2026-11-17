"""Retire the two obsolete directory entries; preserve historical records.

Run with production writers stopped and a verified backup. Preview is the
default; --apply commits deletion, audit and directory notification in one
transaction. Current or archived references block the whole operation.
"""

import argparse
import json

from sqlalchemy import MetaData, Table, func, inspect, select

from . import inventory_events  # noqa: F401 -- persist directory notifications
from .admin_audit import snapshot
from .auth import actor_name
from .database import SessionLocal
from .history_protection import team_has_historical_references
from .models import AdminAuditEvent, Team, User

TARGETS = (
    (
        "FACTORY-SCRAP",
        "转废",
        "scrap",
        "FACTORY-WAREHOUSE",
        "库房",
        "warehouse",
    ),
    (
        "FACTORY-SHIP",
        "发货",
        "production",
        "FACTORY-QC",
        "检验",
        "production",
    ),
)


def retire_legacy_teams(db, actor_id: int) -> list[dict]:
    actor = db.get(User, actor_id)
    if actor is None or actor.role != "ADMIN" or not actor.active:
        raise ValueError("An active administrator is required")
    connection = db.connection()
    schema = inspect(connection)
    metadata = MetaData()
    references = []
    for table_name in schema.get_table_names():
        for foreign_key in schema.get_foreign_keys(table_name):
            if foreign_key["referred_table"] == "teams":
                table = Table(table_name, metadata, autoload_with=connection, resolve_fks=False)
                references.extend((table, column) for column in foreign_key["constrained_columns"])
    results = []
    for code, name, kind, destination_code, destination_name, destination_kind in TARGETS:
        team = db.scalar(select(Team).where(Team.code == code).with_for_update())
        if team is None:
            continue
        destination = db.scalar(select(Team).where(Team.code == destination_code).with_for_update())
        if (team.name, team.kind) != (name, kind):
            raise ValueError(f"Unexpected legacy team identity: {code}")
        if team_has_historical_references(db, team.id):
            raise ValueError(f"Archived history still references team: {code}")
        if (
            destination is None
            or not destination.active
            or (destination.name, destination.kind) != (destination_name, destination_kind)
        ):
            raise ValueError(f"Invalid destination: {destination_code}")
        for table, column in references:
            condition = table.c[column] == team.id
            count = db.scalar(select(func.count()).select_from(table).where(condition))
            if count:
                raise ValueError(f"Unexpected reference: {code} {table.name}.{column} ({count})")
        db.add(
            AdminAuditEvent(
                actor_user_id=actor.id,
                actor=actor_name(actor),
                target_type="team",
                target_id=team.id,
                action="deleted",
                changes={
                    "before": snapshot(team),
                    "after": None,
                    "reason": "恢复八班组：转废归库房，发货归检验",
                    "references": [],
                },
            )
        )
        db.delete(team)
        db.flush()
        results.append(
            {
                "removed": code,
                "destination": destination_code,
                "historical_rows_reassigned": 0,
            }
        )
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--actor-id", type=int, required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    with SessionLocal() as db:
        result = retire_legacy_teams(db, args.actor_id)
        if args.apply:
            db.commit()
        else:
            db.rollback()
    print(json.dumps({"applied": args.apply, "changes": result}, ensure_ascii=False))


if __name__ == "__main__":
    main()
