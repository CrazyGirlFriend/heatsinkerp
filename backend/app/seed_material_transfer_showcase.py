"""Idempotently add a small process-independent transfer showcase.

The script deliberately reuses active TEAM accounts and their existing teams.
It never creates an account or invents a password.  Missing eligible leaders
are reported as skipped demo steps so production configuration remains intact.
"""

from __future__ import annotations

import json

from fastapi import HTTPException
from sqlalchemy import select

from .database import SessionLocal
from .material_transfer_workflow import (
    confirm_material_transfer,
    create_material_transfer,
)
from .models import MaterialTransfer, Team, User
from .schemas import MaterialTransferConfirm, MaterialTransferCreate


DEMO_SERIAL_NO = "DEMO-DIRECT-FLOW-001"
FIRST_CREATE_KEY = "material-transfer-showcase:v1:first"
FIRST_CONFIRM_KEY = "material-transfer-showcase:v1:first-confirm"
SECOND_CREATE_KEY = "material-transfer-showcase:v1:second"


def _eligible_leaders(db) -> dict[int, User]:
    users = db.scalars(
        select(User)
        .join(Team, User.team_id == Team.id)
        .where(
            User.role == "TEAM",
            User.active.is_(True),
            Team.active.is_(True),
        )
        .order_by(Team.sort_order, Team.id, User.id)
    ).all()
    leaders: dict[int, User] = {}
    for user in users:
        if user.team_id is not None and user.team_id not in leaders:
            # User.team is joined eagerly and remains safe after commit because
            # the application session factory uses expire_on_commit=False.
            user.team
            leaders[user.team_id] = user
    return leaders


def seed_material_transfer_showcase(db) -> dict:
    leaders = _eligible_leaders(db)
    existing_first = db.scalar(
        select(MaterialTransfer).where(
            MaterialTransfer.idempotency_key == FIRST_CREATE_KEY
        )
    )
    existing_second = db.scalar(
        select(MaterialTransfer).where(
            MaterialTransfer.idempotency_key == SECOND_CREATE_KEY
        )
    )
    db.commit()

    summary = {
        "serial_no": DEMO_SERIAL_NO,
        "created": [],
        "reused": [],
        "confirmed": [],
        "skipped": [],
    }
    if existing_first is not None:
        source = leaders.get(existing_first.source_team_id)
        target = leaders.get(existing_first.next_team_id)
    else:
        candidates = list(leaders.values())
        if len(candidates) < 2:
            summary["skipped"].append(
                "首段演示：至少需要两个不同班组各有一个有效班组长账号"
            )
            return summary
        source, target = candidates[0], candidates[1]

    if source is None or target is None:
        summary["skipped"].append(
            "首段演示：原演示流转的转出或接收班组没有有效班组长账号"
        )
        return summary

    try:
        first = create_material_transfer(
            db,
            MaterialTransferCreate(
                serial_no=DEMO_SERIAL_NO,
                next_team_id=target.team_id,
                quantity=24,
                weight="4.800",
                notes="演示：转出班组整批转出，等待接收班组确认",
                idempotency_key=FIRST_CREATE_KEY,
            ),
            source,
        )
    except HTTPException as exc:
        summary["skipped"].append(f"首段演示：{exc.detail}")
        return summary
    summary["reused" if existing_first is not None else "created"].append(
        first["batch_no"]
    )

    if first["status"] == "pending":
        try:
            received = confirm_material_transfer(
                db,
                first["batch_no"],
                MaterialTransferConfirm(idempotency_key=FIRST_CONFIRM_KEY),
                target,
            )
            summary["confirmed"].append(received["batch_no"])
        except HTTPException as exc:
            summary["skipped"].append(f"首段接收：{exc.detail}")
    elif first["status"] != "received":
        summary["skipped"].append("首段接收：演示流转已经作废")

    if existing_second is not None:
        second_source = leaders.get(existing_second.source_team_id)
        second_target = leaders.get(existing_second.next_team_id)
    else:
        second_source = target
        second_target = next(
            (
                leader
                for team_id, leader in leaders.items()
                if team_id not in {source.team_id, target.team_id}
            ),
            None,
        )
    if second_source is None or second_target is None:
        summary["skipped"].append(
            "第二段演示：需要第三个有有效班组长账号的班组；未创建账号或密码"
        )
        return summary
    try:
        second = create_material_transfer(
            db,
            MaterialTransferCreate(
                serial_no=DEMO_SERIAL_NO,
                next_team_id=second_target.team_id,
                quantity=24,
                weight="4.800",
                notes="演示：接收班组重新建立下一次相邻交接",
                idempotency_key=SECOND_CREATE_KEY,
            ),
            second_source,
        )
        summary["reused" if existing_second is not None else "created"].append(
            second["batch_no"]
        )
    except HTTPException as exc:
        summary["skipped"].append(f"第二段演示：{exc.detail}")
    return summary


def main() -> None:
    with SessionLocal() as db:
        print(json.dumps(seed_material_transfer_showcase(db), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
