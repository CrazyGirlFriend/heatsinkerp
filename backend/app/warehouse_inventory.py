"""Shared team balances grouped by serial, nature, specification and origin.

Aggregate the shared stock ledger before filtering/pagination. A row's anchor is
an actual received lot; it also scopes drill-down and outbound source selection.
"""

from datetime import date, timedelta, timezone
from types import SimpleNamespace
from typing import Literal

from fastapi import HTTPException
from pydantic import Field, model_validator
from sqlalchemy import and_, case, func, or_, select

from .inventory_age import stock_age_table
from .material_analytics import (
    META_FIELDS,
    SearchField,
    SerialFilters,
    age_conditions,
    serial_predicates,
    serial_table,
)
from .material_stock import BALANCE_KEYS, balance_dict, literal_query, require_team, stock_table
from .material_transfer_workflow import material_transfer_dict, material_transfer_list_options
from .models import MaterialLoss, MaterialTransfer, Team, utcnow
from .processing_records import annotate_source, registered_lots, source_metadata, summary_columns
from .processing_statistics import difference_totals, weight_lineage, weight_roots
from .record_filters import RecordFilters, day_bounds, numeric_search_predicate, urgent_serials
from .schemas import SCRAP_MATERIAL_TYPES
from .serial_urgency import urgency_dict, urgency_map

mt = MaterialTransfer
WarehouseSearchField = Literal[
    SearchField,
    "source",
    "purpose_name",
    "oldest_received_at",
    "on_hand_quantity",
    "on_hand_weight",
    "owned_quantity",
    "owned_weight",
    "in_transit_quantity",
    "in_transit_weight",
    "external_pending_quantity",
    "external_pending_weight",
    "source_batch_no",
    "shortage_weight",
    "processing_registered_quantity",
    "processing_registered_weight",
    "processing_unregistered_quantity",
    "processing_unregistered_weight",
]


class WarehouseInventoryFilters(SerialFilters):
    search_field: WarehouseSearchField = "all"
    availability: Literal["current", "owned", "all", "available", "scrap"] = "current"
    receipt_source: (
        Literal["external", "return", "internal", "opening", "processing", "rework"] | None
    ) = None
    rework: Literal["pending", "worked"] | None = None
    location_status: Literal["unassigned"] | None = None
    source_team_id: int | None = Field(default=None, ge=1)
    purpose_id: int | None = Field(
        default=None, ge=0, description="本班组业务编号；0 表示未指定业务"
    )
    stock_age_min: float | None = Field(default=None, ge=0, le=36500)
    stock_age_max: float | None = Field(default=None, ge=0, le=36500)
    processing_state: (
        Literal[
            "unregistered",
            "registered",
            "partial",
            "complete",
            "rework",
            "mixed",
            "pending",
            "cleared",
            "not_applicable",
            "not_required",
        ]
        | None
    ) = None
    processing_role: Literal["remaining", "produced", "scrap"] | None = None
    route_status: Literal["linked", "unlinked"] | None = None

    @model_validator(mode="after")
    def validate_search(self):
        if (
            self.stock_age_min is not None
            and self.stock_age_max is not None
            and self.stock_age_min > self.stock_age_max
        ):
            raise ValueError("滞留时间下限不能大于上限")
        # Share numeric/date validation without treating warehouse balances as
        # serial totals. The parent's field validator is deliberately overridden.
        field = {
            "source": "material_name",
            "purpose_name": "material_name",
            "oldest_received_at": "last_activity_at",
            "on_hand_quantity": "available_quantity",
            "on_hand_weight": "available_weight",
            "shortage_weight": "available_weight",
        }.get(self.search_field, self.search_field)
        if field.startswith(("owned_", "in_transit_", "external_pending_", "processing_")):
            field = "available_weight" if field.endswith("_weight") else "available_quantity"
        if field == "source_batch_no":
            field = "serial_no"
        SerialFilters(query=self.query, search_field=field, search_operator=self.search_operator)
        return self


def origin_columns(include_team=False, registered=None):
    manual = mt.entry_kind == "warehouse_receipt"
    # Keep this key in the shared grouping so list rows, source pickers and
    # drill-downs cannot combine processed lots with unprocessed ones.
    joined = registered is not None
    if not joined:
        registered = registered_lots(None)
    processing_group = func.coalesce(
        registered.c.processing_status,
        case((registered.c.latest_id.is_not(None), "registered"), else_="unregistered"),
    )
    if not joined:
        processing_group = func.coalesce(
            select(processing_group)
            .where(registered.c.lot_id == mt.id)
            .correlate(mt)
            .scalar_subquery(),
            "unregistered",
        )
    return {
        **({"team_id": mt.next_team_id} if include_team else {}),
        "serial_no": mt.serial_no,
        "shared_group_id": mt.shared_group_id,
        "shared_unallocated": mt.shared_unallocated,
        "process_route_id": mt.process_route_id,
        "rework_route_id": mt.rework_route_id,
        "process_step_index": mt.process_step_index,
        "process_step_complete": mt.process_step_complete,
        "material_name": func.coalesce(mt.material_name, ""),
        "transfer_specification": func.coalesce(mt.transfer_specification, ""),
        "material_type": func.coalesce(mt.material_type, ""),
        "processing_role": mt.processing_role,
        "processing_group": processing_group,
        "rework_pending": mt.rework_pending,
        "rework_count": mt.rework_count,
        "purpose_id": mt.purpose_id,
        "purpose_name": func.coalesce(mt.purpose_name, ""),
        "receipt_source": case(
            (mt.entry_kind == "processing_output", "processing"),
            (mt.entry_kind == "rework_split", "rework"),
            (mt.entry_kind == "opening_stock", "opening"),
            (~manual, "internal"),
            (mt.receipt_kind == "return", "return"),
            else_="external",
        ),
        "source_team_id": case((~manual, mt.source_team_id), else_=None),
        "external_source": case((manual, func.coalesce(mt.external_source, "")), else_=""),
    }


def warehouse_groups(team_id, filters):
    from .inspections import hold_column

    stock = stock_table(team_id)
    registered = registered_lots(team_id)
    age = stock_age_table(team_id)
    remaining = or_(stock.c.on_hand_quantity != 0, stock.c.on_hand_weight != 0)
    # Group the joined processing columns directly. A correlated scalar subquery
    # in GROUP BY is not recognized as deterministic by MySQL ONLY_FULL_GROUP_BY.
    origins = origin_columns(include_team=team_id is None, registered=registered)
    moves = (
        select(mt.source_transfer_id.label("lot_id"), func.max(mt.updated_at).label("at"))
        .where(
            mt.source_team_id == team_id if team_id is not None else True,
            mt.source_transfer_id.is_not(None),
        )
        .group_by(mt.source_transfer_id)
        .subquery()
    )
    losses = (
        select(
            MaterialLoss.source_transfer_id.label("lot_id"),
            func.max(MaterialLoss.created_at).label("at"),
        )
        .where(MaterialLoss.team_id == team_id if team_id is not None else True)
        .group_by(MaterialLoss.source_transfer_id)
        .subquery()
    )
    recent = case((moves.c.at > mt.updated_at, moves.c.at), else_=mt.updated_at)
    recent = case((losses.c.at > recent, losses.c.at), else_=recent)
    meta = []
    for name in META_FIELDS:
        if name in origins:
            continue
        column = getattr(mt, name)
        meta.extend(
            [
                case((func.count(func.distinct(column)) <= 1, func.min(column)), else_=None).label(
                    name
                ),
                func.count(func.distinct(column)).label(name + "_count"),
            ]
        )
    calendar = RecordFilters(date_from=filters.date_from, date_to=filters.date_to)
    calendar.dates(mt.received_at)  # Validate the range even for an empty ledger.
    matching_dates = True
    if filters.date_from or filters.date_to:
        movement_matches = select(mt.source_transfer_id).where(
            mt.source_team_id == team_id if team_id is not None else True,
            or_(
                *(
                    and_(*calendar.dates(column))
                    for column in (mt.created_at, mt.received_at, mt.dispatched_at, mt.voided_at)
                )
            ),
        )
        loss_matches = select(MaterialLoss.source_transfer_id).where(
            MaterialLoss.team_id == team_id if team_id is not None else True,
            *calendar.dates(MaterialLoss.created_at),
        )
        matching_dates = or_(
            and_(*calendar.dates(mt.received_at)),
            mt.id.in_(movement_matches),
            mt.id.in_(loss_matches),
        )
    return (
        select(
            *(column.label(name) for name, column in origins.items()),
            func.min(mt.id).label("group_id"),
            func.count(mt.id).label("batch_count"),
            func.sum(case((remaining, 1), else_=0)).label("current_batch_count"),
            func.min(case((remaining, mt.received_at), else_=None)).label("oldest_received_at"),
            func.min(case((remaining, age.c.started_at), else_=None)).label("stock_age_started_at"),
            func.min(case((remaining, age.c.basis))).label("stock_age_basis"),
            func.max(
                case(
                    (
                        origins["receipt_source"].in_(("internal", "processing", "rework")),
                        mt.source_team_name,
                    ),
                    else_=origins["external_source"],
                )
            ).label("source_name"),
            func.max(recent).label("last_activity_at"),
            func.max(case((matching_dates, 1), else_=0)).label("matches_date"),
            *(func.sum(stock.c[key]).label(key) for key in BALANCE_KEYS),
            *summary_columns(stock, registered),
            func.sum(case((hold_column(mt.id).is_not(None), 1), else_=0)).label(
                "inspection_hold_count"
            ),
            *meta,
        )
        .select_from(stock)
        .join(mt, mt.id == stock.c.transfer_id)
        .outerjoin(moves, moves.c.lot_id == mt.id)
        .outerjoin(losses, losses.c.lot_id == mt.id)
        .outerjoin(registered, registered.c.lot_id == mt.id)
        .outerjoin(age, age.c.transfer_id == mt.id)
        .group_by(*origins.values())
        .subquery()
    )


def group_conditions(table, anchor):
    return [column.is_not_distinct_from(anchor[name]) for name, column in table.items()]


def processing_state_column(table, team_id):
    from .team_constants import PROCESSING_TEAM_CODES

    c = table.c
    production = select(Team.id).where(Team.code.in_(PROCESSING_TEAM_CODES))
    team = c.team_id if team_id is None else team_id
    return case(
        (~select(Team.id).where(Team.id == team, Team.id.in_(production)).exists(), "not_required"),
        (c.material_type.in_(SCRAP_MATERIAL_TYPES), "not_applicable"),
        (
            c.rework_pending.is_(True) & or_(c.on_hand_quantity > 0, c.on_hand_weight > 0),
            "rework",
        ),
        (
            and_(
                c.processing_registered_batch_count > 0, c.processing_unregistered_batch_count > 0
            ),
            "mixed",
        ),
        (c.processing_partial_batch_count > 0, "partial"),
        (
            and_(
                c.processing_registered_batch_count > 0,
                c.processing_complete_batch_count == c.processing_registered_batch_count,
            ),
            "complete",
        ),
        (c.processing_registered_batch_count > 0, "registered"),
        (c.processing_unregistered_batch_count > 0, "unregistered"),
        (or_(c.in_transit_quantity > 0, c.in_transit_weight > 0), "pending"),
        else_="cleared",
    )


def list_inventory(db, team_id, filters):
    if team_id is not None:
        require_team(db, team_id)
    now = utcnow()
    table = warehouse_groups(team_id, filters)
    conditions = [table.c.matches_date == 1]
    processing_state = processing_state_column(table, team_id)
    if filters.processing_state:
        conditions.append(processing_state == filters.processing_state)
    if filters.processing_role:
        conditions.append(table.c.processing_role == filters.processing_role)
    if filters.route_status:
        conditions.append(
            table.c.process_route_id.is_not(None)
            if filters.route_status == "linked"
            else table.c.process_route_id.is_(None)
        )
    if filters.rework:
        conditions.append(
            table.c.rework_pending.is_(True)
            if filters.rework == "pending"
            else table.c.rework_count > 0
        )
    if filters.location_status:
        from .team_constants import WAREHOUSE_TEAM_CODE
        from .warehouse_placements import unassigned_predicate

        if team_id is not None and require_team(db, team_id).code != WAREHOUSE_TEAM_CODE:
            raise HTTPException(422, "仅库房可以按仓位筛选")
        if team_id is None:
            conditions.append(
                table.c.team_id.in_(select(Team.id).where(Team.code == WAREHOUSE_TEAM_CODE))
            )
        stock = stock_table(team_id)
        matching = (
            select(mt.id)
            .join(stock, stock.c.transfer_id == mt.id)
            .where(
                *group_conditions(origin_columns(include_team=team_id is None), table.c),
                unassigned_predicate(stock),
            )
        )
        conditions.append(matching.exists())
    if filters.availability != "all":
        prefix = (
            "on_hand"
            if filters.availability == "current"
            else "owned"
            if filters.availability == "owned"
            else "scrap"
            if filters.availability == "scrap"
            else "available"
        )
        conditions.append(
            or_(
                table.c[prefix + "_quantity"] != 0,
                table.c[prefix + "_weight"] != 0,
                table.c.shortage_quantity > 0,
                table.c.shortage_weight > 0,
            )
        )
        if filters.availability in ("available", "scrap"):
            scrap = table.c.material_type.in_(SCRAP_MATERIAL_TYPES)
            conditions.append(scrap if filters.availability == "scrap" else ~scrap)
    for key in ("serial_no", "material_name", "material_type", "receipt_source", "source_team_id"):
        value = getattr(filters, key)
        if value is not None:
            if (key, value) in (("material_name", "未填写材质"), ("material_type", "unknown")):
                value = ""
            from .shared_material import serial_match

            conditions.append(
                serial_match(table.c[key], value) if key == "serial_no" else table.c[key] == value
            )
    if filters.purpose_id is not None:
        conditions.append(
            table.c.purpose_id.is_(None)
            if filters.purpose_id == 0
            else table.c.purpose_id == filters.purpose_id
        )
    if filters.urgent_only:
        conditions.append(table.c.serial_no.in_(urgent_serials()))
    if filters.stock_age:
        conditions.append(age_conditions(table.c.stock_age_started_at, now)[filters.stock_age])
    if filters.stock_age_min is not None:
        conditions.append(
            table.c.stock_age_started_at <= now - timedelta(days=filters.stock_age_min)
        )
    if filters.stock_age_max is not None:
        conditions.append(
            table.c.stock_age_started_at >= now - timedelta(days=filters.stock_age_max)
        )
    term = (filters.query or "").strip()
    field = filters.search_field
    matching_sources = [
        *group_conditions(origin_columns(include_team=team_id is None), table.c),
        mt.next_team_id == team_id if team_id is not None else True,
        mt.status == "received",
        mt.stock_tracked.is_(True),
    ]
    if term:
        if field == "urgency":
            urgent = table.c.serial_no.in_(urgent_serials())
            conditions.append(urgent if term == "urgent" else ~urgent)
        elif field in ("last_activity_at", "oldest_received_at"):
            start, end = day_bounds(date.fromisoformat(term))
            conditions.append(and_(table.c[field] >= start, table.c[field] < end))
        elif field.endswith(("_quantity", "_weight")):
            # Pending incoming is intentionally not warehouse stock; outbound
            # pending belongs to the already-deducted source group's history.
            column = (
                mt.finished_quantity
                if field == "finished_quantity"
                else table.c.reserved_quantity
                if field == "pending_outgoing_quantity"
                else table.c.reserved_weight
                if field == "pending_outgoing_weight"
                else table.c[field]
                if field in table.c
                else None
            )
            if column is None:
                conditions.append(False)
            else:
                predicate = numeric_search_predicate(
                    column, term, filters.search_operator, weight=field.endswith("_weight")
                )
                conditions.append(
                    select(mt.id).where(*matching_sources, predicate).exists()
                    if field == "finished_quantity"
                    else predicate
                )
        elif field in ("all", "source"):
            source_kind = case(
                (table.c.receipt_source == "processing", "本班组加工"),
                (table.c.receipt_source == "rework", "返工料划分"),
                (table.c.receipt_source == "opening", "初始库存"),
                (table.c.receipt_source == "internal", "车间转入"),
                (table.c.receipt_source == "return", "外部退回"),
                else_="外部来料",
            )
            columns = [table.c.source_name, source_kind]
            if field == "all":
                columns += [
                    table.c[name]
                    for name in (
                        "serial_no",
                        "material_name",
                        "transfer_specification",
                        "purpose_name",
                    )
                ]
            matches = literal_query(term, columns)
            if field == "all":
                from .shared_material import serial_match

                matches = or_(
                    matches,
                    serial_match(table.c.serial_no, term, "contains"),
                    select(mt.id)
                    .where(
                        *matching_sources,
                        literal_query(
                            term, [mt.customer_code, mt.product_code, mt.finished_specification]
                        ),
                    )
                    .exists(),
                )
            conditions.append(matches)
        else:
            conditions.append(
                select(mt.id)
                .where(*matching_sources, literal_query(term, [getattr(mt, field)]))
                .exists()
            )
    # Existing chart deep links still select matching serials, while source/type
    # filters above constrain the displayed group quantities themselves.
    if any(
        (filters.waiting_direction, filters.activity_day, filters.has_loss, filters.flow_direction)
    ):
        serial = serial_table(team_id)
        scope_filters = SerialFilters(
            **{
                **filters.model_dump(
                    exclude={"receipt_source", "source_team_id", "purpose_id", "location_status"}
                ),
                "query": None,
                "search_field": "all",
                "availability": "all",
                "material_type": None,
                "material_name": None,
                "date_from": None,
                "date_to": None,
                "stock_age": None,
            }
        )
        conditions.append(
            table.c.serial_no.in_(
                select(serial.c.serial_no).where(
                    *serial_predicates(team_id, serial, scope_filters, utcnow())
                )
            )
        )
    total = db.scalar(select(func.count()).select_from(table).where(*conditions)) or 0
    rows = (
        db.execute(
            select(table, processing_state.label("processing_state"))
            .where(*conditions)
            .order_by(table.c.last_activity_at.desc(), table.c.group_id.desc())
            .offset((filters.page - 1) * filters.page_size)
            .limit(filters.page_size)
        )
        .mappings()
        .all()
    )
    from .models import ProcessRoute
    from .process_routes import route_document

    route_ids = {row[key] for row in rows for key in ("process_route_id", "rework_route_id")} - {
        None
    }
    routes = (
        {
            route.id: route
            for route in db.scalars(select(ProcessRoute).where(ProcessRoute.id.in_(route_ids)))
        }
        if route_ids
        else {}
    )
    priorities = urgency_map(db, [row["serial_no"] for row in rows])
    origins = origin_columns(include_team=team_id is None)
    differences = {}
    if rows:
        lineage = weight_lineage(team_id)
        roots = weight_roots(lineage)
        root_rows = db.execute(
            select(
                *(column.label(name) for name, column in origins.items()),
                roots.c.root_id.label("weight_root_transfer_id"),
                roots.c.weight_difference,
            )
            .select_from(mt)
            .join(lineage, lineage.c.transfer_id == mt.id)
            .join(roots, roots.c.root_id == lineage.c.root_id)
            .where(or_(*(and_(*group_conditions(origins, row)) for row in rows)))
            .distinct()
        ).mappings()
        for row in root_rows:
            differences.setdefault(tuple(row[name] for name in origins), []).append(row)
    items = []
    teams = {team.id: team for team in db.scalars(select(Team))} if team_id is None else {}
    for row in rows:
        item = dict(row)
        item.pop("matches_date")
        rework_route = routes.get(item["rework_route_id"])
        item["rework_round"] = rework_route.rework_round if rework_route else None
        item["rework_route_ready"] = rework_route.state == "published" if rework_route else None
        item["process_route"] = (
            route_document(
                SimpleNamespace(
                    **item,
                    process_route=routes.get(item["process_route_id"]),
                    next_team_id=team_id if team_id is not None else item["team_id"],
                )
            )
            if item["process_route_id"]
            else None
        )
        item.update(balance_dict(row))
        item.update(difference_totals(differences.get(tuple(row[name] for name in origins), [])))
        item["urgency"] = priorities.get(row["serial_no"], urgency_dict(None))
        if team_id is None:
            team = teams[row["team_id"]]
            item.update(team_name=team.name, team_code=team.code)
        item["stock_age_hours"] = (
            max(0, (now - row["stock_age_started_at"]).total_seconds() / 3600)
            if row["stock_age_started_at"]
            else None
        )
        for key in ("last_activity_at", "oldest_received_at", "stock_age_started_at"):
            item[key] = row[key].replace(tzinfo=timezone.utc).isoformat() if row[key] else None
        items.append(item)
    from .shared_material import annotate_groups

    annotate_groups(db, items)
    return {
        "items": items,
        "total": total,
        "page": filters.page,
        "page_size": filters.page_size,
        "as_of": now.replace(tzinfo=timezone.utc).isoformat(),
    }


def list_group_sources(
    db,
    team_id,
    group_id,
    user,
    *,
    page=1,
    page_size=20,
    current_only=False,
    query=None,
    record_filters=None,
):
    require_team(db, team_id)
    origins = origin_columns()
    anchor = (
        db.execute(
            select(*(column.label(name) for name, column in origins.items())).where(
                mt.id == group_id,
                mt.next_team_id == team_id,
                mt.status == "received",
                mt.stock_tracked.is_(True),
            )
        )
        .mappings()
        .first()
    )
    if anchor is None:
        raise HTTPException(404, "未找到该班组的库存来源")
    stock = stock_table(team_id)
    statement = (
        select(mt, stock)
        .join(stock, stock.c.transfer_id == mt.id)
        .where(*group_conditions(origins, anchor))
    )
    if current_only:
        statement = statement.where(or_(stock.c.on_hand_quantity != 0, stock.c.on_hand_weight != 0))
    if query and query.strip():
        statement = statement.where(
            literal_query(query, [mt.batch_no, mt.serial_no, mt.material_name, mt.source_batch_no])
        )
    statement = statement.where(
        *(record_filters or RecordFilters()).predicates(mt.received_at, mt.serial_no)
    )
    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    metadata = source_metadata(team_id)
    statement = statement.add_columns(metadata).outerjoin(metadata, metadata.c.lot_id == mt.id)
    rows = (
        db.execute(
            statement.options(*material_transfer_list_options())
            .order_by(mt.received_at.desc(), mt.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        .unique()
        .all()
    )
    from .material_weight import stock_sludge_measurements
    from .warehouse_placements import stock_positions

    items = [
        annotate_source(
            {
                "transfer": material_transfer_dict(row[0], user, include_history=False),
                **balance_dict(row._mapping),
            },
            row._mapping,
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


def list_group_pending(db, team_id, group_id, user, *, page=1, page_size=20):
    require_team(db, team_id)
    origins = origin_columns()
    anchor = (
        db.execute(
            select(*(column.label(name) for name, column in origins.items())).where(
                mt.id == group_id,
                mt.next_team_id == team_id,
                mt.status == "received",
                mt.stock_tracked.is_(True),
            )
        )
        .mappings()
        .first()
    )
    if anchor is None:
        raise HTTPException(404, "未找到该班组的库存来源")
    sources = select(mt.id).where(
        *group_conditions(origins, anchor),
        mt.next_team_id == team_id,
        mt.status == "received",
        mt.stock_tracked.is_(True),
    )
    conditions = [
        mt.source_team_id == team_id,
        mt.status == "pending",
        mt.source_transfer_id.in_(sources),
    ]
    total = db.scalar(select(func.count()).select_from(mt).where(*conditions)) or 0
    items = (
        db.scalars(
            select(mt)
            .where(*conditions)
            .options(*material_transfer_list_options())
            .order_by(mt.created_at.desc(), mt.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        .unique()
        .all()
    )
    return {
        "items": [material_transfer_dict(item, user, include_history=False) for item in items],
        "total": total,
        "page": page,
        "page_size": page_size,
        "as_of": utcnow().replace(tzinfo=timezone.utc).isoformat(),
    }


def list_group_movements(db, team_id, group_id, user, *, page=1, page_size=20):
    require_team(db, team_id)
    origins = origin_columns()
    anchor = (
        db.execute(
            select(*(column.label(name) for name, column in origins.items())).where(
                mt.id == group_id,
                mt.next_team_id == team_id,
                mt.status == "received",
                mt.stock_tracked.is_(True),
            )
        )
        .mappings()
        .first()
    )
    if anchor is None:
        raise HTTPException(404, "未找到该班组的库存来源")
    sources = select(mt.id).where(
        *group_conditions(origins, anchor),
        mt.next_team_id == team_id,
        mt.status == "received",
        mt.stock_tracked.is_(True),
    )
    # Each actual receipt/outbound document appears once, with its own TL number.
    # Match children by source identity, not their destination nature or purpose.
    scope = and_(
        mt.entry_kind.not_in(("processing_output", "rework_split")),
        or_(
            mt.id.in_(sources),
            and_(mt.source_team_id == team_id, mt.source_transfer_id.in_(sources)),
        ),
    )
    occurred_at = case(
        (mt.next_team_id == team_id, func.coalesce(mt.received_at, mt.created_at)),
        else_=mt.created_at,
    )
    total = db.scalar(select(func.count()).select_from(mt).where(scope)) or 0
    rows = (
        db.scalars(
            select(mt)
            .where(scope)
            .options(*material_transfer_list_options())
            .order_by(occurred_at.desc(), mt.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        .unique()
        .all()
    )
    return {
        "items": [material_transfer_dict(row, user, include_history=False) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
        "as_of": utcnow().replace(tzinfo=timezone.utc).isoformat(),
    }


# Keep published warehouse URLs scoped to the warehouse for existing clients.
