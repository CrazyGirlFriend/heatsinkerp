"""Stock balances, ledger queries and outbound document serialization."""

from __future__ import annotations

from datetime import timezone
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import case, cast, func, literal, or_, select, union_all
from sqlalchemy.orm import aliased, lazyload, selectinload
from sqlalchemy.orm.attributes import set_committed_value

from . import material_transfer_workflow as workflow
from .material_weight import (
    stock_sludge_measurements,
)
from .models import (
    MaterialDispatch,
    MaterialLoss,
    MaterialStockBalance,
    MaterialTransfer,
    SerialUrgency,
    Team,
    utcnow,
)
from .schemas import (
    SCRAP_MATERIAL_TYPES,
)
from .team_constants import (
    EXTERNAL_ENTRY_KINDS,
    WAREHOUSE_TEAM_CODE,
)


def require_team(db, team_id):
    team = db.get(Team, team_id)
    if team is None:
        raise HTTPException(404, "team not found")
    return team


def dispatch_status(items):
    statuses = {item.status for item in items}
    if statuses == {"voided"}:
        return "voided"
    active = statuses - {"voided"}
    if active in ({"received"}, {"dispatched"}):
        return next(iter(active))
    return "partial" if active & {"received", "dispatched"} else "pending"


def dispatch_dict(db, dispatch, user, *, items=None, include_history=False):
    from .material_dispatch_workflow import allowed_actions, revision

    if items is None:
        # This branch is used by write/replay transactions. A waiter can have
        # an older REPEATABLE READ snapshot than the newly committed header;
        # its lines must also use a current read, never an empty old snapshot.
        items = db.scalars(
            select(MaterialTransfer)
            .options(
                lazyload("*"),
                # Keep the locking query confined to transfer rows. Load scalar
                # response relationships in batches, without locking joined teams
                # or recursively following the source's own history/relationships.
                selectinload(MaterialTransfer.stock_source)
                .load_only(MaterialTransfer.batch_no, MaterialTransfer.sludge_content_percent)
                .raiseload("*"),
                selectinload(MaterialTransfer.delivery_origin)
                .load_only(
                    MaterialTransfer.batch_no,
                    MaterialTransfer.delivery_date,
                    MaterialTransfer.delivery_quantity,
                )
                .raiseload("*"),
                selectinload(MaterialTransfer.source_team),
                selectinload(MaterialTransfer.next_team),
            )
            .where(MaterialTransfer.dispatch_id == dispatch.id)
            .order_by(MaterialTransfer.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).all()
        # A creation retry can have read the header before batch confirmation
        # committed. Refresh its confirmation metadata after the line locks.
        dispatch = db.scalar(
            select(MaterialDispatch)
            .where(MaterialDispatch.id == dispatch.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        # ORM select-in matching can key this relationship by serial strings in
        # Python. Match in SQL and key by transfer ID to preserve MySQL collation.
        urgencies = dict(
            db.execute(
                select(MaterialTransfer.id, SerialUrgency)
                .select_from(MaterialTransfer)
                .outerjoin(SerialUrgency, MaterialTransfer.serial_no == SerialUrgency.serial_no)
                .where(MaterialTransfer.id.in_([item.id for item in items]))
            ).all()
        )
        for item in items:
            set_committed_value(item, "dispatch", dispatch)
            set_committed_value(item, "urgency", urgencies[item.id])
    if dispatch.dispatch_no is None:
        # This is a retry ledger, not a business document or a second batch identity.
        return {
            "items": [
                workflow.material_transfer_dict(item, user, include_history=include_history)
                for item in items
            ]
        }
    source_record = (
        workflow.material_transfer_dict(items[0], user, include_history=False)["source_team"]
        if items
        else None
    )
    return {
        "id": dispatch.id,
        "barcode_payload": dispatch.dispatch_no,
        "barcode_type": "CODE128",
        "source_team": source_record,
        "revision": revision(dispatch, items),
        "pending_line_count": sum(item.status == "pending" for item in items),
        "allowed_actions": allowed_actions(dispatch, items, user),
        "locked": not any(item.status == "pending" for item in items),
        "confirmed_by": dispatch.confirmed_by,
        "confirmed_by_user_id": dispatch.confirmed_by_user_id,
        "confirmed_at": workflow._utc(dispatch.confirmed_at),
        "dispatch_no": dispatch.dispatch_no,
        "source_team_id": dispatch.source_team_id,
        "entry_kind": dispatch.entry_kind,
        "external_destination": dispatch.external_destination,
        "next_team": {
            "id": dispatch.next_team_id,
            "code": dispatch.next_team_code,
            "name": dispatch.next_team_name,
            "kind": items[0].next_team.kind if items and items[0].next_team else None,
        }
        if dispatch.next_team_id is not None
        else None,
        "created_by": dispatch.created_by,
        "created_at": workflow._utc(dispatch.created_at),
        "notes": dispatch.notes,
        "status": dispatch_status(items),
        "total_quantity": sum(item.quantity for item in items if item.status != "voided"),
        "total_weight": float(
            sum((item.weight for item in items if item.status != "voided"), Decimal(0))
        ),
        "line_count": len(items),
        "items": [
            workflow.material_transfer_dict(item, user, include_history=include_history)
            for item in items
        ],
    }


def stock_table(team_id=None):
    """Read committed lot balances; pending outbound is already deducted."""
    from .inspections import hold_column
    from .stock_balances import AMOUNTS

    balance = MaterialStockBalance
    held = hold_column(MaterialTransfer.id).is_not(None)
    # Internal machining reallocates the same stock. It is neither a new
    # receipt nor a handoff, although its child lots share the stock ledger.
    columns = {name: getattr(balance, name) for name in AMOUNTS}
    for amount in ("quantity", "weight"):
        columns[f"received_{amount}"] = cast(
            case(
                (MaterialTransfer.entry_kind.in_(("processing_output", "rework_split")), 0),
                else_=columns[f"received_{amount}"],
            ),
            getattr(balance, f"received_{amount}").type,
        )
        columns[f"dispatched_{amount}"] -= getattr(balance, f"converted_{amount}")
        columns[f"adjusted_{amount}"] = getattr(balance, f"adjusted_{amount}")
    for amount in ("quantity", "weight"):
        free = columns[f"on_hand_{amount}"]
        columns[f"shortage_{amount}"] = case((free < 0, -free), else_=0)
        columns[f"owned_{amount}"] = free + columns[f"reserved_{amount}"]
        columns[f"external_pending_{amount}"] = (
            columns[f"reserved_{amount}"] - columns[f"in_transit_{amount}"]
        )
        scrap = MaterialTransfer.material_type.in_(SCRAP_MATERIAL_TYPES)
        columns[f"available_{amount}"] = case((or_(scrap, held), 0), else_=free)
        columns[f"scrap_{amount}"] = case((scrap, free), else_=0)
        columns[f"scrap_available_{amount}"] = case((held, 0), (scrap, free), else_=0)
    return (
        select(
            balance.transfer_id,
            balance.team_id,
            MaterialTransfer.batch_no,
            MaterialTransfer.serial_no,
            MaterialTransfer.material_name,
            MaterialTransfer.material_type,
            MaterialTransfer.source_batch_no,
            MaterialTransfer.received_at,
            MaterialTransfer.processing_role,
            MaterialTransfer.shared_group_id,
            MaterialTransfer.shared_unallocated,
            *(value.label(key) for key, value in columns.items()),
        )
        .join(MaterialTransfer, MaterialTransfer.id == balance.transfer_id)
        .where(balance.team_id == team_id if team_id is not None else True)
        .subquery()
    )


BALANCE_KEYS = tuple(
    f"{prefix}_{amount}"
    for prefix in (
        "received",
        "dispatched",
        "reserved",
        "in_transit",
        "lost",
        "on_hand",
        "available",
        "scrap",
        "scrap_available",
        "owned",
        "external_pending",
        "shortage",
        "adjusted",
    )
    for amount in ("quantity", "weight")
)


def balance_dict(row):
    return {
        key: round(float(row[key] or 0), 6) if key.endswith("weight") else int(row[key] or 0)
        for key in BALANCE_KEYS
    }


def literal_query(query, columns):
    from .shared_material import serial_match

    escaped = query.strip().replace("!", "!!").replace("%", "!%").replace("_", "!_")
    return or_(
        *(
            serial_match(column, query, "contains")
            if column.key == "serial_no"
            else column.like(f"%{escaped}%", escape="!")
            for column in columns
        )
    )


def list_stock(
    db,
    team_id,
    user,
    *,
    record_filters=None,
    query=None,
    serial_no=None,
    material_type=None,
    availability="available",
    location_status=None,
    source_ids=None,
    page=1,
    page_size=20,
):
    from .processing_records import annotate_source, source_metadata
    from .record_filters import RecordFilters

    team = require_team(db, team_id)
    stock = stock_table(team_id)
    filters = [stock.c.team_id == team_id]
    if source_ids is not None:
        filters.append(stock.c.transfer_id.in_(source_ids))
    if location_status == "unassigned":
        from .warehouse_placements import unassigned_predicate

        if team.code != WAREHOUSE_TEAM_CODE:
            raise HTTPException(422, "仅库房可以按仓位筛选")
        filters.append(unassigned_predicate(stock))
    filters.extend(
        (record_filters or RecordFilters()).predicates(stock.c.received_at, stock.c.serial_no)
    )
    if serial_no is not None:
        from .shared_material import serial_match

        filters.append(serial_match(stock.c.serial_no, serial_no))
    if availability == "available":
        filters.append(or_(stock.c.available_quantity != 0, stock.c.available_weight != 0))
    child = aliased(MaterialTransfer)
    filters.append(
        or_(
            stock.c.on_hand_quantity > 0,
            stock.c.on_hand_weight > 0,
            ~select(child.id)
            .where(
                child.source_transfer_id == stock.c.transfer_id,
                child.entry_kind == "processing_output",
            )
            .exists(),
        )
    )
    # Outbound selection includes all received lots, even exhausted or overdrawn ones.
    if material_type:
        filters.append(stock.c.material_type == material_type)
    if query and query.strip():
        matches = literal_query(
            query,
            [stock.c.batch_no, stock.c.serial_no, stock.c.material_name, stock.c.source_batch_no],
        )
        if team.code == WAREHOUSE_TEAM_CODE:
            from .models import WarehouseLocation, WarehousePlacement

            location_matches = (
                select(WarehousePlacement.transfer_id)
                .join(WarehouseLocation)
                .where(
                    WarehouseLocation.team_id == team_id,
                    literal_query(query, [WarehouseLocation.name]),
                )
            )
            matches = or_(matches, stock.c.transfer_id.in_(location_matches))
        filters.append(matches)
    total = db.scalar(select(func.count()).select_from(stock).where(*filters)) or 0
    metadata = source_metadata(team_id)
    rows = (
        db.execute(
            select(stock, metadata)
            .outerjoin(metadata, metadata.c.lot_id == stock.c.transfer_id)
            .where(*filters)
            .order_by(stock.c.received_at.desc(), stock.c.transfer_id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        .mappings()
        .all()
    )
    transfers = {
        item.id: item
        for item in db.scalars(
            select(MaterialTransfer)
            .options(*workflow.material_transfer_list_options())
            .where(MaterialTransfer.id.in_([row["transfer_id"] for row in rows]))
        ).all()
    }
    from .warehouse_placements import stock_positions

    items = [
        annotate_source(
            {
                "transfer": workflow.material_transfer_dict(
                    transfers[row["transfer_id"]], user, include_history=False
                ),
                **balance_dict(row),
            },
            row,
        )
        for row in rows
    ]
    return {
        "items": stock_positions(db, stock_sludge_measurements(db, items)),
        "total": total,
        "page": page,
        "page_size": page_size,
        "as_of": utcnow().replace(tzinfo=timezone.utc).isoformat(),
    }


def overview(db, team_id, include_summary=False):
    team = require_team(db, team_id)
    stock = stock_table(team_id)
    materials = (
        db.execute(
            select(
                stock.c.material_name, *(func.sum(stock.c[key]).label(key) for key in BALANCE_KEYS)
            )
            .where(stock.c.team_id == team_id)
            .group_by(stock.c.material_name)
            .order_by(stock.c.material_name)
        )
        .mappings()
        .all()
    )
    # Material groups exhaust this team's ledger, including missing names.
    # Sum raw database amounts before display rounding instead of scanning again.
    totals = {key: sum(row[key] or 0 for row in materials) for key in BALANCE_KEYS}
    types = (
        db.execute(
            select(
                stock.c.material_type, *(func.sum(stock.c[key]).label(key) for key in BALANCE_KEYS)
            )
            .group_by(stock.c.material_type)
            .order_by(stock.c.material_type)
        )
        .mappings()
        .all()
    )
    pending = db.execute(
        select(
            func.count(MaterialTransfer.id),
            func.sum(MaterialTransfer.quantity),
            func.sum(MaterialTransfer.weight),
        ).where(MaterialTransfer.next_team_id == team_id, MaterialTransfer.status == "pending")
    ).one()
    pending_batches = {}
    if team.code == WAREHOUSE_TEAM_CODE and team.kind == "warehouse":
        # batch_no is unique and non-null: each pending row is exactly one batch.
        pending_batches["batch_count"] = pending[0]
    legacy = (
        db.scalar(
            select(func.count(MaterialTransfer.id)).where(
                MaterialTransfer.next_team_id == team_id,
                MaterialTransfer.status == "received",
                MaterialTransfer.stock_tracked.is_(False),
            )
        )
        or 0
    )
    summary = {}
    if include_summary:
        from .team_dashboard import current_stock_summary, work_order_summary

        summary["current_stock"] = current_stock_summary(db, team, stock)
        summary["work_orders"] = work_order_summary(db, team, stock)
    return {
        **summary,
        "team_id": team_id,
        "as_of": utcnow().replace(tzinfo=timezone.utc).isoformat(),
        "totals": balance_dict(totals),
        "material_types": [
            {"material_type": row["material_type"], **balance_dict(row)} for row in types
        ],
        "materials": [
            {"material_name": row["material_name"], **balance_dict(row)} for row in materials
        ],
        "pending_incoming": {
            "count": pending[0],
            "quantity": int(pending[1] or 0),
            "weight": float(pending[2] or 0),
            **pending_batches,
        },
        "legacy_received_count": legacy,
    }


def list_losses(
    db,
    team_id,
    *,
    record_filters=None,
    query=None,
    serial_no=None,
    source_transfer_id=None,
    page=1,
    page_size=20,
):
    from .record_filters import RecordFilters, urgent_serials

    require_team(db, team_id)
    filters = [MaterialLoss.team_id == team_id]
    record_filters = record_filters or RecordFilters()
    filters.extend(record_filters.dates(MaterialLoss.created_at))
    if record_filters.urgent_only:
        filters.append(
            MaterialLoss.source_transfer_id.in_(
                select(MaterialTransfer.id).where(MaterialTransfer.serial_no.in_(urgent_serials()))
            )
        )
    if serial_no is not None:
        filters.append(
            MaterialLoss.source_transfer_id.in_(
                select(MaterialTransfer.id).where(MaterialTransfer.serial_no == serial_no.strip())
            )
        )
    if source_transfer_id:
        filters.append(MaterialLoss.source_transfer_id == source_transfer_id)
    if query and query.strip():
        ids = select(MaterialTransfer.id).where(
            literal_query(
                query,
                [
                    MaterialTransfer.batch_no,
                    MaterialTransfer.serial_no,
                    MaterialTransfer.material_name,
                ],
            )
        )
        filters.append(MaterialLoss.source_transfer_id.in_(ids))
    total = db.scalar(select(func.count(MaterialLoss.id)).where(*filters)) or 0
    rows = db.scalars(
        select(MaterialLoss)
        .where(*filters)
        .order_by(MaterialLoss.created_at.desc(), MaterialLoss.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return {
        "items": [workflow.material_loss_dict(row) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


def list_outbound_batches(
    db,
    team_id,
    user,
    *,
    record_filters,
    query=None,
    next_team_id=None,
    status=None,
    entry_kind=None,
    material_type=None,
    page=1,
    page_size=20,
):
    require_team(db, team_id)
    mt = MaterialTransfer
    filters = [
        mt.source_team_id == team_id,
        mt.entry_kind.in_(["transfer", *EXTERNAL_ENTRY_KINDS]),
        *record_filters.predicates(mt.created_at, mt.serial_no),
    ]
    for column, value in (
        (mt.next_team_id, next_team_id),
        (mt.status, status),
        (mt.entry_kind, entry_kind),
        (mt.material_type, material_type),
    ):
        if value is not None:
            filters.append(column == value)
    if query and query.strip():
        filters.append(
            literal_query(
                query,
                [
                    mt.batch_no,
                    mt.serial_no,
                    mt.material_name,
                    mt.external_destination,
                    mt.purpose_name,
                ],
            )
        )
    total = db.scalar(select(func.count(mt.id)).where(*filters)) or 0
    items = db.scalars(
        select(mt)
        .options(*workflow.material_transfer_list_options())
        .where(*filters)
        .order_by(mt.created_at.desc(), mt.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return {
        "items": [
            workflow.material_transfer_dict(item, user, include_history=False) for item in items
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


def list_dispatches(
    db,
    team_id,
    user,
    *,
    record_filters=None,
    query=None,
    next_team_id=None,
    status=None,
    entry_kind=None,
    page=1,
    page_size=20,
):
    from .record_filters import RecordFilters, urgent_serials

    record_filters = record_filters or RecordFilters()
    require_team(db, team_id)
    mt = MaterialTransfer
    # Union is only the lightweight page index; line details are fetched for
    # that page, not grouped after pagination in the browser.
    dispatch_number, batch_number = MaterialDispatch.dispatch_no, mt.batch_no
    if db.get_bind().dialect.name == "mysql":
        # Fresh schemas use case-sensitive batch numbers; old dispatch numbers
        # may use the database default. UNION requires a common collation.
        dispatch_number = dispatch_number.collate("utf8mb4_0900_as_cs")
        batch_number = batch_number.collate("utf8mb4_0900_as_cs")
    statuses = case(
        (func.sum(case((mt.status != "voided", 1), else_=0)) == 0, "voided"),
        (
            (func.sum(case((mt.status == "pending", 1), else_=0)) == 0)
            & (func.sum(case((mt.status == "dispatched", 1), else_=0)) > 0),
            "dispatched",
        ),
        (func.sum(case((mt.status == "pending", 1), else_=0)) == 0, "received"),
        (func.sum(case((mt.status.in_(["received", "dispatched"]), 1), else_=0)) > 0, "partial"),
        else_="pending",
    )
    grouped = (
        select(
            MaterialDispatch.id.label("group_id"),
            literal(None).label("single_id"),
            dispatch_number.label("dispatch_no"),
            MaterialDispatch.created_at.label("created_at"),
            MaterialDispatch.next_team_id.label("next_team_id"),
            statuses.label("status"),
        )
        .join(mt, mt.dispatch_id == MaterialDispatch.id)
        .where(
            MaterialDispatch.source_team_id == team_id, MaterialDispatch.dispatch_no.is_not(None)
        )
        .group_by(
            MaterialDispatch.id,
            MaterialDispatch.dispatch_no,
            MaterialDispatch.created_at,
            MaterialDispatch.next_team_id,
        )
    )
    singles = (
        select(
            literal(None).label("group_id"),
            mt.id.label("single_id"),
            batch_number.label("dispatch_no"),
            mt.created_at.label("created_at"),
            mt.next_team_id.label("next_team_id"),
            mt.status.label("status"),
        )
        .outerjoin(MaterialDispatch, mt.dispatch_id == MaterialDispatch.id)
        .where(
            mt.source_team_id == team_id,
            mt.entry_kind.in_(["transfer", *EXTERNAL_ENTRY_KINDS]),
            MaterialDispatch.dispatch_no.is_(None),
        )
    )
    if entry_kind:
        grouped = grouped.where(MaterialDispatch.entry_kind == entry_kind)
        singles = singles.where(mt.entry_kind == entry_kind)
    if query and query.strip():
        matching_groups = select(mt.dispatch_id).where(
            mt.source_team_id == team_id,
            literal_query(query, [mt.batch_no, mt.serial_no, mt.material_name]),
        )
        grouped = grouped.where(
            or_(
                literal_query(
                    query, [MaterialDispatch.dispatch_no, MaterialDispatch.external_destination]
                ),
                MaterialDispatch.id.in_(matching_groups),
            )
        )
        singles = singles.where(literal_query(query, [mt.batch_no, mt.serial_no, mt.material_name]))
    grouped = grouped.where(*record_filters.dates(MaterialDispatch.created_at))
    singles = singles.where(*record_filters.dates(mt.created_at))
    if record_filters.urgent_only:
        matching = select(mt.dispatch_id).where(
            mt.serial_no.in_(urgent_serials()), mt.status != "voided"
        )
        grouped = grouped.where(MaterialDispatch.id.in_(matching))
        singles = singles.where(mt.serial_no.in_(urgent_serials()), mt.status != "voided")
    index = union_all(grouped, singles).subquery()
    filters = []
    if next_team_id:
        filters.append(index.c.next_team_id == next_team_id)
    if status:
        filters.append(index.c.status == status)
    total = db.scalar(select(func.count()).select_from(index).where(*filters)) or 0
    rows = (
        db.execute(
            select(index)
            .where(*filters)
            .order_by(index.c.created_at.desc(), index.c.dispatch_no.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        .mappings()
        .all()
    )
    group_ids = [row["group_id"] for row in rows if row["group_id"] is not None]
    single_ids = [row["single_id"] for row in rows if row["single_id"] is not None]
    groups = {
        group.id: group
        for group in db.scalars(
            select(MaterialDispatch).where(MaterialDispatch.id.in_(group_ids))
        ).all()
    }
    transfers = db.scalars(
        select(mt)
        .options(*workflow.material_transfer_list_options())
        .where(or_(mt.dispatch_id.in_(group_ids), mt.id.in_(single_ids)))
        .order_by(mt.id)
    ).all()
    items = []
    for row in rows:
        if row["group_id"] is not None:
            items.append(
                dispatch_dict(
                    db,
                    groups[row["group_id"]],
                    user,
                    items=[item for item in transfers if item.dispatch_id == row["group_id"]],
                )
            )
        else:
            item = next(item for item in transfers if item.id == row["single_id"])
            record = workflow.material_transfer_dict(item, user, include_history=False)
            items.append(
                {
                    "dispatch_no": item.batch_no,
                    "source_team_id": team_id,
                    "next_team": record["next_team"],
                    "entry_kind": item.entry_kind,
                    "external_destination": item.external_destination,
                    "created_by": item.created_by,
                    "created_at": record["created_at"],
                    "notes": item.notes,
                    "status": item.status,
                    "total_quantity": 0 if item.status == "voided" else item.quantity,
                    "total_weight": 0 if item.status == "voided" else float(item.weight),
                    "line_count": 1,
                    "items": [record],
                }
            )
    return {"items": items, "total": total, "page": page, "page_size": page_size}
