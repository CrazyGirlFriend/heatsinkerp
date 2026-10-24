"""Read audited processing counts without rewriting received material batches."""

from fastapi import HTTPException
from sqlalchemy import and_, case, func, or_, select

from . import material_stock as stock
from .material_transfer_workflow import _utc, material_transfer_dict, material_transfer_list_options
from .models import MaterialQuantityAdjustment as Adjustment
from .models import MaterialTransfer as Transfer
from .models import TeamEmployee, utcnow
from .processing_registration import METRICS, SUMMARY_METRICS
from .processing_statistics import weight_difference_table
from .quantity_adjustments import record_dict
from .record_filters import RecordFilters, urgent_serials
from .schemas import SCRAP_MATERIAL_TYPES
from .team_constants import PROCESSING_TEAM_CODES


def registered_lots(team_id):
    # Children inherit their creation's registration until they are processed
    # again. Their own latest record then takes precedence over the parent.
    latest = (
        select(
            Adjustment.source_transfer_id.label("lot_id"),
            func.max(Adjustment.id).label("latest_id"),
        )
        .where(Adjustment.team_id == team_id, ~Adjustment.idempotency_key.like("outbound-clear:%"))
        .group_by(Adjustment.source_transfer_id)
        .subquery()
    )
    parent = latest.alias("parent_processing")
    own = Adjustment.__table__.alias("own_processing_record")
    inherited = Adjustment.__table__.alias("inherited_processing_record")
    return (
        select(
            Transfer.id.label("lot_id"),
            func.coalesce(latest.c.latest_id, parent.c.latest_id).label("latest_id"),
            case(
                (Transfer.rework_pending.is_(True), "unregistered"),
                (own.c.processing_status.is_not(None), own.c.processing_status),
                (Transfer.entry_kind == "serial_reallocation", Transfer.sent_processing_status),
                (Transfer.processing_role == "remaining", "unregistered"),
                (Transfer.processing_role == "produced", "complete"),
                else_=inherited.c.processing_status,
            ).label("processing_status"),
            case(
                (own.c.id.is_not(None), own.c.after_specification),
                else_=Transfer.transfer_specification,
            ).label("after_specification"),
        )
        .select_from(Transfer)
        .outerjoin(latest, latest.c.lot_id == Transfer.id)
        .outerjoin(own, own.c.id == latest.c.latest_id)
        .outerjoin(
            parent,
            and_(
                Transfer.entry_kind.in_(("processing_output", "serial_reallocation")),
                Transfer.processing_role != "remaining",
                parent.c.lot_id == Transfer.source_transfer_id,
            ),
        )
        .outerjoin(inherited, inherited.c.id == parent.c.latest_id)
        .where(
            Transfer.next_team_id == team_id,
            or_(
                Transfer.rework_pending.is_(True),
                latest.c.latest_id.is_not(None),
                parent.c.latest_id.is_not(None),
                and_(
                    Transfer.entry_kind == "serial_reallocation",
                    Transfer.sent_processing_status == "complete",
                ),
            ),
        )
        .subquery()
    )


def summary_columns(balance, registered):
    remaining = or_(balance.c.on_hand_quantity > 0, balance.c.on_hand_weight > 0)
    applicable = ~func.coalesce(balance.c.material_type, "").in_(SCRAP_MATERIAL_TYPES)
    columns = []
    for name, predicate in (
        (
            "registered",
            and_(
                func.coalesce(registered.c.processing_status, "") != "unregistered",
                or_(
                    registered.c.latest_id.is_not(None),
                    registered.c.processing_status == "complete",
                ),
            ),
        ),
        (
            "unregistered",
            or_(
                registered.c.processing_status == "unregistered",
                and_(
                    registered.c.latest_id.is_(None),
                    func.coalesce(registered.c.processing_status, "") != "complete",
                ),
            ),
        ),
    ):
        current = remaining & applicable & predicate
        columns.append(
            func.sum(case((current, 1), else_=0)).label(f"processing_{name}_batch_count")
        )
        for amount in ("quantity", "weight"):
            columns.append(
                func.sum(case((current, balance.c[f"on_hand_{amount}"]), else_=0)).label(
                    f"processing_{name}_{amount}"
                )
            )
    for progress in ("partial", "complete"):
        columns.append(
            func.sum(
                case(
                    (remaining & applicable & (registered.c.processing_status == progress), 1),
                    else_=0,
                )
            ).label(f"processing_{progress}_batch_count")
        )
    return columns


def state(
    material_type, quantity, weight, pending_quantity, pending_weight, registered, progress=None
):
    if material_type in SCRAP_MATERIAL_TYPES:
        return "not_applicable"
    if quantity > 0 or weight > 0:
        return progress or ("registered" if registered else "unregistered")
    if pending_quantity > 0 or pending_weight > 0:
        return "pending"
    return "cleared"


def source_metadata(team_id):
    """Join processing and weight-family facts into the existing page read."""
    from .inspections import hold_column

    registered = registered_lots(team_id)
    differences = weight_difference_table(team_id)
    return (
        select(
            differences.c.transfer_id.label("lot_id"),
            hold_column(differences.c.transfer_id).label("inspection_hold_id"),
            differences.c.weight_root_transfer_id,
            differences.c.weight_difference,
            registered.c.latest_id,
            registered.c.processing_status,
            registered.c.after_specification,
        )
        .select_from(differences)
        .outerjoin(registered, registered.c.lot_id == differences.c.transfer_id)
        .subquery()
    )


def annotate_source(item, metadata):
    item["inspection_hold_id"] = metadata.get("inspection_hold_id")
    item["processing_state"] = state(
        item["transfer"]["material_type"],
        item["on_hand_quantity"],
        item["on_hand_weight"],
        item["in_transit_quantity"],
        item["in_transit_weight"],
        metadata["latest_id"] is not None,
        metadata["processing_status"],
    )
    item["current_specification"] = (
        metadata["after_specification"]
        if metadata["after_specification"] is not None
        else item["transfer"]["transfer_specification"]
    )
    if metadata["weight_root_transfer_id"] is not None:
        item.update(
            weight_root_transfer_id=metadata["weight_root_transfer_id"],
            weight_difference=float(metadata["weight_difference"]),
        )
    return item


def require_processing_team(db, team_id):
    team = stock.require_team(db, team_id)
    if team.code not in PROCESSING_TEAM_CODES or team.kind != "production":
        raise HTTPException(422, "库房不登记加工，请选择生产班组")
    return team


def list_sources(
    db, team_id, user, *, group_id=None, rework_record_id=None, query=None, page=1, page_size=20
):
    require_processing_team(db, team_id)
    balance = stock.stock_table(team_id)
    registered = registered_lots(team_id)
    from .process_routes import local_work_pending
    from .processing_tasks import can_continue, completed_work

    live_lots = select(balance.c.transfer_id).where(
        or_(balance.c.on_hand_quantity > 0, balance.c.on_hand_weight > 0),
        ~func.coalesce(balance.c.material_type, "").in_(SCRAP_MATERIAL_TYPES),
    )

    conditions = [
        or_(
            and_(
                Transfer.process_route_id.is_(None),
                or_(
                    func.coalesce(registered.c.processing_status, "") != "complete",
                    can_continue(team_id, live_lots),
                ),
            ),
            and_(Transfer.process_route_id.is_not(None), local_work_pending()),
            Transfer.rework_pending.is_(True),
        ),
        ~func.coalesce(balance.c.material_type, "").in_(SCRAP_MATERIAL_TYPES),
        or_(balance.c.on_hand_quantity > 0, balance.c.on_hand_weight > 0),
    ]
    if rework_record_id is not None:
        from .material_lineage import relatives

        record = db.get(Adjustment, rework_record_id)
        if record is None or record.team_id != team_id:
            raise HTTPException(404, "未找到本班组加工记录")
        family = relatives([record.source_transfer_id], name="rework_candidates")
        completed = completed_work(team_id, live_lots).subquery()
        returned = completed_work(
            team_id, live_lots, local=False, name="returned_processing_task_ancestors"
        ).subquery()
        conditions[0] = or_(
            select(completed.c.work_id)
            .where(
                completed.c.lot_id == Transfer.id,
                completed.c.work_id == record.id,
            )
            .correlate(Transfer)
            .exists(),
            and_(
                Transfer.rework_pending.is_(True),
                select(returned.c.work_id)
                .where(
                    returned.c.lot_id == Transfer.id,
                    returned.c.work_id == record.id,
                )
                .correlate(Transfer)
                .exists(),
            ),
        )
        conditions.append(Transfer.id.in_(select(family.c.id)))
    if group_id is not None:
        from .warehouse_inventory import group_conditions, origin_columns

        origins = origin_columns()
        anchor = (
            db.execute(
                select(*(column.label(name) for name, column in origins.items())).where(
                    Transfer.id == group_id,
                    Transfer.next_team_id == team_id,
                    Transfer.status == "received",
                    Transfer.stock_tracked.is_(True),
                )
            )
            .mappings()
            .first()
        )
        if anchor is None:
            raise HTTPException(404, "未找到本班组的库存来源")
        conditions.extend(group_conditions(origins, anchor))
    if query and query.strip():
        conditions.append(
            stock.literal_query(
                query, [Transfer.serial_no, Transfer.batch_no, Transfer.material_name]
            )
        )
    statement = (
        select(Transfer, balance)
        .join(balance, balance.c.transfer_id == Transfer.id)
        .outerjoin(registered, registered.c.lot_id == Transfer.id)
        .where(*conditions)
    )
    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    metadata = source_metadata(team_id)
    statement = statement.add_columns(metadata).outerjoin(
        metadata, metadata.c.lot_id == Transfer.id
    )
    rows = (
        db.execute(
            statement.options(*material_transfer_list_options())
            .order_by(Transfer.received_at.desc(), Transfer.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        .unique()
        .all()
    )
    items = [
        annotate_source(
            {
                "transfer": material_transfer_dict(row[0], user, include_history=False),
                **stock.balance_dict(row._mapping),
            },
            row._mapping,
        )
        for row in rows
    ]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


def output_balances(db, team_id, lot_ids):
    """Current local holdings of a lot and its internal processing descendants."""
    if not lot_ids:
        return {}
    descendants = (
        select(Transfer.id.label("root_id"), Transfer.id.label("transfer_id"))
        .where(Transfer.id.in_(lot_ids), Transfer.next_team_id == team_id)
        .cte("processing_descendants", recursive=True)
    )
    descendants = descendants.union_all(
        select(descendants.c.root_id, Transfer.id)
        .select_from(Transfer)
        .join(descendants, Transfer.source_transfer_id == descendants.c.transfer_id)
        .where(Transfer.entry_kind == "processing_output", Transfer.next_team_id == team_id)
    )
    balance = stock.stock_table(team_id)
    keys = (
        "on_hand_quantity",
        "on_hand_weight",
        "in_transit_quantity",
        "in_transit_weight",
        "owned_quantity",
        "owned_weight",
    )
    remaining = or_(balance.c.on_hand_quantity > 0, balance.c.on_hand_weight > 0)
    registered = registered_lots(team_id)
    scrap = func.coalesce(balance.c.material_type, "").in_(SCRAP_MATERIAL_TYPES)
    rows = db.execute(
        select(
            descendants.c.root_id,
            *(func.sum(balance.c[key]).label(key) for key in keys),
            func.max(
                case(
                    (
                        remaining
                        & ~scrap
                        & or_(
                            registered.c.processing_status == "partial",
                            and_(
                                Transfer.processing_role == "remaining",
                                registered.c.latest_id.is_(None),
                            ),
                        ),
                        1,
                    ),
                    else_=0,
                )
            ).label("partial"),
            func.max(
                case(
                    (remaining & (scrap | (registered.c.processing_status == "complete")), 1),
                    else_=0,
                )
            ).label("complete"),
        )
        .select_from(descendants)
        .join(Transfer, Transfer.id == descendants.c.transfer_id)
        .join(balance, balance.c.transfer_id == descendants.c.transfer_id)
        .outerjoin(registered, registered.c.lot_id == descendants.c.transfer_id)
        .group_by(descendants.c.root_id)
    ).mappings()
    return {
        row["root_id"]: {
            **{key: float(row[key]) if key.endswith("weight") else int(row[key]) for key in keys},
            "progress": "partial" if row["partial"] else "complete" if row["complete"] else None,
        }
        for row in rows
    }


def record_conditions(
    team_id,
    record_filters=None,
    query=None,
    processor_id=None,
    work_date=None,
    work_kind=None,
    processing_task_id=None,
    purpose_id=None,
):
    filters = record_filters or RecordFilters()
    if filters.date_from and filters.date_to and filters.date_from > filters.date_to:
        raise HTTPException(422, "开始日期不能晚于结束日期")
    conditions = [
        Adjustment.team_id == team_id,
        ~Adjustment.idempotency_key.like("outbound-clear:%"),
        ~func.coalesce(Transfer.material_type, "").in_(SCRAP_MATERIAL_TYPES),
    ]
    if work_kind:
        conditions.append(Adjustment.work_kind == work_kind)
    if filters.date_from:
        conditions.append(Adjustment.processing_date >= filters.date_from)
    if filters.date_to:
        conditions.append(Adjustment.processing_date <= filters.date_to)
    if filters.urgent_only:
        conditions.append(Transfer.serial_no.in_(urgent_serials()))
    if processor_id:
        conditions.append(Adjustment.processor_employee_id == processor_id)
    if processing_task_id:
        conditions.append(Adjustment.processing_task_id == processing_task_id)
    if purpose_id:
        conditions.append(Adjustment.purpose_id == purpose_id)
    if work_date:
        conditions.append(Adjustment.processing_date == work_date)
    if query and query.strip():
        conditions.append(
            stock.literal_query(
                query,
                [
                    Transfer.serial_no,
                    Transfer.batch_no,
                    Transfer.material_name,
                    Adjustment.processor_name,
                    TeamEmployee.name,
                    Adjustment.reason,
                    Adjustment.processing_task_name,
                    Adjustment.process_step_name,
                    Adjustment.purpose_name,
                ],
            )
        )
    return conditions


def production_groups(conditions):
    # Only explicit actual work enters totals; unknown legacy recounts stay in details.
    return (
        select(
            Adjustment.processing_date,
            Adjustment.processor_employee_id,
            func.coalesce(TeamEmployee.name, func.max(Adjustment.processor_name)).label(
                "processor_name"
            ),
            Adjustment.processing_mode,
            Adjustment.process_route_id,
            Adjustment.process_step_index,
            Adjustment.process_step_name,
            Adjustment.processing_task_id,
            Adjustment.processing_task_name,
            Adjustment.purpose_id,
            Adjustment.purpose_name,
            func.count().label("record_count"),
            *(
                func.sum(
                    case((Adjustment.work_kind == "initial", getattr(Adjustment, key)), else_=0)
                ).label(key)
                if key.startswith(("completed", "input"))
                else func.sum(getattr(Adjustment, key)).label(key)
                for key in METRICS
            ),
            func.sum(
                case((Adjustment.work_kind == "rework", Adjustment.completed_quantity), else_=0)
            ).label("rework_quantity"),
            func.sum(
                case((Adjustment.work_kind == "rework", Adjustment.completed_weight), else_=0)
            ).label("rework_weight"),
            func.sum(case((Adjustment.work_kind == "rework", 1), else_=0)).label(
                "rework_record_count"
            ),
            func.sum(Adjustment.completed_quantity).label("work_quantity"),
            func.sum(Adjustment.completed_weight).label("work_weight"),
        )
        .join(Transfer, Transfer.id == Adjustment.source_transfer_id)
        .outerjoin(TeamEmployee, TeamEmployee.id == Adjustment.processor_employee_id)
        .where(
            *conditions,
            Adjustment.processing_date.is_not(None),
            Adjustment.completed_quantity.is_not(None),
            Adjustment.processor_employee_id.is_not(None),
        )
        .group_by(
            Adjustment.processing_date,
            Adjustment.processor_employee_id,
            TeamEmployee.name,
            Adjustment.processing_mode,
            Adjustment.process_route_id,
            Adjustment.process_step_index,
            Adjustment.process_step_name,
            Adjustment.processing_task_id,
            Adjustment.processing_task_name,
            Adjustment.purpose_id,
            Adjustment.purpose_name,
        )
    )


def list_records(
    db,
    team_id,
    *,
    record_filters=None,
    query=None,
    processor_id=None,
    work_date=None,
    work_kind=None,
    processing_task_id=None,
    purpose_id=None,
    page=1,
    page_size=20,
):
    require_processing_team(db, team_id)
    balance = stock.stock_table(team_id)
    registered = registered_lots(team_id)
    conditions = record_conditions(
        team_id,
        record_filters,
        query,
        processor_id,
        work_date,
        work_kind,
        processing_task_id,
        purpose_id,
    )
    statement = (
        select(
            Adjustment,
            Transfer.serial_no,
            Transfer.shared_group_id,
            Transfer.shared_unallocated,
            Transfer.batch_no,
            Transfer.material_name,
            Transfer.material_type,
            Transfer.purpose_name.label("source_purpose_name"),
            balance.c.on_hand_quantity,
            balance.c.on_hand_weight,
            balance.c.in_transit_quantity,
            balance.c.in_transit_weight,
            registered.c.latest_id,
            registered.c.processing_status.label("current_processing_status"),
        )
        .join(Transfer, Transfer.id == Adjustment.source_transfer_id)
        .outerjoin(TeamEmployee, TeamEmployee.id == Adjustment.processor_employee_id)
        .join(balance, balance.c.transfer_id == Transfer.id)
        .join(registered, registered.c.lot_id == Transfer.id)
        .where(*conditions)
    )
    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    groups = production_groups(conditions).subquery()
    employee_days = (
        select(groups.c.processing_date, groups.c.processor_employee_id).distinct().subquery()
    )
    totals = (
        db.execute(
            select(
                select(func.count())
                .select_from(employee_days)
                .scalar_subquery()
                .label("employee_day_count"),
                func.count().label("daily_group_count"),
                func.coalesce(func.sum(groups.c.record_count), 0).label("record_count"),
                *(func.coalesce(func.sum(groups.c[key]), 0).label(key) for key in SUMMARY_METRICS),
            )
        )
        .mappings()
        .one()
    )
    summary = {
        key: float(value) if key.endswith("weight") else int(value) for key, value in totals.items()
    }
    summary["unreported_count"] = total - summary["record_count"]
    processors = (
        db.execute(
            select(
                Adjustment.processor_employee_id.label("id"),
                func.coalesce(TeamEmployee.name, func.max(Adjustment.processor_name)).label("name"),
            )
            .outerjoin(TeamEmployee, TeamEmployee.id == Adjustment.processor_employee_id)
            .where(Adjustment.team_id == team_id, Adjustment.processor_employee_id.is_not(None))
            .group_by(Adjustment.processor_employee_id, TeamEmployee.name)
            .order_by(Adjustment.processor_employee_id)
        )
        .mappings()
        .all()
    )
    task_records = (
        select(func.max(Adjustment.id).label("id"))
        .where(Adjustment.team_id == team_id, Adjustment.processing_task_id.is_not(None))
        .group_by(Adjustment.processing_task_id)
        .subquery()
    )
    processing_tasks = (
        db.execute(
            select(
                Adjustment.processing_task_id.label("id"),
                Adjustment.processing_task_name.label("name"),
            )
            .join(task_records, task_records.c.id == Adjustment.id)
            .order_by(Adjustment.processing_task_id)
        )
        .mappings()
        .all()
    )
    rows = db.execute(
        statement.order_by(Adjustment.created_at.desc(), Adjustment.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    snapshots = [record_dict(row[0]) for row in rows]
    lot_ids = {row[0].source_transfer_id for row in rows}
    lot_ids.update(output["id"] for item in snapshots for output in (item.get("outputs") or []))
    balances = output_balances(db, team_id, lot_ids)
    items = []
    for row, snapshot in zip(rows, snapshots, strict=True):
        current = row._mapping
        # Keep the immutable output quantities, sizes and roles beside their
        # current balances; never present the depleted input as lost output.
        snapshot["outputs"] = [
            {
                **output,
                **{
                    key: value
                    for key, value in balances.get(output["id"], {}).items()
                    if key != "progress"
                },
            }
            for output in (snapshot.get("outputs") or [])
        ]
        holdings = balances.get(row[0].source_transfer_id, {})
        if snapshot["outputs"]:
            # Reservations made before this processing belong to the original
            # input, not the newly created output family's current holdings.
            descendants = [balances.get(output["id"], {}) for output in snapshot["outputs"]]
            holdings = {
                key: sum(item.get(key, 0) for item in descendants)
                for key in (
                    "on_hand_quantity",
                    "on_hand_weight",
                    "in_transit_quantity",
                    "in_transit_weight",
                    "owned_quantity",
                    "owned_weight",
                )
            }
            holdings["progress"] = (
                "partial"
                if any(item.get("progress") == "partial" for item in descendants)
                else (
                    "complete"
                    if any(item.get("progress") == "complete" for item in descendants)
                    else None
                )
            )
        items.append(
            {
                **snapshot,
                **{
                    key: current[key]
                    for key in (
                        "serial_no",
                        "shared_group_id",
                        "shared_unallocated",
                        "batch_no",
                        "material_name",
                        "material_type",
                    )
                },
                "purpose_name": snapshot["purpose_name"] or current["source_purpose_name"],
                **{key: value for key, value in holdings.items() if key != "progress"},
                "processing_state": state(
                    current["material_type"],
                    holdings.get("on_hand_quantity", 0),
                    holdings.get("on_hand_weight", 0),
                    holdings.get("in_transit_quantity", 0),
                    holdings.get("in_transit_weight", 0),
                    True,
                    holdings.get("progress") or current["current_processing_status"],
                ),
            }
        )
    from .shared_material import annotate_groups

    return {
        "items": annotate_groups(db, items),
        "total": total,
        "summary": summary,
        "processors": [dict(person) for person in processors],
        "processing_tasks": [dict(task) for task in processing_tasks],
        "page": page,
        "page_size": page_size,
        "as_of": _utc(utcnow()),
    }
