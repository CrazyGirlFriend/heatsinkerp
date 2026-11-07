"""Bind untouched warehouse lots inside the caller's transaction."""

from fastapi import HTTPException
from sqlalchemy import select

from .auth import actor_name
from .models import MaterialStockBalance, MaterialTransfer, utcnow
from .process_routes import route_document
from .schemas import SCRAP_MATERIAL_TYPES
from .team_constants import WAREHOUSE_TEAM_CODE


def bind_lot(db, row, lot, user):
    from .models import MaterialTransferEvent

    if row.route_kind != "normal" or row.state != "published":
        raise HTTPException(422, "请选择工艺班组已保存的正常产品工艺")
    if (
        not lot
        or lot.next_team_code != WAREHOUSE_TEAM_CODE
        or lot.status != "received"
        or (lot.source_transfer_id and lot.entry_kind != "serial_reallocation")
    ):
        raise HTTPException(422, "只能关联库房的首次入库批次；在途工序不能重绑")
    if lot.source_transfer_id:
        from .material_lineage import relatives

        ancestors = relatives([lot.id], ancestors=True, name="route_binding_ancestors")
        if db.scalar(
            select(MaterialTransfer.id)
            .where(
                MaterialTransfer.id.in_(select(ancestors.c.id)),
                MaterialTransfer.next_team_code != WAREHOUSE_TEAM_CODE,
            )
            .limit(1)
        ):
            raise HTTPException(422, "本批已进入过生产工序，不能重绑工艺")
    if user.role != "ADMIN":
        from .material_stock import require_actor

        require_actor(user, lot.next_team_id)
    if lot.material_type in SCRAP_MATERIAL_TYPES:
        raise HTTPException(422, "废料不绑定正常产品工艺路线")
    if lot.process_route_id:
        if lot.process_route_id == row.id:
            return
        raise HTTPException(409, "本批已有工艺路线，不能覆盖")
    balance = db.scalar(
        select(MaterialStockBalance)
        .where(MaterialStockBalance.transfer_id == lot.id)
        .with_for_update()
    )
    if (
        not balance
        or balance.reserved_weight
        or balance.reserved_quantity
        or balance.on_hand_quantity != lot.quantity
        or balance.on_hand_weight != lot.weight
    ):
        raise HTTPException(409, "批次已发生流转或加工，不能重新绑定路线")
    serials = (
        {member.serial_no for member in lot.shared_group.members}
        if lot.shared_unallocated
        else {lot.serial_no}
    )
    if lot.shared_unallocated:
        if serials != set(row.serial_nos):
            raise HTTPException(422, "派工流水号名单与共投实物批次不一致")
    else:
        from .process_route_paths import require_order_route

        require_order_route(db, row, lot.serial_no)
    if row.steps[0]["team_id"] != lot.next_team_id:
        raise HTTPException(422, "派工流水号名单或起始库房与实物批次不一致")
    lot.process_route = row
    lot.process_route_id = row.id
    lot.process_step_index, lot.process_step_complete = 0, True
    lot.version += 1
    lot.updated_at = utcnow()
    db.add(
        MaterialTransferEvent(
            transfer_id=lot.id,
            action="route_bound",
            actor=actor_name(user),
            actor_user_id=user.id,
            occurred_at=lot.updated_at,
            changes={"process_route": {"before": None, "after": route_document(lot)}},
        )
    )
