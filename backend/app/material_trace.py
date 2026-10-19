"""Exact-serial batch genealogy and current stock, not an inferred process route."""

from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func, or_, select, union
from sqlalchemy.orm import aliased

from . import material_transfer_workflow as workflow
from .inspections import hold_column
from .material_lineage import relatives
from .material_stock import stock_table
from .models import (
    MaterialInspection,
    MaterialTransfer,
    MaterialTransferEvent,
    SharedMaterialGroup,
    SharedMaterialMember,
)
from .processing_statistics import difference_totals, weight_differences


def serial_trace(db, serial_no, user):
    serial_no = serial_no.strip()

    group_id = db.scalar(
        select(SharedMaterialGroup.id).where(
            SharedMaterialGroup.batch_no == serial_no.removeprefix("共投-")
        )
    )
    batch = (
        None
        if group_id
        else db.scalar(select(MaterialTransfer.id).where(MaterialTransfer.batch_no == serial_no))
    )
    if group_id:
        requested = select(MaterialTransfer.id).where(MaterialTransfer.shared_group_id == group_id)
    elif batch:
        descendants = relatives([batch], name="trace_descendants")
        requested = select(descendants.c.id)
    else:
        # Separate indexed branches instead of an OR with a correlated EXISTS.
        requested = union(
            select(MaterialTransfer.id).where(MaterialTransfer.serial_no == serial_no),
            select(MaterialTransfer.id).where(
                MaterialTransfer.shared_unallocated.is_(True),
                MaterialTransfer.shared_group_id.in_(
                    select(SharedMaterialMember.group_id).where(
                        SharedMaterialMember.serial_no == serial_no
                    )
                ),
            ),
        )
    requested_ids = set(db.scalars(requested.limit(1201)))
    if len(requested_ids) > 1200:
        raise HTTPException(422, "本流水号链路超过 1200 个批次，请输入具体批次号查看该批及后续流转")
    ancestry = relatives(list(requested_ids), ancestors=True, name="trace_ancestors")
    all_ids = list(db.scalars(select(ancestry.c.id).limit(1201))) if requested_ids else []
    if len(all_ids) > 1200:
        raise HTTPException(422, "本链路超过 1200 个批次，请按具体批次检索记录")
    history_count = db.scalar(
        select(func.count())
        .select_from(MaterialTransferEvent)
        .where(MaterialTransferEvent.transfer_id.in_(all_ids))
    )
    if history_count > 12000:
        raise HTTPException(422, "本链路历史事件较多，请按具体批次查看，避免一次加载全部记录")
    transfers = db.scalars(
        select(MaterialTransfer)
        .where(MaterialTransfer.id.in_(all_ids))
        .options(*workflow.material_transfer_list_options(include_history=True))
        .order_by(MaterialTransfer.created_at, MaterialTransfer.id)
    ).all()
    inspection_state = {
        row.id: row
        for row in db.execute(
            select(
                MaterialTransfer.id,
                hold_column(MaterialTransfer.id).label("hold_id"),
                select(func.max(MaterialInspection.id))
                .where(
                    or_(
                        MaterialInspection.source_transfer_id == MaterialTransfer.id,
                        MaterialInspection.source_transfer_id
                        == MaterialTransfer.inspection_hold_root_id,
                    )
                )
                .correlate(MaterialTransfer)
                .scalar_subquery()
                .label("latest_id"),
            ).where(MaterialTransfer.id.in_(all_ids))
        )
    }
    inspection_records = {
        row.id: row
        for row in db.scalars(
            select(MaterialInspection).where(
                MaterialInspection.id.in_(
                    [state.latest_id for state in inspection_state.values() if state.latest_id]
                )
            )
        )
    }
    other_outputs = {}
    if not group_id and not batch:
        # A serial view hides sibling orders, but their actual split still closes
        # the common parent's residence. Keep accounting facts without adding
        # those siblings to this serial's inventory or drawing their full route.
        groups = {item.shared_group_id for item in transfers if item.shared_group_id}
        if groups:
            sibling_outputs = db.scalars(
                select(MaterialTransfer)
                .where(
                    MaterialTransfer.source_transfer_id.in_(all_ids),
                    MaterialTransfer.shared_group_id.in_(groups),
                    MaterialTransfer.entry_kind == "processing_output",
                    MaterialTransfer.shared_unallocated.is_(False),
                    MaterialTransfer.serial_no != serial_no,
                )
                .limit(1201)
            ).all()
            if len(sibling_outputs) > 1200:
                raise HTTPException(422, "本链路共投拆分记录较多，请按具体批次查看")
            for output in sibling_outputs:
                other_outputs.setdefault(output.source_transfer_id, []).append(
                    {
                        "batch_no": output.batch_no,
                        "serial_no": output.serial_no,
                        "quantity": output.quantity,
                        "weight": float(output.weight),
                        "at": workflow._utc(output.created_at),
                    }
                )
    stock = stock_table()
    source = aliased(MaterialTransfer)
    reallocations = db.scalars(
        select(MaterialTransfer)
        .join(source, source.id == MaterialTransfer.source_transfer_id)
        .where(
            MaterialTransfer.entry_kind == "serial_reallocation",
            or_(MaterialTransfer.id.in_(all_ids), source.id.in_(requested_ids)),
        )
        .options(*workflow.material_transfer_list_options())
        .order_by(MaterialTransfer.created_at.desc(), MaterialTransfer.id.desc())
        .limit(1201)
    ).all()
    if len(reallocations) > 1200:
        raise HTTPException(422, "本链路转投记录较多，请按具体批次查看")
    balances = {
        row["transfer_id"]: row
        for row in db.execute(
            select(stock).where(stock.c.transfer_id.in_([item.id for item in transfers]))
        ).mappings()
    }
    differences = weight_differences(db, list(requested_ids))
    buckets = {
        key: {"quantity": 0, "weight": Decimal(0)}
        for key in ("on_hand", "in_transit", "external_pending", "dispatched", "lost")
    }
    positions = {}
    holdings = {}
    shared_positions = {}
    shared_buckets = {key: {"quantity": 0, "weight": Decimal(0)} for key in buckets}
    items = []

    def add(bucket, quantity, weight):
        bucket["quantity"] += quantity
        bucket["weight"] += Decimal(str(weight))

    batch_numbers = {transfer.id: transfer.batch_no for transfer in transfers}
    for transfer in transfers:
        balance = balances.get(transfer.id)
        # Residence intervals need committed quantity changes and void returns,
        # not just today's balance applied retroactively to the entire period.
        item = workflow.material_transfer_dict(transfer, user, include_history=True)
        # Null means this document is not an accounted stock lot, not zero stock.
        item["on_hand_quantity"] = int(balance["on_hand_quantity"]) if balance else None
        item["on_hand_weight"] = float(balance["on_hand_weight"]) if balance else None
        # Per-lot ownership lets a selected origin retain pending stock at its sender.
        item["owned_quantity"] = int(balance["owned_quantity"]) if balance else None
        item["owned_weight"] = float(balance["owned_weight"]) if balance else None
        item["processing_delta_weight"] = float(balance["adjusted_weight"]) if balance else 0
        item.update(differences.get(transfer.id, {}))
        item["other_processing_outputs"] = other_outputs.get(transfer.id, [])
        item["context_only"] = transfer.id not in requested_ids
        state = inspection_state[transfer.id]
        latest_inspection = inspection_records.get(state.latest_id)
        item["inspection_hold_id"] = state.hold_id
        item["inspection_status"] = (
            "held"
            if state.hold_id
            else "released"
            if latest_inspection
            and latest_inspection.parent_id
            and not latest_inspection.failed_quantity
            else "passed"
            if latest_inspection and not latest_inspection.failed_quantity
            else None
        )
        item["inspection_source_batch_no"] = (
            batch_numbers.get(latest_inspection.source_transfer_id) if latest_inspection else None
        )
        item["inspection_checked_at"] = (
            workflow._utc(latest_inspection.checked_at) if latest_inspection else None
        )
        item["inspection_inspector"] = (
            latest_inspection.inspector_name if latest_inspection else None
        )
        items.append(item)
        if item["context_only"]:
            continue
        if transfer.shared_unallocated:
            if balance:
                add(
                    shared_buckets["on_hand"],
                    balance["on_hand_quantity"],
                    balance["on_hand_weight"],
                )
                if balance["owned_quantity"] or balance["owned_weight"]:
                    shared = shared_positions.setdefault(
                        (transfer.shared_group_id, transfer.next_team_id, transfer.material_type),
                        {
                            "team_id": transfer.next_team_id,
                            "team_name": transfer.next_team_name,
                            "origin_batch_no": item["shared_origin_batch_no"],
                            "material_type": transfer.material_type,
                            "serials": [member["serial_no"] for member in item["shared_serials"]],
                            "quantity": 0,
                            "weight": Decimal(0),
                        },
                    )
                    add(shared, balance["owned_quantity"], balance["owned_weight"])
            if transfer.status == "pending":
                add(
                    shared_buckets[
                        "in_transit" if transfer.entry_kind == "transfer" else "external_pending"
                    ],
                    transfer.quantity,
                    transfer.weight,
                )
            elif transfer.status == "dispatched":
                add(shared_buckets["dispatched"], transfer.quantity, transfer.weight)
            for loss in transfer.losses:
                add(shared_buckets["lost"], loss.quantity, loss.weight)
            continue
        if balance:
            quantity, weight = int(balance["on_hand_quantity"]), balance["on_hand_weight"]
            add(buckets["on_hand"], quantity, weight)
            # Pending dispatches remain owned by the source lot until receipt or
            # external confirmation. Keep its material nature, not the child's.
            owned_quantity, owned_weight = int(balance["owned_quantity"]), balance["owned_weight"]
            if owned_quantity or owned_weight:
                holding = holdings.setdefault(
                    transfer.next_team_id,
                    {
                        "team_id": transfer.next_team_id,
                        "team_code": transfer.next_team_code,
                        "team_name": transfer.next_team_name,
                        "material_types": {},
                    },
                )
                nature = holding["material_types"].setdefault(
                    transfer.material_type,
                    {
                        "material_type": transfer.material_type,
                        "quantity": 0,
                        "weight": Decimal(0),
                    },
                )
                add(nature, owned_quantity, owned_weight)
            if quantity or weight:
                position = positions.setdefault(
                    transfer.next_team_id,
                    {
                        "team_id": transfer.next_team_id,
                        "team_name": transfer.next_team_name,
                        "quantity": 0,
                        "weight": Decimal(0),
                        "batch_count": 0,
                    },
                )
                add(position, quantity, weight)
                position["batch_count"] += 1
        if transfer.status == "pending":
            add(
                buckets["in_transit" if transfer.entry_kind == "transfer" else "external_pending"],
                transfer.quantity,
                transfer.weight,
            )
        elif transfer.status == "dispatched":
            add(buckets["dispatched"], transfer.quantity, transfer.weight)
        for loss in transfer.losses:
            add(buckets["lost"], loss.quantity, loss.weight)

    def amounts(bucket):
        return {**bucket, "weight": float(bucket["weight"])}

    return {
        "serial_no": serial_no,
        "query_kind": "batch" if batch else "shared" if group_id else "serial",
        "focus_batch_id": batch,
        "items": items,
        "processing_delta_weight": float(
            sum(
                (row["adjusted_weight"] for id, row in balances.items() if id in requested_ids),
                Decimal(0),
            )
        ),
        **difference_totals(differences.values()),
        "reallocations": [
            workflow.material_transfer_dict(row, user, include_history=False)
            for row in reallocations
        ],
        "shortage": {
            "quantity": sum(
                row["shortage_quantity"] for id, row in balances.items() if id in requested_ids
            ),
            "weight": float(
                sum(
                    (row["shortage_weight"] for id, row in balances.items() if id in requested_ids),
                    Decimal(0),
                )
            ),
        },
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "totals": {key: amounts(value) for key, value in buckets.items()},
        "shared_totals": {key: amounts(value) for key, value in shared_buckets.items()},
        "shared_positions": [amounts(value) for value in shared_positions.values()],
        "shared_group_view": bool(group_id),
        "positions": [amounts(value) for value in positions.values()],
        "holdings": [
            {
                **value,
                "material_types": [amounts(nature) for nature in value["material_types"].values()],
            }
            for value in holdings.values()
        ],
        "untracked_count": sum(
            t.id in requested_ids and t.status == "received" and not t.stock_tracked
            for t in transfers
        ),
    }
