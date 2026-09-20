"""Exact-serial batch genealogy and current stock, not an inferred process route."""
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from . import material_transfer_workflow as workflow
from .material_stock import stock_table
from .models import MaterialTransfer


def serial_trace(db, serial_no, user):
    serial_no = serial_no.strip()
    transfers = db.scalars(select(MaterialTransfer).where(
        MaterialTransfer.serial_no == serial_no
    ).options(selectinload(MaterialTransfer.losses), selectinload(MaterialTransfer.history)).order_by(
        MaterialTransfer.created_at, MaterialTransfer.id
    )).all()
    stock = stock_table()
    balances = {row['transfer_id']: row for row in db.execute(
        select(stock).where(stock.c.serial_no == serial_no)
    ).mappings()}
    buckets = {key: {'quantity': 0, 'weight': Decimal(0)} for key in (
        'on_hand', 'in_transit', 'external_pending', 'dispatched', 'lost'
    )}
    positions = {}
    items = []

    def add(bucket, quantity, weight):
        bucket['quantity'] += quantity
        bucket['weight'] += Decimal(str(weight))

    for transfer in transfers:
        balance = balances.get(transfer.id)
        # Residence intervals need committed quantity changes and void returns,
        # not just today's balance applied retroactively to the entire period.
        item = workflow.material_transfer_dict(transfer, user, include_history=True)
        # Null means this document is not an accounted stock lot, not zero stock.
        item['on_hand_quantity'] = int(balance['on_hand_quantity']) if balance else None
        item['on_hand_weight'] = float(balance['on_hand_weight']) if balance else None
        items.append(item)
        if balance:
            quantity, weight = int(balance['on_hand_quantity']), balance['on_hand_weight']
            add(buckets['on_hand'], quantity, weight)
            if quantity or weight:
                position = positions.setdefault(transfer.next_team_id, {
                    'team_id': transfer.next_team_id, 'team_name': transfer.next_team_name,
                    'quantity': 0, 'weight': Decimal(0), 'batch_count': 0,
                })
                add(position, quantity, weight)
                position['batch_count'] += 1
        if transfer.status == 'pending':
            add(buckets['in_transit' if transfer.entry_kind == 'transfer' else 'external_pending'],
                transfer.quantity, transfer.weight)
        elif transfer.status == 'dispatched':
            add(buckets['dispatched'], transfer.quantity, transfer.weight)
        for loss in transfer.losses:
            add(buckets['lost'], loss.quantity, loss.weight)

    def amounts(bucket):
        return {**bucket, 'weight': float(bucket['weight'])}

    return {
        'serial_no': serial_no, 'items': items,
        'observed_at': datetime.now(timezone.utc).isoformat(),
        'totals': {key: amounts(value) for key, value in buckets.items()},
        'positions': [amounts(value) for value in positions.values()],
        'untracked_count': sum(t.status == 'received' and not t.stock_tracked for t in transfers),
    }
