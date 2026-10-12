"""One physical lot, many order associations; allocation happens during processing."""

from fastapi import HTTPException
from sqlalchemy import and_, or_, select

from .models import SharedMaterialGroup, SharedMaterialMember
from .schemas import SharedMaterialSerial


def serial_match(serial, query, mode="exact"):
    """Use EXISTS rather than a member join so stock can never be multiplied."""

    def match(column):
        if mode == "exact":
            return column == query.strip()
        escaped = query.strip().replace("!", "!!").replace("%", "!%").replace("_", "!_")
        return column.like(("" if mode == "prefix" else "%") + escaped + "%", escape="!")

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
    if any(member.planned_weight is None or member.planned_quantity is None or not member.planned_specification for member in members):
        raise HTTPException(422, "请为每个共投流水号填写计划用料重量、切出件数和切割尺寸")
    group = SharedMaterialGroup(
        batch_no=batch_no,
        members=[SharedMaterialMember(**member.model_dump()) for member in members],
    )
    db.add(group)
    db.flush()
    return group


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
