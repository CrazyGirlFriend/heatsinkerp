"""One physical lot, many order associations; allocation happens during processing."""

from fastapi import HTTPException
from sqlalchemy import and_, or_, select

from .models import SharedMaterialGroup, SharedMaterialMember
from .schemas import SharedMaterialSerial
from .serial_search import serial_text_match


def serial_match(serial, query, mode="exact"):
    """Use EXISTS rather than a member join so stock can never be multiplied."""

    def match(column):
        return serial_text_match(column, query, mode)

    columns = serial.table.c
    direct = match(serial)
    if "shared_group_id" not in columns or "shared_unallocated" not in columns:
        return direct
    members = (
        select(SharedMaterialMember.id)
        .where(
            SharedMaterialMember.group_id == columns.shared_group_id,
            match(SharedMaterialMember.serial_no),
        )
        .exists()
    )
    return or_(direct, and_(columns.shared_unallocated.is_(True), members))


def group_dict(group, unallocated=False):
    return {
        "shared_group_id": group.id if group else None,
        "shared_unallocated": bool(unallocated),
        "shared_origin_batch_no": group.batch_no if group else None,
        "shared_serials": [
            SharedMaterialSerial.model_validate(member).model_dump(mode="json")
            for member in group.members
        ]
        if group
        else [],
    }


def document(transfer):
    return group_dict(
        transfer.shared_group if transfer.shared_group_id else None, transfer.shared_unallocated
    )


def create_group(db, batch_no, members):
    if any(
        member.planned_weight is None
        or member.planned_quantity is None
        or not member.planned_specification
        for member in members
    ):
        raise HTTPException(422, "请为每个共投流水号填写计划用料重量、切出件数和切割尺寸")
    group = SharedMaterialGroup(
        batch_no=batch_no,
        split_step_index=common_split_index(db, [member.process_route_id for member in members])
        if all(member.process_route_id for member in members)
        else None,
        members=[SharedMaterialMember(**member.model_dump()) for member in members],
    )
    db.add(group)
    db.flush()
    return group


def common_split_index(db, route_ids):
    from .models import ProcessRoute, Team
    from .team_constants import SPLITTING_TEAM_CODES

    routes = [db.get(ProcessRoute, route_id) for route_id in route_ids]
    # Keep the piece together while routes agree; allocate before their paths diverge.
    split = None
    for i, steps in enumerate(zip(*(route.steps for route in routes), strict=False)):
        first = steps[0]
        if any(
            step.get("serial_nos")
            or any(
                step.get(key) != first.get(key)
                for key in ("team_id", "processing_task_id", "purpose_id")
            )
            for step in steps
        ):
            break
        if i > 0 and db.get(Team, first["team_id"]).code in SPLITTING_TEAM_CODES:
            split = i
    if split is None:
        raise HTTPException(422, "共投流水号在拆料前须经过相同工序和业务，且包含可拆料班组")
    return split


def prepare_dispatch(db, lot, line, source, target, kind, rework_return):
    """Bind each order's published route to the outbound portion, not the receipt."""
    from types import SimpleNamespace

    from .process_route_paths import require_order_route
    from .process_routes import require_dispatch_documents, require_route
    from .schemas import SCRAP_MATERIAL_TYPES
    from .team_constants import WAREHOUSE_TEAM_CODE

    if (
        source.code != WAREHOUSE_TEAM_CODE
        or target is None
        or lot.entry_kind not in ("warehouse_receipt", "opening_stock")
        or lot.receipt_kind == "return"
        or lot.shared_group_id
        or kind in SCRAP_MATERIAL_TYPES
        or lot.rework_route_id
        or lot.rework_pending
        or rework_return
    ):
        raise HTTPException(422, "共投仅用于库房原料向下序班组转出")
    if lot.serial_no and lot.serial_no not in {member.serial_no for member in line.shared_serials}:
        raise HTTPException(422, "共投流水号须包含原批次流水号")
    routes = {}
    for member in sorted(line.shared_serials, key=lambda member: member.process_route_id or 0):
        if not member.process_route_id or not member.process_route_version:
            raise HTTPException(422, "请为每个共投流水号关联已发布工艺")
        route = require_route(db, member.process_route_id, True)
        if route.version != member.process_route_version:
            raise HTTPException(409, "工艺版本已变化，请重新读取")
        if (
            route.state != "published"
            or route.route_kind != "normal"
            or not route.steps
            or route.steps[0]["team_id"] != source.id
        ):
            raise HTTPException(422, "共投须使用从当前库房开始的已发布正常工艺")
        require_order_route(db, route, member.serial_no)
        require_dispatch_documents(db, route, lot, member.serial_no)
        routes[route.id] = route
    common_split_index(db, [member.process_route_id for member in line.shared_serials])
    route = routes[line.shared_serials[0].process_route_id]
    return SimpleNamespace(
        process_route_id=route.id,
        process_route=route,
        process_step_index=0,
        process_step_complete=True,
        next_team_id=source.id,
        next_team_code=source.code,
        serial_no="",
        shared_unallocated=True,
        shared_group=None,
        rework_route_id=None,
        rework_pending=False,
        rework_count=0,
    )


def is_split_step(lot, index):
    from .team_constants import SPLITTING_TEAM_CODES

    group = lot.shared_group if lot.shared_unallocated else None
    return (
        index <= group.split_step_index and lot.next_team_code in SPLITTING_TEAM_CODES
        if group and group.split_step_index is not None
        else lot.process_route.steps[index].get("split_here", False)
    )


def allocate(lot, output):
    serial = (output.serial_no or "").strip()
    if not lot.shared_unallocated:
        if serial and serial != lot.serial_no:
            raise HTTPException(422, "普通物料加工不能改变流水号，请使用转投")
        return lot.serial_no, False, {}
    if output.role != "produced":
        if serial:
            raise HTTPException(422, "剩余大料与共投废料保持共投关联，不单独归属流水号")
        return lot.serial_no, True, {}
    member = next(
        (member for member in lot.shared_group.members if member.serial_no == serial), None
    )
    if not member:
        raise HTTPException(422, "请选择该共投批次关联的归属流水号")
    return (
        serial,
        False,
        {
            "customer_code": member.customer_code,
            "finished_specification": member.finished_specification,
        },
    )


def annotate_groups(db, items):
    ids = {row.get("shared_group_id") for row in items} - {None}
    if ids:
        groups = {
            group.id: group
            for group in db.scalars(
                select(SharedMaterialGroup).where(SharedMaterialGroup.id.in_(ids))
            )
        }
        for row in items:
            if row.get("shared_group_id"):
                row.update(
                    group_dict(groups[row["shared_group_id"]], row.get("shared_unallocated"))
                )
    return items
