"""Keep measured weight differences within one actual receipt's processing family."""

from sqlalchemy import case, func, select
from sqlalchemy.orm import aliased

from .models import MaterialStockBalance as Balance
from .models import MaterialTransfer as Transfer


def weight_lineage(team_id=None, root_ids=None):
    # An ordinary handoff (including a return to the same team) starts a new
    # measurement allowance. Only internal processing preserves the input root.
    roots = select(
        Transfer.id.label("root_id"),
        Transfer.id.label("transfer_id"),
        Transfer.next_team_id.label("team_id"),
    ).where(
        Transfer.status == "received",
        Transfer.stock_tracked.is_(True),
        Transfer.entry_kind.not_in(("processing_output", "rework_split")),
    )
    if root_ids is not None:
        roots = roots.where(Transfer.id.in_(root_ids))
    if team_id is not None:
        roots = roots.where(Transfer.next_team_id == team_id)
    lineage = roots.cte("processing_weight_lineage", recursive=True)
    return lineage.union_all(
        select(lineage.c.root_id, Transfer.id, lineage.c.team_id)
        .select_from(Transfer)
        .join(lineage, Transfer.source_transfer_id == lineage.c.transfer_id)
        .where(
            Transfer.entry_kind.in_(("processing_output", "rework_split")),
            Transfer.status == "received",
            Transfer.stock_tracked.is_(True),
            Transfer.next_team_id == lineage.c.team_id,
            Transfer.source_team_id == lineage.c.team_id,
        )
    )


def weight_roots(lineage):
    root = aliased(Transfer)
    shortage = func.sum(case((Balance.on_hand_weight < 0, -Balance.on_hand_weight), else_=0))
    measured = func.sum(Balance.adjusted_weight)
    return (
        select(
            lineage.c.root_id,
            lineage.c.team_id,
            root.serial_no,
            root.material_name,
            measured.label("processing_delta_weight"),
            shortage.label("shortage_weight"),
            (measured + shortage).label("weight_difference"),
        )
        .select_from(lineage)
        .join(Balance, Balance.transfer_id == lineage.c.transfer_id)
        .join(root, root.id == lineage.c.root_id)
        .group_by(lineage.c.root_id, lineage.c.team_id, root.serial_no, root.material_name)
        .subquery()
    )


def weight_difference_table(team_id=None, root_ids=None):
    lineage = weight_lineage(team_id, root_ids)
    roots = weight_roots(lineage)
    return (
        select(
            lineage.c.transfer_id,
            roots.c.root_id.label("weight_root_transfer_id"),
            roots.c.weight_difference,
        )
        .select_from(lineage)
        .join(roots, roots.c.root_id == lineage.c.root_id)
        .subquery()
    )


def weight_differences(db, lot_ids, team_id=None):
    if not lot_ids:
        return {}
    path = (
        select(Transfer.id, Transfer.source_transfer_id, Transfer.entry_kind)
        .where(Transfer.id.in_(lot_ids))
        .cte("weight_ancestors", recursive=True)
    )
    path = path.union(
        select(Transfer.id, Transfer.source_transfer_id, Transfer.entry_kind)
        .join(path, Transfer.id == path.c.source_transfer_id)
        .where(path.c.entry_kind.in_(("processing_output", "rework_split")))
    )
    roots = select(path.c.id).where(path.c.entry_kind.not_in(("processing_output", "rework_split")))
    differences = weight_difference_table(team_id, roots)
    rows = db.execute(select(differences).where(differences.c.transfer_id.in_(lot_ids)))
    return {
        row.transfer_id: {
            "weight_root_transfer_id": row.weight_root_transfer_id,
            "weight_difference": float(row.weight_difference),
        }
        for row in rows
    }


def difference_totals(items):
    # Sibling lots expose the same root discrepancy; count each input once.
    values = {
        item["weight_root_transfer_id"]: item["weight_difference"]
        for item in items
        if "weight_root_transfer_id" in item
    }
    return {
        "weight_difference": round(sum(values.values()), 6),
        "max_weight_difference": max((abs(value) for value in values.values()), default=0),
    }
