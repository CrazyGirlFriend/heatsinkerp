"""Seed the approved eight-team ledger through real stock/confirmation workflows.

Only explicit CLI execution seeds data. Existing passwords/bindings are never
changed. New demo leaders require DEMO_TEAM_PASSWORD; no production default.
"""
from __future__ import annotations

import json
import os

from sqlalchemy import func, select

from .auth import hash_password
from .configure_material_teams import MATERIAL_TEAMS, configure_material_teams
from .database import SessionLocal
from .material_dispatch_workflow import DispatchConfirm, confirm_dispatch
from .material_stock import DispatchCreate, LossCreate, create_dispatch, create_loss
from .models import MaterialDispatch, MaterialLoss, MaterialTransfer, Team, User
from .schemas import WarehouseReceiptCreate
from .warehouse_receipts import create_receipt


PREFIX = "team-showcase-v2"
COMPLETE_KEY = f"{PREFIX}:complete"
DEMO_USERS = ("demo_warehouse", "demo_roll", "demo_anneal", "demo_grind",
              "demo_wire", "demo_engrave", "demo_plate", "demo_inspection")
MATERIALS = ("铜钼 CuMo70", "钨铜 WCu80", "无氧铜 TU1", "紫铜 T2", "钼片 Mo1", "铝合金 6061")


def summary(db):
    return {model.__tablename__: db.scalar(select(func.count()).select_from(model))
            for model in (MaterialTransfer, MaterialDispatch, MaterialLoss)}


def seed_team_material_showcase(db, password):
    if db.scalar(select(MaterialTransfer.id).where(MaterialTransfer.idempotency_key == COMPLETE_KEY)):
        return {"skipped": "测试数据已生成，不覆盖后续操作", **summary(db)}
    db.commit()
    if len(password) < 12:
        raise ValueError("DEMO_TEAM_PASSWORD must contain at least 12 characters")
    configure_material_teams(db)
    leaders = []
    with db.begin():
        for (code, name, _kind, _description), username in zip(MATERIAL_TEAMS, DEMO_USERS):
            team = db.scalar(select(Team).where(Team.code == code))
            user = db.scalar(select(User).where(User.username == username))
            if not team.active or (user and (user.role != "TEAM" or user.team_id != team.id or not user.active)):
                raise ValueError(f"Demo identity conflict: {username}; existing account was not changed")
            if not user:
                user = User(username=username, display_name=f"{name}演示班组长", role="TEAM",
                            team=team, active=True, password_hash=hash_password(password))
                db.add(user)
            user.team  # Keep the bound actor loaded outside workflow transactions.
            leaders.append(user)
        db.flush()

    def run(operation, *args, **kwargs):
        db.commit()
        return operation(db, *args, **kwargs)

    def send(actor, target, lots, key, *, quantity=10, weight="1.000", confirm=False, external=None):
        payload = DispatchCreate(
            next_team_id=None if external else target.team_id,
            entry_kind=external or "transfer",
            external_destination="测试客户 A" if external else None,
            notes="测试数据：" + ("本班组确认对外出库" if external else "同一下序批量转料"),
            idempotency_key=f"{PREFIX}:{key}",
            lines=[{"source_transfer_id": lot["id"], "quantity": quantity, "weight": weight,
                    "material_type": "finished" if actor is leaders[-1] else "semi_finished"} for lot in lots],
        )
        result = run(create_dispatch, actor.team_id, payload, actor)
        if confirm and result["pending_line_count"]:
            result = run(confirm_dispatch, result["dispatch_no"], DispatchConfirm(
                idempotency_key=f"{PREFIX}:{key}:confirm", expected_revision=result["revision"]
            ), actor if external else target, external=bool(external))
        return result

    warehouse = leaders[0]
    lots_by_team = [[] for _ in leaders]
    for index in range(24):
        receipt = run(create_receipt, warehouse.team_id, WarehouseReceiptCreate(
            serial_no=f"TEST-20260911-{index + 1:03d}",
            source_batch_no=f"TEST-RAW-{index + 1:03d}",
            material_name=MATERIALS[index % len(MATERIALS)], material_type="semi_finished",
            quantity=800, weight="80.000", transfer_specification=f"{30 + index} × 20 × 2 mm",
            customer_code=f"TEST-C{index % 3 + 1:02d}", notes="测试数据：库房手工入库",
            idempotency_key=f"{PREFIX}:intake:{index}",
        ), warehouse)
        lots_by_team[0].append(receipt)
        for team_index, leader in enumerate(leaders[1:], 1):
            received = send(warehouse, leader, [receipt], f"stock:{team_index}:{index}",
                            quantity=60, weight="6.000", confirm=True)
            lots_by_team[team_index].append(received["items"][0])

    # The destinations below are examples, not a configured process route.
    for team_index, (leader, lots) in enumerate(zip(leaders, lots_by_team)):
        target = leaders[(team_index + 1) % len(leaders)]
        for index, lot in enumerate(lots):
            send(leader, target, [lot], f"outgoing:{team_index}:{index}", confirm=index < 4)
            run(create_loss, leader.team_id, LossCreate(
                source_transfer_id=lot["id"], quantity=1, weight="0.100",
                reason=("测试数据：搬运遗失", "测试数据：清点差异", "测试数据：交接盘点差异")[index % 3],
                idempotency_key=f"{PREFIX}:loss:{team_index}:{index}",
            ), leader)
        send(leader, target, lots[:3], f"multi:{team_index}", quantity=2, weight="0.200")
        if team_index in (0, 7):
            external = "warehouse_outbound" if team_index == 0 else "inspection_shipment"
            for index in range(4):
                send(leader, leader, lots[index * 3:index * 3 + 3], f"external:{team_index}:{index}",
                     quantity=3, weight="0.300", confirm=index < 2, external=external)
    run(create_receipt, warehouse.team_id, WarehouseReceiptCreate(
        serial_no="TEST-20260911-COMPLETE", material_name=MATERIALS[0], material_type="finished",
        quantity=10, weight="1.000", notes="测试数据：成品手工入库",
        idempotency_key=COMPLETE_KEY,
    ), warehouse)
    return {"demo_accounts": list(DEMO_USERS), **summary(db)}


def main():
    with SessionLocal() as db:
        print(json.dumps(seed_team_material_showcase(db, os.environ.get("DEMO_TEAM_PASSWORD", "")), ensure_ascii=False))


if __name__ == "__main__":
    main()
