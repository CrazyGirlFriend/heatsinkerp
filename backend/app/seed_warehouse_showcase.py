"""Explicit, additive warehouse demo using the normal stock and slot workflows.

Run only during a backed-up maintenance window. Reuses existing team accounts
and business settings; never rewrites old material records or account passwords.
"""

import json
from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import func, select

from .auth import actor_name
from .configure_material_teams import MATERIAL_TEAMS
from .database import SessionLocal
from .material_stock import DispatchCreate, create_dispatch, dispatch_dict
from .material_transfer_workflow import (
    confirm_material_transfer,
    confirm_outbound,
    material_transfer_dict,
)
from .models import (
    AdminAuditEvent,
    MaterialDispatch,
    MaterialTransfer,
    Team,
    TeamPurpose,
    User,
    WarehouseLocation,
    utcnow,
)
from .schemas import MaterialTransferConfirm, WarehouseReceiptCreate
from .warehouse_locations import LocationWrite, reserve, save_location
from .warehouse_receipts import create_receipt

PREFIX = "warehouse-demo-20260928"
SLOT_GROUPS = {"原料": 10, "周转": 10, "成品": 5, "回收": 15}


def seed_warehouse_showcase(db):
    complete = db.scalar(
        select(AdminAuditEvent).where(
            AdminAuditEvent.target_type == "warehouse_demo",
            AdminAuditEvent.action == "seeded",
            AdminAuditEvent.request_id == PREFIX,
        )
    )
    if complete:
        return {"skipped": "演示数据已生成，保留后续操作", **complete.changes}
    actors, purposes = [], {}
    for code, name, _kind, _description in MATERIAL_TEAMS:
        team = db.scalar(select(Team).where(Team.code == code, Team.active.is_(True)))
        actor = (
            db.scalar(
                select(User)
                .where(User.team_id == team.id, User.active.is_(True), User.role == "TEAM")
                .order_by(User.id)
            )
            if team
            else None
        )
        if not actor:
            raise RuntimeError(f"缺少启用的班组账号：{name}")
        actor.team
        actors.append(actor)
        purposes[team.id] = {
            row.name: row.id
            for row in db.scalars(
                select(TeamPurpose).where(
                    TeamPurpose.team_id == team.id, TeamPurpose.active.is_(True)
                )
            )
        }
    expected = ("返料", "轧制", "退火", "研磨", "线切割", "雕刻", "电镀", "检验")
    for actor, purpose in zip(actors, expected, strict=True):
        if purpose not in purposes[actor.team_id]:
            raise RuntimeError(f"缺少班组业务：{purpose}")
    existing = db.scalars(
        select(MaterialTransfer).where(
            MaterialTransfer.serial_no.in_([f"YS-{i:03d}" for i in range(21, 26)])
        )
    ).all()
    if any(not (row.notes or "").startswith(PREFIX) for row in existing):
        raise RuntimeError("YS-021～YS-025 已被其他业务使用，未覆盖")
    db.commit()

    def run(operation, *args, **kwargs):
        db.commit()
        return operation(db, *args, **kwargs)

    slots = {}
    for group, size in SLOT_GROUPS.items():
        for index in range(1, size + 1):
            name = f"演示-{group}-{index:02d}"
            row = db.scalar(
                select(WarehouseLocation).where(
                    WarehouseLocation.team_id == actors[0].team_id, WarehouseLocation.name == name
                )
            )
            slots[name] = (
                row.id if row else run(save_location, LocationWrite(name=name), actors[0])["id"]
            )
    db.commit()

    def choose(name, actor):
        lease = run(reserve, slots[name], uuid4().hex, actor)
        return {"warehouse_location": name, "warehouse_location_reservation_key": lease["key"]}

    def receive(item, actor, key):
        if item["status"] != "pending":
            return item
        operation = (
            confirm_outbound
            if item["entry_kind"] == "inspection_shipment"
            else confirm_material_transfer
        )
        return run(
            operation,
            item["batch_no"],
            MaterialTransferConfirm(idempotency_key=key, expected_version=item["version"]),
            actor,
        )

    def send(
        source,
        actor,
        target_index,
        key,
        quantity,
        weight,
        *,
        kind="semi_finished",
        location=None,
        confirmed=True,
    ):
        target = actors[target_index] if target_index is not None else None
        prior = db.scalar(select(MaterialDispatch).where(MaterialDispatch.idempotency_key == key))
        if prior:
            item = dispatch_dict(db, prior, actor)["items"][0]
            db.commit()
        else:
            line = {
                "source_transfer_id": source["id"],
                "quantity": quantity,
                "weight": weight,
                "material_type": kind,
            }
            if target:
                line["purpose_id"] = purposes[target.team_id][expected[target_index]]
            if location:
                line.update(choose(location, actor))
            result = run(
                create_dispatch,
                actor.team_id,
                DispatchCreate(
                    next_team_id=target.team_id if target else None,
                    entry_kind="transfer" if target else "inspection_shipment",
                    external_destination=None if target else "演示客户",
                    notes=f"{PREFIX}：仓位与批次流转演示",
                    idempotency_key=key,
                    lines=[line],
                ),
                actor,
            )
            item = result["items"][0]
        return receive(item, target or actor, key + ":receive") if confirmed else item

    for material in range(1, 6):
        for batch in range(1, 4):
            key = f"{PREFIX}:{material}:{batch}"
            quantity = 200 + batch * 200
            weight = Decimal(quantity) / 10
            prior = db.scalar(
                select(MaterialTransfer).where(MaterialTransfer.idempotency_key == key)
            )
            if prior:
                current = material_transfer_dict(prior, actors[0])
                db.commit()
            else:
                current = run(
                    create_receipt,
                    actors[0].team_id,
                    WarehouseReceiptCreate(
                        serial_no=f"YS-{material + 20:03d}",
                        material_name=f"材料{material}",
                        material_type="raw_material",
                        quantity=quantity,
                        weight=weight,
                        external_source="演示供应商",
                        source_batch_no=f"YS-{material + 20:03d}-{batch:02d}",
                        delivery_date=utcnow().date() + timedelta(days=batch),
                        delivery_quantity=quantity,
                        notes=f"{PREFIX}：第 {batch} 批来料",
                        idempotency_key=key,
                        **choose(f"演示-原料-{material:02d}", actors[0]),
                    ),
                    actors[0],
                )
            # Third batches deliberately stop at different teams; material 2
            # waits for rolling to sign and keeps its origin warehouse occupied.
            last_team = 7 if batch < 3 else (0, 1, 3, 6, 7)[material - 1]
            for target_index in range(1, last_team + 1):
                if target_index == 4:
                    scrap = Decimal(quantity) / 200
                    send(
                        current,
                        actors[3],
                        0,
                        key + ":scrap",
                        0,
                        scrap,
                        kind="scrap_chips",
                        location=f"演示-回收-{(material - 1) * 3 + batch:02d}",
                    )
                    weight -= scrap
                current = send(
                    current,
                    actors[target_index - 1],
                    target_index,
                    key + f":step:{target_index}",
                    quantity,
                    weight,
                    kind="finished" if target_index == 7 else "semi_finished",
                    confirmed=not (batch == 3 and material == 2),
                )
            if last_team != 7:
                continue
            if batch == 1:
                send(current, actors[7], None, key + ":ship", quantity, weight, kind="finished")
            elif batch == 2:
                send(current, actors[7], None, key + ":ship", 300, weight / 2, kind="finished")
                send(
                    current,
                    actors[7],
                    0,
                    key + ":finished",
                    200,
                    weight / 3,
                    kind="finished",
                    location=f"演示-成品-{material:02d}",
                )
            else:
                send(current, actors[7], None, key + ":ship", 400, weight / 2, kind="finished")
                send(
                    current,
                    actors[7],
                    0,
                    key + ":finished",
                    400,
                    weight / 2,
                    kind="finished",
                    location="演示-周转-01",
                    confirmed=False,
                )

    result = {
        "serials": [f"YS-{i:03d}" for i in range(21, 26)],
        "incoming_batches": 15,
        "new_slots": sum(SLOT_GROUPS.values()),
        "material_records": db.scalar(
            select(func.count(MaterialTransfer.id)).where(MaterialTransfer.notes.like(PREFIX + "%"))
        ),
    }
    db.add(
        AdminAuditEvent(
            actor_user_id=actors[0].id,
            actor=actor_name(actors[0]),
            target_type="warehouse_demo",
            target_id=actors[0].team_id,
            action="seeded",
            request_id=PREFIX,
            changes=result,
        )
    )
    db.commit()
    return result


if __name__ == "__main__":
    with SessionLocal() as session:
        print(json.dumps(seed_warehouse_showcase(session), ensure_ascii=False))
