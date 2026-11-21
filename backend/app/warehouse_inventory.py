"""Stock balances and filters for individual received batches across teams."""

from datetime import date, timedelta, timezone
from types import SimpleNamespace
from typing import Literal

from fastapi import HTTPException
from pydantic import Field, model_validator
from sqlalchemy import and_, case, func, literal, or_, select
from sqlalchemy.orm import aliased

from .inventory_age import stock_age_table
from .material_analytics import (
    META_FIELDS,
    SearchField,
    SerialFilters,
    age_conditions,
    serial_predicates,
    serial_table,
)
from .material_lineage import source_ids_for
from .material_stock import BALANCE_KEYS, balance_dict, literal_query, require_team, stock_table
from .material_transfer_workflow import material_transfer_dict, material_transfer_list_options
from .material_weight import WEIGHT_ONLY_TYPES
from .models import (
    MaterialLoss,
    MaterialQuantityAdjustment,
    MaterialTransfer,
    Team,
    WarehouseFeedingSource,
    WarehouseLocation,
    WarehousePlacement,
    utcnow,
)
from .processing_records import (
    annotate_source,
    lot_self_check_counts,
    next_local_work,
    registered_lots,
    source_metadata,
    summary_columns,
)
from .processing_statistics import difference_totals, weight_lineage, weight_roots
from .record_filters import RecordFilters, day_bounds, numeric_search_predicate
from .schedule_task_identity import (
    stock_task_bindings,
    stock_task_id_column,
    task_batch_number_column,
)
from .schemas import SCRAP_MATERIAL_TYPES
from .serial_urgency import urgency_dict, urgency_map
from .team_constants import SELF_CHECK_TEAM_CODES, SPLITTING_TEAM_CODES, WAREHOUSE_TEAM_CODE

mt = MaterialTransfer
WarehouseSearchField = Literal[
    SearchField,
    "source",
    "purpose_name",
    "oldest_received_at",
    "on_hand_quantity",
    "on_hand_weight",
    "stock_total_quantity",
    "stock_total_weight",
    "owned_quantity",
    "owned_weight",
    "in_transit_quantity",
    "in_transit_weight",
    "external_pending_quantity",
    "external_pending_weight",
    "source_batch_no",
    "batch_no",
    "previous_batch_no",
    "task_batch_number",
    "warehouse_location",
    "shortage_weight",
    "processing_registered_quantity",
    "processing_registered_weight",
    "processing_unregistered_quantity",
    "processing_unregistered_weight",
]


class WarehouseInventoryFilters(SerialFilters):
    search_field: WarehouseSearchField = "all"
    availability: Literal["current", "current_or_transit", "owned", "all", "available", "scrap"] = (
        "current"
    )
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
    usable_remainders_only: bool = False
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
            "task_batch_number": "available_quantity",
            "shortage_weight": "available_weight",
        }.get(self.search_field, self.search_field)
        if field.startswith(
            ("owned_", "in_transit_", "external_pending_", "processing_", "stock_total_")
        ):
            field = "available_weight" if field.endswith("_weight") else "available_quantity"
        if field in ("source_batch_no", "batch_no", "previous_batch_no", "warehouse_location"):
            field = "serial_no"
        SerialFilters(query=self.query, search_field=field, search_operator=self.search_operator)
        return self


def origin_columns(include_team=False, registered=None, task_bindings=None):
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
        "schedule_task_id": (
            task_bindings.c.task_id if task_bindings is not None else stock_task_id_column(mt.id)
        ),
        # A physical batch remains a separate stock row for every team.
        "stock_batch_no": mt.batch_no,
        "shared_group_id": mt.shared_group_id,
        "shared_unallocated": mt.shared_unallocated,
        "process_route_id": mt.process_route_id,
        "rework_route_id": mt.rework_route_id,
        "process_step_index": mt.process_step_index,
        "process_step_complete": mt.process_step_complete,
        "material_name": func.coalesce(mt.material_name, ""),
        "is_outsourced": mt.is_outsourced,
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


def withdrawn_from(sources):
    return or_(
        mt.source_transfer_id.in_(sources),
        mt.id.in_(
            select(WarehouseFeedingSource.transfer_id).where(
                WarehouseFeedingSource.source_transfer_id.in_(sources)
            )
        ),
    )


def warehouse_groups(team_id, filters, *, by_serial=False):
    from .inspections import hold_column

    stock = stock_table(team_id)
    registered = registered_lots(team_id)
    age = stock_age_table(team_id)
    remaining = or_(stock.c.on_hand_quantity != 0, stock.c.on_hand_weight != 0)
    # Group the joined processing columns directly. A correlated scalar subquery
    # in GROUP BY is not recognized as deterministic by MySQL ONLY_FULL_GROUP_BY.
    task_bindings = stock_task_bindings()
    origins = origin_columns(
        include_team=team_id is None, registered=registered, task_bindings=task_bindings
    )
    parent = aliased(mt)
    placements = (
        select(
            WarehousePlacement.transfer_id,
            func.group_concat(WarehouseLocation.name).label("names"),
        )
        .join(WarehouseLocation, WarehouseLocation.id == WarehousePlacement.location_id)
        .where(or_(WarehousePlacement.quantity > 0, WarehousePlacement.weight > 0))
        .group_by(WarehousePlacement.transfer_id)
        .subquery()
    )
    movement_scope = mt.source_team_id == team_id if team_id is not None else True
    direct = select(mt.source_transfer_id.label("lot_id"), mt.updated_at).where(
        movement_scope, mt.source_transfer_id.is_not(None), mt.pooled_feeding.is_(False)
    )
    portions = (
        select(WarehouseFeedingSource.source_transfer_id, mt.updated_at)
        .join(mt, mt.id == WarehouseFeedingSource.transfer_id)
        .where(movement_scope)
    )
    losses = select(MaterialLoss.source_transfer_id, MaterialLoss.created_at).where(
        MaterialLoss.team_id == team_id if team_id is not None else True
    )
    work = select(
        MaterialQuantityAdjustment.source_transfer_id, MaterialQuantityAdjustment.created_at
    ).where(MaterialQuantityAdjustment.team_id == team_id if team_id is not None else True)
    movements = direct.union_all(portions, losses, work).subquery()
    moves = (
        select(movements.c.lot_id, func.max(movements.c.updated_at).label("at"))
        .group_by(movements.c.lot_id)
        .subquery()
    )
    recent = func.max(case((moves.c.at > mt.updated_at, moves.c.at), else_=mt.updated_at))
    if by_serial:
        # A depleted lot may carry the most recent action for a serial still in stock.
        recent = func.max(recent).over(
            partition_by=(
                mt.serial_no,
                case((mt.serial_no == "", mt.batch_no)),
                case((mt.shared_unallocated.is_(True), mt.shared_group_id)),
            )
        )
    meta = []
    for name in META_FIELDS:
        if name == "transfer_specification":
            current = func.coalesce(registered.c.after_specification, mt.transfer_specification, "")
            meta.append(func.max(current).label(name))
            continue
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
        movement_matches = select(mt.id).where(
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
            mt.id.in_(source_ids_for(movement_matches)),
            mt.id.in_(loss_matches),
        )
    return (
        select(
            *(column.label(name) for name, column in origins.items()),
            func.min(mt.id).label("group_id"),
            func.min(mt.batch_no).label("batch_no"),
            func.min(parent.batch_no).label("previous_batch_no"),
            func.max(
                case(
                    (
                        mt.next_team_code == WAREHOUSE_TEAM_CODE,
                        func.coalesce(placements.c.names, "未分配仓位"),
                    ),
                )
            ).label("warehouse_location"),
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
            recent.label("last_activity_at"),
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
        .outerjoin(task_bindings, task_bindings.c.lot_id == mt.id)
        .outerjoin(parent, parent.id == mt.source_transfer_id)
        .outerjoin(placements, placements.c.transfer_id == mt.id)
        .outerjoin(moves, moves.c.lot_id == mt.id)
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


def size_contains(column, term):
    # User-entered dimensions and imported drawings use different separators.
    replacements = ((" ", ""), ("　", ""), ("*", "×"), ("＊", "×"), ("x", "×"))
    value = term.lower()
    expression = func.lower(column)
    for old, new in replacements:
        value = value.replace(old, new)
        expression = func.replace(expression, old, new)
    return expression.contains(value, autoescape=True)


def list_inventory(db, team_id, filters, *, by_serial=False):
    team = require_team(db, team_id) if team_id is not None else None
    now = utcnow()
    table = warehouse_groups(team_id, filters, by_serial=by_serial)
    serial_search = None
    stock_totals = {
        f"stock_total_{unit}": table.c[f"on_hand_{unit}"] + table.c[f"in_transit_{unit}"]
        for unit in ("quantity", "weight")
    }
    conditions = [table.c.matches_date == 1]
    processing_state = processing_state_column(table, team_id)
    if filters.processing_state:
        conditions.append(processing_state == filters.processing_state)
    if filters.processing_role:
        conditions.append(table.c.processing_role == filters.processing_role)
    if filters.usable_remainders_only:
        # Physical remainders keep their identity through subsequent handoffs.
        # A new machining output starts a separate material lineage.
        remainders = (
            select(mt.id)
            .where(mt.processing_role == "remaining", mt.source_team_code.in_(SPLITTING_TEAM_CODES))
            .cte("usable_remainders", recursive=True)
        )
        remainders = remainders.union_all(
            select(mt.id)
            .join(remainders, mt.source_transfer_id == remainders.c.id)
            .where(
                mt.entry_kind.in_(("transfer", "serial_reallocation")),
                mt.status == "received",
                mt.material_type.not_in(SCRAP_MATERIAL_TYPES),
                func.coalesce(mt.sent_processing_status, "") != "complete",
            )
        )
        split_remainder = and_(
            table.c.group_id.in_(select(remainders.c.id)), processing_state != "complete"
        )
        conditions.extend(
            (
                or_(
                    split_remainder,
                    table.c.material_type.in_(("finished_surplus", "semi_finished_surplus")),
                ),
                table.c.on_hand_quantity > 0,
                table.c.on_hand_weight > 0,
                table.c.inspection_hold_count == 0,
                table.c.rework_pending.is_(False),
            )
        )
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
        from .warehouse_placements import unassigned_predicate

        if team and team.code != WAREHOUSE_TEAM_CODE:
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
            if filters.availability in ("current", "current_or_transit")
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
                *(
                    (table.c.in_transit_quantity > 0, table.c.in_transit_weight > 0)
                    if filters.availability == "current_or_transit"
                    else ()
                ),
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
    from .models import ProductionScheduleTask as Task

    batch_number = (
        select(task_batch_number_column())
        .where(Task.id == table.c.schedule_task_id)
        .correlate_except(Task)
        .scalar_subquery()
    )
    term = (filters.query or "").strip()
    field = filters.search_field
    matching_sources = [
        *group_conditions(origin_columns(include_team=team_id is None), table.c),
        mt.next_team_id == team_id if team_id is not None else True,
        mt.status == "received",
        mt.stock_tracked.is_(True),
    ]
    parent = aliased(mt)

    def batch_matches(value, *, previous=False, condition=None):
        from .table_query import column_predicate

        opposites = {"not_in": "in", "not_contains": "contains", "ne": "eq", "blank": "not_blank"}
        if condition and condition.operator in opposites:
            return ~batch_matches(
                None,
                previous=previous,
                condition=condition.model_copy(update={"operator": opposites[condition.operator]}),
            )
        statement = select(mt.id)
        if previous:
            statement = statement.join(parent, parent.id == mt.source_transfer_id)
        column = parent.batch_no if previous else mt.batch_no
        predicate = (
            column_predicate(column, condition) if condition else literal_query(value, [column])
        )
        if predicate is None:
            return None
        return statement.where(*matching_sources, predicate).exists()

    if term:
        if field in ("batch_no", "previous_batch_no"):
            conditions.append(batch_matches(term, previous=field == "previous_batch_no"))
        elif field == "task_batch_number":
            conditions.append(numeric_search_predicate(batch_number, term, filters.search_operator))
        elif field in ("warehouse_location", "transfer_specification"):
            conditions.append(literal_query(term, [table.c[field]]))
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
                else stock_totals.get(field)
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
                        "batch_no",
                        "warehouse_location",
                        "material_name",
                        "transfer_specification",
                        "purpose_name",
                    )
                ]
            matches = literal_query(term, columns)
            if field == "all":
                from .material_lineage import relatives
                from .shared_material import serial_match

                # Follow physical batches across processing/splits/reallocation,
                # even when descendants have different serial numbers.
                family = relatives(
                    select(mt.id).where(literal_query(term, [mt.batch_no])).correlate(None),
                    name="inventory_batch_matches",
                )
                matches = or_(
                    matches,
                    serial_match(table.c.serial_no, term, "contains"),
                    select(mt.id).where(*matching_sources, mt.id.in_(select(family.c.id))).exists(),
                    select(mt.id)
                    .where(
                        *matching_sources,
                        literal_query(
                            term,
                            [
                                mt.batch_no,
                                mt.customer_code,
                                mt.product_code,
                            ],
                        ),
                    )
                    .exists(),
                )
            if by_serial and field == "all":
                serial_search = matches
            else:
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
    from .table_query import current_table_query, table_options, table_order, table_predicates

    columns = {
        **dict(table.c.items()),
        **stock_totals,
        "processing_state": processing_state,
        "pending_outgoing_quantity": table.c.reserved_quantity,
        "pending_outgoing_weight": table.c.reserved_weight,
        **{
            f"dispatchable_{unit}": case(
                (
                    table.c.material_type.in_(SCRAP_MATERIAL_TYPES),
                    table.c[f"scrap_available_{unit}"],
                ),
                else_=table.c[f"available_{unit}"],
            )
            for unit in ("quantity", "weight")
        },
    }
    columns["task_batch_number"] = batch_number
    columns["team_name"] = (
        select(Team.name)
        .where(Team.id == (table.c.team_id if team_id is None else team_id))
        .scalar_subquery()
    )
    if db.get_bind().dialect.name == "sqlite":
        columns["stock_age"] = func.julianday(now) - func.julianday(table.c.stock_age_started_at)
    else:
        from sqlalchemy import literal_column

        columns["stock_age"] = (
            func.timestampdiff(literal_column("SECOND"), table.c.stock_age_started_at, now) / 86400
        )
    matches = {
        "batch_no": lambda item: batch_matches(None, condition=item),
        "previous_batch_no": lambda item: batch_matches(None, previous=True, condition=item),
    }
    if team and team.code in (WAREHOUSE_TEAM_CODE, "FACTORY-WIRE"):
        from .shared_material import serial_match
        from .table_query import column_predicate

        def match_text(column, item, contains):
            if item.operator in (None, "contains") and item.value:
                return contains(column, item.value)
            return column_predicate(column, item)

        matches["serial_no"] = lambda item: match_text(
            table.c.serial_no, item, lambda column, term: serial_match(column, term, "contains")
        )
        matches["transfer_specification"] = lambda item: match_text(
            table.c.transfer_specification, item, size_contains
        )
        source = func.nullif(table.c.source_name, "")
        if team.code == WAREHOUSE_TEAM_CODE:
            kind = case(
                (table.c.receipt_source == "return", "外部退回"),
                (table.c.receipt_source == "internal", "车间转入"),
                else_="外部来料",
            )
            source = kind + literal(" · ") + func.coalesce(source, "未登记")
        else:
            source = func.coalesce(source, "上序未登记")
        columns["inventory_source_label"] = case(
            {"opening": "初始库存", "processing": "本班组加工", "rework": "返工料划分"},
            value=table.c.receipt_source,
            else_=source,
        )
        # Weight-only lots show a dash in quantity cells, including when the ledger stores zero.
        for field in (
            "stock_total_quantity",
            "on_hand_quantity",
            "dispatchable_quantity",
            "in_transit_quantity",
            "available_quantity",
            "pending_outgoing_quantity",
            "lost_quantity",
        ):
            columns[field] = case((table.c.material_type.not_in(WEIGHT_ONLY_TYPES), columns[field]))
    if by_serial:
        return inventory_serial_page(
            db, table, conditions, columns, matches, filters, now, serial_search
        )
    conditions.extend(table_predicates(columns, matches=matches))
    query_state = current_table_query.get()
    option_statement = select(table).where(*conditions)
    option_columns = columns
    if (
        query_state
        and query_state.options
        and query_state.options.field in ("batch_no", "previous_batch_no")
    ):
        option_statement = option_statement.join(mt, and_(*matching_sources)).outerjoin(
            parent, parent.id == mt.source_transfer_id
        )
        option_columns = {**columns, "batch_no": mt.batch_no, "previous_batch_no": parent.batch_no}
    table_options(db, option_statement, option_columns)
    total = db.scalar(select(func.count()).select_from(table).where(*conditions)) or 0
    rows = (
        db.execute(
            select(
                table,
                processing_state.label("processing_state"),
                columns["task_batch_number"].label("task_batch_number"),
            )
            .where(*conditions)
            .order_by(
                *table_order(columns, table.c.last_activity_at.desc(), table.c.group_id.desc())
            )
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
    batches = {}
    checked_lots = set()
    output_parents = set()
    if rows:
        # Fetch complete batch lists only for this page; do not use GROUP_CONCAT,
        # whose MySQL length limit can silently lose batch numbers.
        source_rows = db.execute(
            select(
                *(column.label(name) for name, column in origins.items()),
                mt.batch_no,
                mt.id,
                mt.next_team_code,
                mt.source_transfer_id,
                mt.entry_kind,
                parent.batch_no.label("previous_batch_no"),
            )
            .outerjoin(parent, parent.id == mt.source_transfer_id)
            .where(
                mt.next_team_id == team_id if team_id is not None else True,
                mt.status == "received",
                mt.stock_tracked.is_(True),
                or_(*(and_(*group_conditions(origins, row)) for row in rows)),
            )
        ).mappings()
        for source in source_rows:
            if source["next_team_code"] in SELF_CHECK_TEAM_CODES:
                checked_lots.add(source["id"])
                if source["entry_kind"] == "processing_output":
                    output_parents.add(source["source_transfer_id"])
            current, previous = batches.setdefault(
                tuple(source[name] for name in origins), (set(), set())
            )
            current.add(source["batch_no"])
            if source["previous_batch_no"]:
                previous.add(source["previous_batch_no"])
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
    from .warehouse_receipts import editable_ids

    receipt_ids = [
        row["group_id"] for row in rows if row["receipt_source"] in ("external", "return")
    ]
    editable_receipts = editable_ids(db, receipt_ids) if receipt_ids else set()
    failed_quantities = lot_self_check_counts(db, checked_lots, output_parents)
    completed_by_team = {}
    for row in rows:
        if row["processing_state"] == "complete":
            owner = team_id if team_id is not None else row["team_id"]
            completed_by_team.setdefault(owner, []).append(row["group_id"])
    lots_with_next_task = set()
    for owner, ids in completed_by_team.items():
        statement = select(mt.id).where(mt.id.in_(ids), next_local_work(owner, ids))
        lots_with_next_task.update(db.scalars(statement))
    items = []
    teams = {team.id: team for team in db.scalars(select(Team))} if team_id is None else {}
    for row in rows:
        item = dict(row)
        item.pop("matches_date")
        item.pop("stock_batch_no")
        item.pop("schedule_task_id")
        current, previous = batches[tuple(row[name] for name in origins)]
        item["batch_nos"] = sorted(current)
        item["receipt_editable"] = row["group_id"] in editable_receipts
        item["failed_quantity"] = failed_quantities.get(row["group_id"])
        item["has_next_processing_task"] = row["group_id"] in lots_with_next_task
        item["previous_batch_nos"] = sorted(previous)
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


def inventory_serial_page(db, lots, conditions, lot_columns, lot_matches, filters, now, search):
    from .shared_material import annotate_groups, serial_match
    from .table_query import column_predicate, table_options, table_order, table_predicates

    c = lots.c
    # Joint material has one physical balance while allocation is pending. Allocated
    # outputs can be combined with other lots belonging to the same order.
    joint = case((c.shared_unallocated.is_(True), c.shared_group_id))
    unnumbered = case((and_(c.serial_no == "", joint.is_(None)), c.stock_batch_no))
    quantities = {
        key: func.sum(case((c.material_type.not_in(WEIGHT_ONLY_TYPES), c[key])))
        for key in ("on_hand_quantity", "in_transit_quantity")
    }
    weights = {key: func.sum(c[key]) for key in ("on_hand_weight", "in_transit_weight")}
    on_hand = or_(quantities["on_hand_quantity"] > 0, weights["on_hand_weight"] > 0)
    transit = or_(quantities["in_transit_quantity"] > 0, weights["in_transit_weight"] > 0)
    state = lot_columns["processing_state"]
    fields = {
        "material_name": case(
            (func.count(func.distinct(c.material_name)) > 1, "多种材质"),
            else_=func.min(c.material_name),
        ),
        **quantities,
        **weights,
        "stock_total_quantity": quantities["on_hand_quantity"] + quantities["in_transit_quantity"],
        "stock_total_weight": weights["on_hand_weight"] + weights["in_transit_weight"],
        "stock_status": case(
            (func.sum(c.inspection_hold_count) > 0, "质量处理中"),
            (func.sum(c.shortage_quantity + c.shortage_weight) > 0, "库存待核对"),
            (and_(on_hand, transit), "部分在途"),
            (transit, "转出待签收"),
            (on_hand, "在库"),
            else_="已结清",
        ),
        "processing_state": case(
            (func.count(func.distinct(state)) > 1, "mixed"), else_=func.min(state)
        ),
        "last_activity_at": func.max(c.last_activity_at),
    }
    summary_keys = {*fields, "serial_no"}
    conditions = [
        *conditions,
        *table_predicates(lot_columns, matches=lot_matches, skip_fields=summary_keys),
    ]
    groups = (
        select(
            c.serial_no,
            joint.label("shared_group_id"),
            func.max(case((joint.is_not(None), 1), else_=0)).label("shared_unallocated"),
            unnumbered.label("unnumbered_batch_no"),
            *(value.label(key) for key, value in fields.items()),
        )
        .where(*conditions)
        .group_by(c.serial_no, joint, unnumbered)
    )
    if search is not None:
        groups = groups.having(func.max(case((search, 1), else_=0)) == 1)
    groups = groups.subquery()
    columns = dict(groups.c.items())
    serial = groups.c.serial_no
    matches = {
        "serial_no": lambda item: (
            serial_match(serial, item.value, "contains")
            if item.operator in (None, "contains") and item.value
            else column_predicate(serial, item)
        )
    }
    statement = select(groups).where(
        *table_predicates(columns, matches=matches, skip_fields=lot_columns.keys() - summary_keys)
    )
    table_options(db, statement, columns)
    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    rows = db.execute(
        statement.order_by(
            *table_order(
                columns,
                groups.c.last_activity_at.desc(),
                serial,
                groups.c.shared_group_id,
                groups.c.unnumbered_batch_no,
            )
        )
        .offset((filters.page - 1) * filters.page_size)
        .limit(filters.page_size)
    ).mappings()
    items = [
        dict(row, last_activity_at=row["last_activity_at"].replace(tzinfo=timezone.utc).isoformat())
        for row in rows
    ]
    annotate_groups(db, items)
    return {
        "items": items,
        "total": total,
        "page": filters.page,
        "page_size": filters.page_size,
        "as_of": now.replace(tzinfo=timezone.utc).isoformat(),
    }


def source_group_conditions(db, team_id, group_id):
    """Resolve a tracked receipt in its team before reading the related group."""
    require_team(db, team_id)
    origins = origin_columns()
    scope = (
        mt.next_team_id == team_id,
        mt.status == "received",
        mt.stock_tracked.is_(True),
    )
    anchor = (
        db.execute(
            select(*(column.label(name) for name, column in origins.items())).where(
                mt.id == group_id, *scope
            )
        )
        .mappings()
        .first()
    )
    if anchor is None:
        raise HTTPException(404, "未找到该班组的库存来源")
    return [*scope, *group_conditions(origins, anchor)]


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
    conditions = source_group_conditions(db, team_id, group_id)
    stock = stock_table(team_id)
    statement = select(mt, stock).join(stock, stock.c.transfer_id == mt.id).where(*conditions)
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
    conditions = source_group_conditions(db, team_id, group_id)
    sources = select(mt.id).where(*conditions)
    conditions = [
        mt.source_team_id == team_id,
        mt.status == "pending",
        withdrawn_from(sources),
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
    conditions = source_group_conditions(db, team_id, group_id)
    sources = select(mt.id).where(*conditions)
    # Each actual receipt/outbound document appears once, with its own TL number.
    # Match children by source identity, not their destination nature or purpose.
    scope = and_(
        mt.entry_kind.not_in(("processing_output", "rework_split")),
        or_(
            mt.id.in_(sources),
            and_(mt.source_team_id == team_id, withdrawn_from(sources)),
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
