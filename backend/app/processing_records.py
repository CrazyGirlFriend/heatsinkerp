"""Read audited processing counts without rewriting received material batches."""
from fastapi import HTTPException
from sqlalchemy import and_, case, func, or_, select

from . import material_stock as stock
from .material_transfer_workflow import _utc, material_transfer_dict, material_transfer_list_options
from .models import MaterialQuantityAdjustment as Adjustment
from .models import MaterialTransfer as Transfer
from .models import utcnow
from .quantity_adjustments import record_dict
from .record_filters import RecordFilters
from .schemas import SCRAP_MATERIAL_TYPES
from .processing_statistics import weight_difference_table


def registered_lots(team_id):
    # Children inherit their creation's registration until they are processed
    # again. Their own latest record then takes precedence over the parent.
    latest = select(Adjustment.source_transfer_id.label("lot_id"), func.max(Adjustment.id).label("latest_id")).where(
        Adjustment.team_id == team_id, ~Adjustment.idempotency_key.like("outbound-clear:%")
    ).group_by(Adjustment.source_transfer_id).subquery()
    parent = latest.alias("parent_processing")
    own = Adjustment.__table__.alias("own_processing_record")
    inherited = Adjustment.__table__.alias("inherited_processing_record")
    return select(Transfer.id.label("lot_id"), func.coalesce(latest.c.latest_id, parent.c.latest_id).label("latest_id"),
        case((own.c.processing_status.is_not(None), own.c.processing_status),
             (Transfer.processing_role == "remaining", "partial"),
             (Transfer.processing_role == "produced", "complete"), else_=inherited.c.processing_status).label("processing_status"),
        case((own.c.id.is_not(None), own.c.after_specification), else_=Transfer.transfer_specification).label("after_specification")
    ).select_from(Transfer).outerjoin(latest, latest.c.lot_id == Transfer.id).outerjoin(own, own.c.id == latest.c.latest_id).outerjoin(
        parent, and_(Transfer.entry_kind == "processing_output", parent.c.lot_id == Transfer.source_transfer_id)).outerjoin(
        inherited, inherited.c.id == parent.c.latest_id).where(Transfer.next_team_id == team_id,
        or_(latest.c.latest_id.is_not(None), parent.c.latest_id.is_not(None))).subquery()


def summary_columns(balance, registered):
    remaining = or_(balance.c.on_hand_quantity > 0, balance.c.on_hand_weight > 0)
    applicable = ~func.coalesce(balance.c.material_type, "").in_(SCRAP_MATERIAL_TYPES)
    columns = []
    for name, predicate in (("registered", registered.c.latest_id.is_not(None)), ("unregistered", registered.c.latest_id.is_(None))):
        current = remaining & applicable & predicate
        columns.append(func.sum(case((current, 1), else_=0)).label(f"processing_{name}_batch_count"))
        for amount in ("quantity", "weight"):
            columns.append(func.sum(case((current, balance.c[f"on_hand_{amount}"]), else_=0)).label(f"processing_{name}_{amount}"))
    for progress in ("partial", "complete"):
        columns.append(func.sum(case((remaining & applicable & (registered.c.processing_status == progress), 1), else_=0)).label(f"processing_{progress}_batch_count"))
    return columns


def state(material_type, quantity, weight, pending_quantity, pending_weight, registered, progress=None):
    if material_type in SCRAP_MATERIAL_TYPES:
        return "not_applicable"
    if quantity > 0 or weight > 0:
        return progress or ("registered" if registered else "unregistered")
    if pending_quantity > 0 or pending_weight > 0:
        return "pending"
    return "cleared"


def source_metadata(team_id):
    """Join processing and weight-family facts into the existing page read."""
    registered = registered_lots(team_id)
    differences = weight_difference_table(team_id)
    return select(differences.c.transfer_id.label("lot_id"), differences.c.weight_root_transfer_id,
        differences.c.weight_difference, registered.c.latest_id, registered.c.processing_status,
        registered.c.after_specification).select_from(differences).outerjoin(
            registered, registered.c.lot_id == differences.c.transfer_id).subquery()


def annotate_source(item, metadata):
    item["processing_state"] = state(item["transfer"]["material_type"], item["on_hand_quantity"], item["on_hand_weight"],
        item["in_transit_quantity"], item["in_transit_weight"], metadata["latest_id"] is not None, metadata["processing_status"])
    item["current_specification"] = metadata["after_specification"] if metadata["after_specification"] is not None else item["transfer"]["transfer_specification"]
    if metadata["weight_root_transfer_id"] is not None:
        item.update(weight_root_transfer_id=metadata["weight_root_transfer_id"], weight_difference=float(metadata["weight_difference"]))
    return item


def require_processing_team(db, team_id):
    team = stock.require_team(db, team_id)
    if team.code not in ("FACTORY-ROLL", "FACTORY-WIRE", "FACTORY-ENGRAVE") or team.kind != "production":
        raise HTTPException(422, "当前加工登记页面用于轧制、线切割和雕刻班组")


def list_sources(db, team_id, user, *, group_id=None, query=None, page=1, page_size=20):
    require_processing_team(db, team_id)
    balance = stock.stock_table(team_id)
    conditions = [~func.coalesce(balance.c.material_type, "").in_(SCRAP_MATERIAL_TYPES),
                  or_(balance.c.on_hand_quantity > 0, balance.c.on_hand_weight > 0)]
    if group_id is not None:
        from .warehouse_inventory import group_conditions, origin_columns
        origins = origin_columns()
        anchor = db.execute(select(*(column.label(name) for name, column in origins.items())).where(
            Transfer.id == group_id, Transfer.next_team_id == team_id,
            Transfer.status == "received", Transfer.stock_tracked.is_(True))).mappings().first()
        if anchor is None:
            raise HTTPException(404, "未找到本班组的库存来源")
        conditions.extend(group_conditions(origins, anchor))
    if query and query.strip():
        conditions.append(stock.literal_query(query, [Transfer.serial_no, Transfer.batch_no, Transfer.material_name]))
    statement = select(Transfer, balance).join(balance, balance.c.transfer_id == Transfer.id).where(*conditions)
    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    metadata = source_metadata(team_id)
    statement = statement.add_columns(metadata).outerjoin(metadata, metadata.c.lot_id == Transfer.id)
    rows = db.execute(statement.options(*material_transfer_list_options()).order_by(Transfer.received_at.desc(), Transfer.id.desc())
        .offset((page - 1) * page_size).limit(page_size)).unique().all()
    items = [annotate_source({"transfer": material_transfer_dict(row[0], user, include_history=False),
        **stock.balance_dict(row._mapping)}, row._mapping) for row in rows]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


def output_balances(db, team_id, lot_ids):
    """Current local holdings of a lot and its internal processing descendants."""
    if not lot_ids:
        return {}
    descendants = select(Transfer.id.label("root_id"), Transfer.id.label("transfer_id")).where(
        Transfer.id.in_(lot_ids), Transfer.next_team_id == team_id).cte("processing_descendants", recursive=True)
    descendants = descendants.union_all(select(descendants.c.root_id, Transfer.id).select_from(Transfer).join(
        descendants, Transfer.source_transfer_id == descendants.c.transfer_id).where(
            Transfer.entry_kind == "processing_output", Transfer.next_team_id == team_id))
    balance = stock.stock_table(team_id)
    keys = ("on_hand_quantity", "on_hand_weight", "in_transit_quantity", "in_transit_weight", "owned_quantity", "owned_weight")
    remaining = or_(balance.c.on_hand_quantity > 0, balance.c.on_hand_weight > 0)
    registered = registered_lots(team_id)
    scrap = func.coalesce(balance.c.material_type, "").in_(SCRAP_MATERIAL_TYPES)
    rows = db.execute(select(descendants.c.root_id,
        *(func.sum(balance.c[key]).label(key) for key in keys),
        func.max(case((remaining & ~scrap & (registered.c.processing_status == "partial"), 1), else_=0)).label("partial"),
        func.max(case((remaining & (scrap | (registered.c.processing_status == "complete")), 1), else_=0)).label("complete")
    ).select_from(descendants).join(balance, balance.c.transfer_id == descendants.c.transfer_id).outerjoin(
        registered, registered.c.lot_id == descendants.c.transfer_id).group_by(descendants.c.root_id)).mappings()
    return {row["root_id"]: {**{key: float(row[key]) if key.endswith("weight") else int(row[key]) for key in keys},
                             "progress": "partial" if row["partial"] else "complete" if row["complete"] else None}
            for row in rows}


def list_records(db, team_id, *, record_filters=None, query=None, page=1, page_size=20):
    require_processing_team(db, team_id)
    balance = stock.stock_table(team_id)
    registered = registered_lots(team_id)
    conditions = [Adjustment.team_id == team_id, ~Adjustment.idempotency_key.like("outbound-clear:%"),
                  ~func.coalesce(Transfer.material_type, "").in_(SCRAP_MATERIAL_TYPES)]
    conditions.extend((record_filters or RecordFilters()).predicates(Adjustment.created_at, Transfer.serial_no))
    if query and query.strip():
        conditions.append(stock.literal_query(query, [Transfer.serial_no, Transfer.batch_no, Transfer.material_name, Adjustment.created_by, Adjustment.reason]))
    statement = select(Adjustment, Transfer.serial_no, Transfer.shared_group_id, Transfer.shared_unallocated, Transfer.batch_no, Transfer.material_name, Transfer.material_type,
        Transfer.purpose_name, balance.c.on_hand_quantity, balance.c.on_hand_weight, balance.c.in_transit_quantity,
        balance.c.in_transit_weight, registered.c.latest_id, registered.c.processing_status.label("current_processing_status")).join(Transfer, Transfer.id == Adjustment.source_transfer_id).join(
        balance, balance.c.transfer_id == Transfer.id).join(registered, registered.c.lot_id == Transfer.id).where(*conditions)
    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    rows = db.execute(statement.order_by(Adjustment.created_at.desc(), Adjustment.id.desc())
        .offset((page - 1) * page_size).limit(page_size)).all()
    snapshots = [record_dict(row[0]) for row in rows]
    lot_ids = {row[0].source_transfer_id for row in rows}
    lot_ids.update(output["id"] for item in snapshots for output in (item.get("outputs") or []))
    balances = output_balances(db, team_id, lot_ids)
    items = []
    for row, snapshot in zip(rows, snapshots):
        current = row._mapping
        # Keep the immutable output quantities, sizes and roles beside their
        # current balances; never present the depleted input as lost output.
        snapshot["outputs"] = [{**output, **{key: value for key, value in balances.get(output["id"], {}).items() if key != "progress"}}
                               for output in (snapshot.get("outputs") or [])]
        holdings = balances.get(row[0].source_transfer_id, {})
        if snapshot["outputs"]:
            # Reservations made before this processing belong to the original
            # input, not the newly created output family's current holdings.
            descendants = [balances.get(output["id"], {}) for output in snapshot["outputs"]]
            holdings = {key: sum(item.get(key, 0) for item in descendants) for key in (
                "on_hand_quantity", "on_hand_weight", "in_transit_quantity", "in_transit_weight", "owned_quantity", "owned_weight")}
            holdings["progress"] = "partial" if any(item.get("progress") == "partial" for item in descendants) else (
                "complete" if any(item.get("progress") == "complete" for item in descendants) else None)
        items.append({**snapshot, **{key: current[key] for key in ("serial_no", "shared_group_id", "shared_unallocated", "batch_no", "material_name", "material_type", "purpose_name")},
            **{key: value for key, value in holdings.items() if key != "progress"},
            "processing_state": state(current["material_type"], holdings.get("on_hand_quantity", 0), holdings.get("on_hand_weight", 0),
                holdings.get("in_transit_quantity", 0), holdings.get("in_transit_weight", 0), True,
                holdings.get("progress") or current["current_processing_status"])})
    from .shared_material import annotate_groups
    return {"items": annotate_groups(db, items), "total": total, "page": page, "page_size": page_size, "as_of": _utc(utcnow())}
