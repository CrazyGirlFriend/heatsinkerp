"""Indexed genealogy walks scoped to the requested physical lots."""

from sqlalchemy import select

from .models import MaterialTransfer as Transfer
from .models import WarehouseFeedingSource as Portion


def source_ids_for(transfer_ids):
    return (
        select(Transfer.source_transfer_id)
        .where(Transfer.id.in_(transfer_ids))
        .union(select(Portion.source_transfer_id).where(Portion.transfer_id.in_(transfer_ids)))
    )


def relatives(lot_ids, *, ancestors=False, name="lot_lineage"):
    tree = select(Transfer.id).where(Transfer.id.in_(lot_ids)).cte(name, recursive=True)
    if ancestors:
        direct = (
            select(Transfer.source_transfer_id)
            .join(tree, tree.c.id == Transfer.id)
            .where(Transfer.source_transfer_id.is_not(None))
        )
        pooled = select(Portion.source_transfer_id).join(tree, tree.c.id == Portion.transfer_id)
    else:
        direct = select(Transfer.id).join(tree, tree.c.id == Transfer.source_transfer_id)
        pooled = select(Portion.transfer_id).join(tree, tree.c.id == Portion.source_transfer_id)
    return tree.union(direct, pooled)
