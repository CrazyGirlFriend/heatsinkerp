"""Correct business grouping in the authorized 2026-09-28 demo, without reseeding stock.

The default rehearses and rolls back. Applying requires stopped application writes
and a verified database backup. Historical audit entries are never rewritten.
"""

import argparse
import gzip
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path

from sqlalchemy import select, update

from .configure_material_teams import MATERIAL_TEAMS
from .database import SessionLocal, engine
from .models import (
    AdminAuditEvent,
    MaterialDispatch,
    MaterialTransfer,
    MaterialTransferEvent,
    Team,
    TeamPurpose,
    TeamSettingEvent,
    User,
    utcnow,
)
from .reset_business_data import _fingerprints

REQUEST_ID = "demo-purposes-20260928"
LEGACY_NAMES = {
    "库房": ["入库", "返料"],
    "轧制": ["轧制"],
    "退火": ["退火"],
    "研磨": ["研磨", "抛光"],
    "线切割": ["线切割"],
    "雕刻": ["雕刻"],
    "电镀": ["电镀"],
    "检验": ["去毛刺", "检验", "发货"],
}


def is_demo(row, dispatch_keys):
    key = row.idempotency_key or dispatch_keys.get(row.dispatch_id, "")
    return (
        key.startswith(("demo-online-20260928:", "warehouse-demo-20260928:"))
        and row.serial_no in {f"YS-{i:03}" for i in range(1, 26)}
        and row.material_name in {f"材料{i}" for i in range(1, 6)}
    )


def protected_fingerprints(db):
    tables = {
        "users",
        "teams",
        "main_system_configuration",
        "material_stock_balances",
        "material_dispatches",
        "material_losses",
        "material_quantity_adjustments",
        "warehouse_locations",
    }
    # These fields are deliberately excluded: they are the only allowed edits.
    columns = [
        c
        for c in MaterialTransfer.__table__.c
        if c.name not in {"purpose_id", "purpose_name", "version"}
    ]
    digest = hashlib.sha256()
    for row in db.execute(select(*columns).order_by(MaterialTransfer.id)):
        digest.update(json.dumps(list(row), default=str).encode())
    return {**_fingerprints(db.connection(), tables), "transfer_fields": digest.hexdigest()}


def repair_demo_purposes(db):
    """Caller owns the transaction; fail closed if demo configuration was customized."""
    prior = db.scalar(select(AdminAuditEvent).where(AdminAuditEvent.request_id == REQUEST_ID))
    if prior:
        return {"skipped": "已修正，保留后续人工修改", **prior.changes}
    teams = []
    for code, name, _, _ in MATERIAL_TEAMS:
        team = db.scalar(select(Team).where(Team.code == code).with_for_update())
        if team is None or not team.active or team.name != name:
            raise RuntimeError(f"演示班组不匹配：{name}")
        teams.append(team)
    dispatch_keys = dict(
        db.execute(select(MaterialDispatch.id, MaterialDispatch.idempotency_key)).all()
    )
    records = db.scalars(
        select(MaterialTransfer)
        .order_by(
            MaterialTransfer.next_team_id,
            MaterialTransfer.serial_no,
            MaterialTransfer.created_at,
            MaterialTransfer.id,
        )
        .with_for_update()
    ).all()
    candidates = [
        row for row in records if is_demo(row, dispatch_keys) and row.next_team_id is not None
    ]
    if {row.next_team_id for row in candidates} != {team.id for team in teams}:
        raise RuntimeError("演示来料必须覆盖全部八个班组")
    configs = {}
    for team in teams:
        rows = db.scalars(
            select(TeamPurpose)
            .where(TeamPurpose.team_id == team.id)
            .order_by(TeamPurpose.id)
            .with_for_update()
        ).all()
        if sorted(p.name for p in rows) != sorted(LEGACY_NAMES[team.name]) or not all(
            p.active for p in rows
        ):
            raise RuntimeError(f"{team.name}业务已被修改，未覆盖")
        ids = {p.id for p in rows}
        if any(row.purpose_id in ids and not is_demo(row, dispatch_keys) for row in records):
            raise RuntimeError(f"{team.name}业务已有非演示记录，未覆盖")
        configs[team.id] = rows
    before = protected_fingerprints(db)
    actor = db.scalar(
        select(User).where(User.role == "ADMIN", User.active.is_(True)).order_by(User.id)
    )
    if actor is None:
        raise RuntimeError("未找到有效管理员")
    now = utcnow()
    actor_name = "演示数据维护"
    for team in teams:
        rows = configs[team.id]
        for index in range(3):
            name = f"{team.name}业务{index + 1}"
            if index < len(rows):
                purpose = rows[index]
                old = {"id": purpose.id, "name": purpose.name, "version": purpose.version}
                purpose.name = name
                purpose.version += 1
                purpose.updated_at = now
            else:
                old = None
                purpose = TeamPurpose(team_id=team.id, name=name, active=True)
                db.add(purpose)
                rows.append(purpose)
            db.flush()
            db.add(
                TeamSettingEvent(
                    team_id=team.id,
                    action="purpose_changed",
                    actor=actor_name,
                    changes={
                        "before": old,
                        "after": {"id": purpose.id, "name": name, "version": purpose.version},
                    },
                )
            )
    counters = defaultdict(int)
    distribution = defaultdict(Counter)
    for row in candidates:
        group = (row.next_team_id, row.serial_no)
        purpose = configs[row.next_team_id][counters[group] % 3]
        counters[group] += 1
        changes = {
            "purpose_id": {"before": row.purpose_id, "after": purpose.id},
            "purpose_name": {"before": row.purpose_name, "after": purpose.name},
        }
        # Metadata-only maintenance: leave stock projection revisions and the
        # demo timeline intact. The appended audit records the correction time.
        table = MaterialTransfer.__table__
        db.connection().execute(
            update(table)
            .where(table.c.id == row.id)
            .values(
                purpose_id=purpose.id,
                purpose_name=purpose.name,
                version=row.version + 1,
                updated_at=row.updated_at,
            )
        )
        db.add(
            MaterialTransferEvent(
                transfer_id=row.id,
                action="updated",
                actor=actor_name,
                actor_user_id=actor.id,
                occurred_at=now,
                changes=changes,
            )
        )
        distribution[row.next_team_id][purpose.name] += 1
    db.flush()
    after = protected_fingerprints(db)
    changed = [name for name in before if before[name] != after[name]]
    if changed:
        raise RuntimeError("业务以外的数据发生变化，回滚：" + ", ".join(changed))
    report = {
        "changed_records": len(candidates),
        "protected_data_unchanged": True,
        "teams": [{"name": team.name, "businesses": dict(distribution[team.id])} for team in teams],
    }
    if any(len(row["businesses"]) != 3 for row in report["teams"]):
        raise RuntimeError("每个班组的三项业务都必须有演示记录")
    db.add(
        AdminAuditEvent(
            actor_user_id=actor.id,
            actor=actor_name,
            target_type="demo_purposes",
            target_id=0,
            action="corrected",
            request_id=REQUEST_ID,
            changes=report,
        )
    )
    db.flush()
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--confirm-database")
    parser.add_argument("--maintenance-confirmed", action="store_true")
    parser.add_argument("--backup-file", type=Path)
    parser.add_argument("--backup-sha256")
    args = parser.parse_args()
    if args.apply and (
        args.confirm_database != engine.url.database or not args.maintenance_confirmed
    ):
        parser.error("应用前须停止写入、完成备份并确认目标数据库")
    if args.apply:
        if not args.backup_file or not args.backup_file.is_file():
            parser.error("缺少数据库备份")
        if hashlib.sha256(args.backup_file.read_bytes()).hexdigest() != args.backup_sha256:
            parser.error("备份校验不通过")
        with gzip.open(args.backup_file, "rb") as backup:
            if b"-- Dump completed on" not in backup.read():
                parser.error("数据库备份不完整")
    with SessionLocal() as db:
        try:
            report = repair_demo_purposes(db)
            if args.apply:
                db.commit()
            else:
                db.rollback()
            print(json.dumps({"applied": args.apply, **report}, ensure_ascii=False))
        except BaseException:
            db.rollback()
            raise


if __name__ == "__main__":
    main()
