"""Purpose-scoped serial history reconstructed from committed stock events.

Outbound creation deducts once, edits adjust the delta and void restores it.
Recipient confirmation never deducts the source a second time. Classification
always comes from the source lot received by THIS team, not its next destination.
"""
from collections import defaultdict
from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import Depends, HTTPException, Path, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, lazyload

from .auth import get_current_user
from .database import get_db
from .material_stock import require_team, stock_table
from .models import MaterialTransfer as MT, MaterialTransferEvent, MaterialLoss, User
from .record_filters import RecordFilters, day_bounds

from .async_api import AsyncAPIRouter as APIRouter

router = APIRouter(prefix="/api/team-materials", tags=["serial receipt and dispatch history"])


def iso(value):
    return value.replace(tzinfo=timezone.utc).isoformat()


@router.get("/{team_id}/serial-history")
def history(team_id: int = Path(ge=1), serial_no: str = Query(min_length=1, max_length=80),
            date_from: date | None = None, date_to: date | None = None,
            _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    team = require_team(db, team_id)
    serial_no = serial_no.strip()
    if not serial_no:
        raise HTTPException(422, "请输入完整流水号")
    RecordFilters(date_from=date_from, date_to=date_to).dates(MT.created_at)
    # Exact identity, with leading zeroes; an exhausted serial is still found.
    rows = db.scalars(select(MT).options(lazyload("*")).where(MT.serial_no == serial_no,
        or_(MT.next_team_id == team_id, MT.source_team_id == team_id)).order_by(MT.id)).all()
    received = {row.id: row for row in rows if row.next_team_id == team_id and row.status == "received" and row.stock_tracked}
    outgoing = [row for row in rows if row.source_team_id == team_id and row.source_transfer_id in received]
    losses = db.scalars(select(MaterialLoss).options(lazyload("*")).join(MT, MT.id == MaterialLoss.source_transfer_id)
        .where(MaterialLoss.team_id == team_id, MT.serial_no == serial_no).order_by(MaterialLoss.id)).all()
    audits = defaultdict(list)
    if outgoing:
        # Join instead of an unbounded IN parameter list for long-lived serials.
        for event in db.scalars(select(MaterialTransferEvent).join(MT, MT.id == MaterialTransferEvent.transfer_id)
            .where(MT.source_team_id == team_id, MT.serial_no == serial_no)
            .order_by(MaterialTransferEvent.occurred_at, MaterialTransferEvent.id)):
            audits[event.transfer_id].append(event)
    groups = {}

    def group(lot):
        # A purpose rename never rewrites its old batch snapshot.
        key = f"{lot.purpose_id or 0}:{lot.purpose_name or ''}"
        if key not in groups:
            groups[key] = {"key": key, "purpose_id": lot.purpose_id, "name": lot.purpose_name or "未分类",
                "incoming_quantity": 0, "incoming_weight": Decimal(0), "outgoing_quantity": 0, "outgoing_weight": Decimal(0),
                "lost_quantity": 0, "lost_weight": Decimal(0), "on_hand_quantity": 0, "on_hand_weight": Decimal(0), "events": []}
        return groups[key]

    def add(lot, row, kind, at, quantity, weight, counterpart, delta_quantity, delta_weight, event_id):
        group(lot)["events"].append({"id": event_id, "at": iso(at), "kind": kind, "batch_no": row.batch_no,
            "source_batch_no": lot.batch_no, "material_type": row.material_type, "source_material_type": lot.material_type,
            "counterpart": counterpart, "quantity": int(quantity), "weight": float(weight),
            "delta_quantity": int(delta_quantity), "delta_weight": float(delta_weight), "status": row.status})

    for lot in received.values():
        item = group(lot)
        item["incoming_quantity"] += lot.quantity
        item["incoming_weight"] += lot.weight
        label = "期初库存" if lot.entry_kind == "opening_stock" else (lot.external_source or "外部入库") if lot.entry_kind == "warehouse_receipt" else lot.source_team_name
        add(lot, lot, "opening" if lot.entry_kind == "opening_stock" else "incoming", lot.received_at or lot.created_at,
            lot.quantity, lot.weight, label, lot.quantity, lot.weight, f"receipt-{lot.id}")
    for row in outgoing:
        lot = received[row.source_transfer_id]
        item = group(lot)
        if row.status != "voided":
            item["outgoing_quantity"] += row.quantity
            item["outgoing_weight"] += row.weight
        quantity, weight = 0, Decimal(0)
        events = [event for event in audits[row.id] if event.action in ("created", "updated", "voided")]
        # Pre-audit imports can still be represented, but never claim the exact
        # intermediate edits that were not recorded.
        if not events:
            add(lot, row, "outgoing", row.created_at, row.quantity, row.weight, row.next_team_name or row.external_destination,
                -row.quantity, -row.weight, f"outbound-{row.id}")
            if row.status == "voided":
                add(lot, row, "voided", row.voided_at or row.updated_at, row.quantity, row.weight,
                    row.next_team_name or row.external_destination, row.quantity, row.weight, f"void-{row.id}")
            continue
        for event in events:
            changes = event.changes or {}
            next_quantity = int(changes.get("quantity", {}).get("after", quantity))
            next_weight = Decimal(str(changes.get("weight", {}).get("after", weight)))
            if event.action == "voided":
                delta_q, delta_w, amount_q, amount_w = quantity, weight, quantity, weight
                kind = "voided"
            else:
                delta_q, delta_w = quantity - next_quantity, weight - next_weight
                amount_q, amount_w = abs(delta_q), abs(delta_w)
                kind = "outgoing" if event.action == "created" else "adjusted"
            if delta_q or delta_w:
                add(lot, row, kind, event.occurred_at, amount_q, amount_w, row.next_team_name or row.external_destination,
                    delta_q, delta_w, f"event-{event.id}")
            quantity, weight = next_quantity, next_weight
    for loss in losses:
        lot = received.get(loss.source_transfer_id)
        if not lot:
            continue
        item = group(lot)
        item["lost_quantity"] += loss.quantity
        item["lost_weight"] += loss.weight
        add(lot, lot, "loss", loss.created_at, loss.quantity, loss.weight, loss.reason,
            -loss.quantity, -loss.weight, f"loss-{loss.id}")
    ledger = stock_table(team_id)
    lots = {lot.batch_no: {
        "batch_no": lot.batch_no, "group_key": group(lot)["key"],
        "received_at": iso(lot.received_at or lot.created_at),
        "from_name": "期初库存" if lot.entry_kind == "opening_stock" else
            (lot.external_source or "外部入库") if lot.entry_kind == "warehouse_receipt" else lot.source_team_name,
        "quantity": lot.quantity, "weight": float(lot.weight),
        "on_hand_quantity": 0, "on_hand_weight": 0,
        "baseline_quantity": 0, "baseline_weight": Decimal(0),
        "closing_quantity": 0, "closing_weight": Decimal(0),
        "last_event_at": iso(lot.received_at or lot.created_at),
    } for lot in received.values()}
    for balance in db.execute(select(ledger).where(ledger.c.serial_no == serial_no)).mappings():
        lot = received[balance["transfer_id"]]
        item = group(lot)
        item["on_hand_quantity"] += balance["on_hand_quantity"]
        item["on_hand_weight"] += Decimal(str(balance["on_hand_weight"]))
        lots[lot.batch_no]["on_hand_quantity"] = balance["on_hand_quantity"]
        lots[lot.batch_no]["on_hand_weight"] = float(balance["on_hand_weight"])
    start = iso(day_bounds(date_from)[0]) if date_from else None
    end = iso(day_bounds(date_to)[1]) if date_to else None
    observed_at = iso(datetime.now(timezone.utc))
    # Routes describe effective batches, not every edit of the same batch.
    # Outbound purpose is inherited from this team's received lot, matching
    # the balance curves; the destination's purpose is a separate snapshot.
    flows = []

    def add_flow(lot, row, direction, at, origin, destination):
        stamp = iso(at)
        if (start and stamp < start) or (end and stamp >= end):
            return
        flows.append({"id": f"{direction}-{row.id}", "group_key": group(lot)["key"],
            "direction": direction, "batch_no": row.batch_no, "at": stamp,
            "from_name": origin, "to_name": destination, "quantity": row.quantity,
            "weight": float(row.weight), "status": row.status, "entry_kind": row.entry_kind})

    for lot in received.values():
        origin = "期初库存" if lot.entry_kind == "opening_stock" else (lot.external_source or "外部入库") if lot.entry_kind == "warehouse_receipt" else lot.source_team_name
        add_flow(lot, lot, "incoming", lot.received_at or lot.created_at, origin, team.name)
    for row in outgoing:
        if row.status != "voided":
            add_flow(received[row.source_transfer_id], row, "outgoing", row.created_at,
                     team.name, row.next_team_name or row.external_destination or "外部出库")
    result = []
    for item in groups.values():
        # MySQL timestamps can share a second. Numeric audit IDs preserve edit /
        # void order; receipts precede their deductions at equal timestamps.
        events = sorted(item.pop("events"), key=lambda event: (event["at"],
            0 if event["kind"] in ("incoming", "opening") else 1,
            int(event["id"].rsplit("-", 1)[1])))
        q, w = 0, Decimal(0)
        baseline_q, baseline_w = 0, Decimal(0)
        visible = []
        for event in events:
            q += event["delta_quantity"]
            w += Decimal(str(event["delta_weight"]))
            lot = lots[event["source_batch_no"]]
            if not end or event["at"] < end:
                lot["closing_quantity"] += event["delta_quantity"]
                lot["closing_weight"] += Decimal(str(event["delta_weight"]))
                lot["last_event_at"] = event["at"]
            if start and event["at"] < start:
                baseline_q, baseline_w = q, w
                lot["baseline_quantity"] += event["delta_quantity"]
                lot["baseline_weight"] += Decimal(str(event["delta_weight"]))
                continue
            if end and event["at"] >= end:
                continue
            visible.append({**event, "balance_quantity": q, "balance_weight": float(w)})
        result.append({**{key: float(value) if isinstance(value, Decimal) else value for key, value in item.items()},
                       "baseline_quantity": baseline_q, "baseline_weight": float(baseline_w), "events": visible})
    return {"serial_no": serial_no, "team_name": team.name, "flows": flows,
            "observed_at": observed_at, "closing_at": min(end, observed_at) if end else observed_at,
            "lots": [{key: float(value) if isinstance(value, Decimal) else value for key, value in lot.items()}
                     for lot in lots.values()],
            "found": bool(rows), "date_from": date_from, "date_to": date_to,
            "groups": result, "untracked_count": sum(1 for row in rows if (
                row.next_team_id == team_id and row.status == "received" and not row.stock_tracked
            ) or (row.source_team_id == team_id and row.status != "voided" and row.source_transfer_id not in received)),
            "pending_incoming_count": sum(1 for row in rows if row.next_team_id == team_id and row.status == "pending")}
