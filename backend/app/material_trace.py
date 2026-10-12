"""Exact-serial batch genealogy and current stock, not an inferred process route."""

from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import or_, select
from sqlalchemy.orm import aliased

from . import material_transfer_workflow as workflow
from .material_stock import stock_table
from .models import MaterialTransfer, SharedMaterialGroup
from .processing_statistics import difference_totals, weight_differences


def serial_trace(db, serial_no, user):
    serial_no = serial_no.strip()
    from .shared_material import serial_match

    group_id = db.scalar(
        select(SharedMaterialGroup.id).where(
            SharedMaterialGroup.batch_no == serial_no.removeprefix("共投-")
        )
    )
    scope = (
        MaterialTransfer.shared_group_id == group_id
        if group_id
        else serial_match(MaterialTransfer.serial_no, serial_no)
    )
    transfers = db.scalars(
        select(MaterialTransfer)
        .where(scope)
        .options(*workflow.material_transfer_list_options(include_history=True))
        .order_by(MaterialTransfer.created_at, MaterialTransfer.id)
    ).all()
    other_outputs = {}
    if not group_id:
        # A serial view hides sibling orders, but their actual split still closes
        # the common parent's residence. Keep accounting facts without adding
        # those siblings to this serial's inventory or drawing their full route.
        groups = {item.shared_group_id for item in transfers if item.shared_group_id}
        if groups:
            for output in db.scalars(
                select(MaterialTransfer).where(
                    MaterialTransfer.shared_group_id.in_(groups),
                    MaterialTransfer.entry_kind == "processing_output",
                    MaterialTransfer.shared_unallocated.is_(False),
                    MaterialTransfer.serial_no != serial_no,
                )
            ):
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
            or_(MaterialTransfer.serial_no == serial_no, source.serial_no == serial_no),
        )
        .options(*workflow.material_transfer_list_options())
        .order_by(MaterialTransfer.created_at.desc(), MaterialTransfer.id.desc())
    ).all()
    balances = {
        row["transfer_id"]: row
        for row in db.execute(
            select(stock).where(stock.c.transfer_id.in_([item.id for item in transfers]))
        ).mappings()
    }
    differences = weight_differences(db, list(balances))
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
        items.append(item)
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
        "items": items,
        "processing_delta_weight": float(
            sum((row["adjusted_weight"] for row in balances.values()), Decimal(0))
        ),
        **difference_totals(differences.values()),
        "reallocations": [
            workflow.material_transfer_dict(row, user, include_history=False)
            for row in reallocations
        ],
        "shortage": {
            "quantity": sum(row["shortage_quantity"] for row in balances.values()),
            "weight": float(sum((row["shortage_weight"] for row in balances.values()), Decimal(0))),
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
        "untracked_count": sum(t.status == "received" and not t.stock_tracked for t in transfers),
    }
