"""Indexed genealogy walks scoped to the requested physical lots."""

from sqlalchemy import select

from .models import MaterialTransfer as Transfer


def relatives(lot_ids, *, ancestors=False, name="lot_lineage"):
    tree = (
        select(Transfer.id, Transfer.source_transfer_id)
        .where(Transfer.id.in_(lot_ids))
        .cte(name, recursive=True)
    )
    edge = (
        Transfer.id == tree.c.source_transfer_id
        if ancestors
        else Transfer.source_transfer_id == tree.c.id
    )
    # UNION also terminates safely for corrupt historical cycles.
    return tree.union(select(Transfer.id, Transfer.source_transfer_id).join(tree, edge))
