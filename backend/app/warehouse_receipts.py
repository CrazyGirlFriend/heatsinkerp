"""Warehouse manual stock origins and confirmed incoming ledgers for every team."""

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import object_session

from . import material_stock as stock
from . import material_transfer_workflow as workflow
from .auth import actor_name, can_manage_team
from .batch_numbers import next_transfer_batch_number
from .material_weight import sludge_measurement, validate_material_amounts
from .models import (
    MaterialDispatch,
    MaterialInspection,
    MaterialLoss,
    MaterialQuantityAdjustment,
    MaterialTransfer,
    MaterialTransferEvent,
    ProductionScheduleSource,
    Team,
    WarehousePlacement,
    WarehouseReceiptDocument,
    utcnow,
)
from .process_route_schemas import RouteWrite
from .process_routes import require_route
from .record_filters import RecordFilters
from .schemas import SCRAP_MATERIAL_TYPES
from .team_constants import WAREHOUSE_TEAM_CODE


def require_warehouse(team):
    if team is None:
        raise HTTPException(404, "warehouse not found")
    if team.code != WAREHOUSE_TEAM_CODE or team.kind != "warehouse":
        raise HTTPException(403, "manual stock receipt is only available in the warehouse")
    return team


def check_warehouse_actor(db, user, team_id):
    with db.begin():
        require_warehouse(stock.actor_team(db, user, team_id))


def editable_ids(db, lot_ids, *, locking=False):
    lot = MaterialTransfer.__table__
    child = lot.alias("receipt_child")
    event = MaterialTransferEvent.__table__
    dependencies = (
        select(child.c.id).where(child.c.source_transfer_id == lot.c.id),
        select(MaterialLoss.id).where(MaterialLoss.source_transfer_id == lot.c.id),
        select(MaterialQuantityAdjustment.id).where(
            MaterialQuantityAdjustment.source_transfer_id == lot.c.id
        ),
        select(MaterialInspection.id).where(MaterialInspection.source_transfer_id == lot.c.id),
        select(ProductionScheduleSource.schedule_id).where(
            ProductionScheduleSource.source_transfer_id == lot.c.id
        ),
        select(event.c.id).where(
            event.c.transfer_id == lot.c.id,
            event.c.changes["main_system_schema_version"]["after"].as_string().is_not(None),
        ),
    )
    statement = select(lot.c.id).where(
        lot.c.id.in_(lot_ids),
        lot.c.entry_kind == "warehouse_receipt",
        lot.c.next_team_code == WAREHOUSE_TEAM_CODE,
        lot.c.status == "received",
        lot.c.stock_tracked.is_(True),
        lot.c.shared_group_id.is_(None),
        *(~(query.with_for_update() if locking else query).exists() for query in dependencies),
    )
    return set(db.scalars(statement.with_for_update() if locking else statement))


def edit_actions(db, lot, user):
    if (
        lot.entry_kind == "warehouse_receipt"
        and lot.next_team is not None
        and lot.next_team.active
        and can_manage_team(user, lot.next_team_id)
        and editable_ids(db, [lot.id])
    ):
        return ["edit_receipt"]
    return []


def _correction_location(db, lot, team, payload, user):
    from .warehouse_locations import consume, lock_location

    if (
        payload.warehouse_location_reservation_key
        or payload.warehouse_location != lot.warehouse_location
    ):
        return consume(db, team, payload, user, required=True)
    if not payload.warehouse_location:
        raise HTTPException(422, "请选择入库仓位")
    if (payload.quantity, payload.weight) == (lot.quantity, lot.weight):
        return lot.warehouse_location
    location_ids = db.scalars(
        select(WarehousePlacement.location_id)
        .where(WarehousePlacement.transfer_id == lot.id)
        .with_for_update()
    ).all()
    if len(location_ids) != 1:
        raise HTTPException(409, "请重新选择仓位以登记更正后的库存")
    location = lock_location(db, location_ids[0])
    if not location.active or location.team_id != team.id:
        raise HTTPException(409, "原仓位已不可用，请重新选择仓位")
    return location.name


def update_receipt(db, team_id, lot_id, payload, user):
    from .material_delivery import FIELDS as delivery_fields
    from .material_delivery import with_schedule
    from .process_route_paths import require_order_route

    stock.require_actor(user, team_id)
    try:
        with db.begin():
            if db.bind.dialect.name == "sqlite":
                db.connection().exec_driver_sql("BEGIN IMMEDIATE")
            lot = stock.lock_lot(db, lot_id, team_id)
            team = require_warehouse(stock.actor_team(db, user, team_id))
            if lot.id not in editable_ids(db, [lot.id], locking=True):
                raise HTTPException(
                    409, "此入库单已有流转、加工、盘点或排期记录，或来自主系统，不能修改"
                )
            if lot.version != payload.expected_version:
                raise HTTPException(409, "入库单已更新，请重新打开并核对")
            serial = payload.serial_no if "serial_no" in payload.model_fields_set else lot.serial_no
            if not serial and (
                lot.receipt_kind == "return" or payload.material_type not in SCRAP_MATERIAL_TYPES
            ):
                raise HTTPException(422, "请填写或选择流水号")
            if serial.startswith("共投-"):
                raise HTTPException(422, "请输入有效流水号")
            if lot.receipt_kind == "return" and not (
                payload.external_source
                if "external_source" in payload.model_fields_set
                else lot.external_source
            ):
                raise HTTPException(422, "外部返料须填写来源单位")
            if (
                lot.return_dispatch_no
                and "is_outsourced" in payload.model_fields_set
                and payload.is_outsourced != lot.is_outsourced
            ):
                raise HTTPException(422, "已关联出库单的返料须沿用原批次外委标记")
            if serial != lot.serial_no:
                if lot.return_dispatch_no:
                    raise HTTPException(422, "已关联原出库批次的返料须沿用原流水号")
                documents = db.scalars(
                    select(WarehouseReceiptDocument).where(
                        WarehouseReceiptDocument.transfer_id == lot.id
                    )
                ).all()
                if any(
                    row.kind == "order" and row.parsed.get("serial_no") != serial
                    for row in documents
                ):
                    raise HTTPException(422, "流水号须与已归档的订单表一致")
                if lot.process_route:
                    require_order_route(db, lot.process_route, serial)
            if lot.process_route and payload.material_type in SCRAP_MATERIAL_TYPES:
                raise HTTPException(422, "已关联工艺的入库单不能改为废料")
            validate_material_amounts(
                payload.material_type, payload.quantity, payload.weight, existing=lot
            )
            measured = sludge_measurement(
                payload.material_type,
                payload.weight,
                payload.sludge_gross_weight,
                payload.sludge_content_percent,
                existing=lot,
            )
            location = _correction_location(db, lot, team, payload, user)
            before = workflow._snapshot(lot)
            fields = set(workflow.DOCUMENT_FIELDS) - set(delivery_fields)
            fields.update(("serial_no", "external_source", "quantity", "weight", "notes"))
            for field in fields & payload.model_fields_set:
                setattr(lot, field, getattr(payload, field))
            for field in workflow.SLUDGE_FIELDS:
                setattr(lot, field, measured.get(field))
            lot.warehouse_location = location
            if workflow._snapshot(lot) != before:
                lot.version += 1
                lot.updated_at = utcnow()
                workflow._record_event(db, lot, user, "receipt_updated", before)
            result = workflow.material_transfer_dict(lot, user)
            result["allowed_actions"] = ["edit_receipt"]
            return with_schedule(db, [result])[0]
    except OperationalError as exc:
        db.rollback()
        if getattr(exc.orig, "sqlite_errorcode", None) in (5, 6) or getattr(
            exc.orig, "args", (None,)
        )[0] in (1205, 1213):
            raise HTTPException(409, "库存正在更新，请重新打开入库单核对") from exc
        raise


def replay(prior, user, request_hash, team_id):
    if prior.entry_kind != "warehouse_receipt":
        raise HTTPException(409, "idempotency key was used for another operation")
    stock._replay(prior, user, request_hash, "next_team_id", team_id)
    result = workflow.material_transfer_dict(prior, user)
    result["allowed_actions"] = edit_actions(object_session(prior), prior, user)
    return result


def intake_route(db, team, payload, user):
    """Bind an engineering-published route without changing its reviewed content."""
    if payload.process_route is None:
        return None
    if payload.receipt_kind != "external" or payload.material_type in SCRAP_MATERIAL_TYPES:
        raise HTTPException(422, "工艺导入仅用于正常物料的首次来料录入")
    submitted = payload.process_route
    route = require_route(db, submitted.id, True)
    if route.route_kind != "normal" or route.state != "published":
        raise HTTPException(422, "请先由工艺班组保存完整工艺，库房仅按流水号关联")
    if route.version != submitted.version:
        raise HTTPException(409, "工艺版本已变化，请重新选择")
    from .process_route_paths import require_order_route

    require_order_route(db, route, payload.serial_no)
    content = {
        "title": submitted.title,
        "serial_nos": submitted.serial_nos,
        "steps": [step.model_dump() for step in submitted.steps],
        "review_note": submitted.review_note.strip(),
        "version": submitted.version,
    }
    existing = RouteWrite.model_validate({key: getattr(route, key) for key in content}).model_dump(
        include=set(content)
    )
    if content != existing:
        raise HTTPException(409, "已发布工艺不能随入库修改，请重新关联已发布版本")
    if route.steps[0]["team_id"] != team.id:
        raise HTTPException(422, "工艺路线起始工序必须为当前库房")
    return route


def create_receipt(db, team_id, payload, user, *, request_hash=None, source_reference=None):
    from .material_delivery import validate_pair

    validate_pair(payload.delivery_date, payload.delivery_quantity)
    if payload.receipt_kind == "return" and payload.delivery_date is not None:
        raise HTTPException(422, "返料沿用原批次交期，不能新增交付要求")
    stock.require_actor(user, team_id)
    request_hash = request_hash or workflow._creation_fingerprint(payload)
    try:
        with db.begin():
            # Recheck the directory under a current-read lock and serialize
            # simultaneous intakes before issuing a batch number.
            team = require_warehouse(
                db.scalar(
                    select(Team)
                    .where(Team.id == team_id)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
            )
            if not team.active:
                raise HTTPException(403, "warehouse must be active")
            prior = db.scalar(
                select(MaterialTransfer)
                .where(MaterialTransfer.idempotency_key == payload.idempotency_key)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if prior is not None:
                return replay(prior, user, request_hash, team_id)
            if payload.shared_serials:
                raise HTTPException(422, "入库只登记实物，共投请在库房向下序转出时填写")
            if not payload.serial_no and payload.material_type not in SCRAP_MATERIAL_TYPES:
                raise HTTPException(422, "请填写或选择流水号")
            from .warehouse_receipt_documents import attach_documents, validate_documents

            documents = validate_documents(db, team, payload, user)
            route = intake_route(db, team, payload, user)
            delivery_origin_id = None
            outsourced = payload.is_outsourced
            if payload.return_dispatch_no:
                # New returns reference the actual batch; old CK references remain readable.
                historical = select(MaterialDispatch.id).where(
                    MaterialDispatch.dispatch_no == payload.return_dispatch_no
                )
                matching = db.execute(
                    select(
                        MaterialTransfer.id,
                        MaterialTransfer.delivery_origin_id,
                        MaterialTransfer.is_outsourced,
                    ).where(
                        (MaterialTransfer.batch_no == payload.return_dispatch_no)
                        | MaterialTransfer.dispatch_id.in_(historical),
                        MaterialTransfer.entry_kind.in_(
                            ("warehouse_outbound", "inspection_shipment")
                        ),
                        MaterialTransfer.serial_no == payload.serial_no,
                        MaterialTransfer.status == "dispatched",
                    )
                ).all()
                if not matching:
                    raise HTTPException(422, "关联批次没有该流水号的已确认出库记录")
                sources = {row.is_outsourced for row in matching}
                if len(sources) > 1:
                    raise HTTPException(422, "原出库单同时含外委和普通产品，请按实物批次退回")
                outsourced = outsourced or sources.pop()
                origins = {row.delivery_origin_id or row.id for row in matching}
                # An old combined dispatch can span several requirements; do not guess one.
                if len(origins) == 1:
                    delivery_origin_id = origins.pop()
            from .warehouse_locations import consume

            validate_material_amounts(payload.material_type, payload.quantity, payload.weight)
            measured = sludge_measurement(
                payload.material_type,
                payload.weight,
                payload.sludge_gross_weight,
                payload.sludge_content_percent,
            )
            number = next_transfer_batch_number(db)
            serial_no = payload.serial_no
            location_name = consume(
                db,
                team,
                payload,
                user,
                identity=(serial_no, payload.material_name, payload.material_type),
                required=True,
            )
            now = utcnow()
            receipt = MaterialTransfer(
                batch_no=number,
                entry_kind="warehouse_receipt",
                process_route=route,
                process_step_index=0 if route else None,
                process_step_complete=bool(route),
                receipt_kind=payload.receipt_kind,
                external_source=payload.external_source,
                return_dispatch_no=payload.return_dispatch_no,
                warehouse_location=location_name,
                serial_no=serial_no,
                delivery_origin_id=delivery_origin_id,
                is_outsourced=outsourced,
                **{
                    field: getattr(payload, field)
                    for field in workflow.DOCUMENT_FIELDS
                    if field != "is_outsourced"
                },
                source_team_id=None,
                source_team_code=None,
                source_team_name=None,
                next_team_id=team.id,
                next_team_code=team.code,
                next_team_name=team.name,
                quantity=payload.quantity,
                weight=payload.weight,
                notes=payload.notes,
                **measured,
                status="received",
                stock_tracked=True,
                version=1,
                idempotency_key=payload.idempotency_key,
                request_hash=request_hash,
                created_by=actor_name(user),
                created_by_user_id=user.id,
                received_by=actor_name(user),
                received_by_user_id=user.id,
                created_at=now,
                updated_at=now,
                received_at=now,
                # Only a new origin is known to have no audit or losses yet.
                history=[],
                losses=[],
            )
            db.add(receipt)
            db.flush()
            attach_documents(db, receipt, documents)
            # MySQL DATETIME(0) rounds fractional seconds. Audit and the first
            # response must use persisted times, just like an idempotent replay.
            db.refresh(receipt, attribute_names=["created_at", "updated_at", "received_at"])
            workflow._record_event(db, receipt, user, "stocked")
            if source_reference:
                event = receipt.history[-1]
                event.changes = {
                    **event.changes,
                    **{
                        key: {"before": None, "after": value}
                        for key, value in source_reference.items()
                    },
                }
                db.flush()
            result = workflow.material_transfer_dict(receipt, user)
            if not source_reference:
                result["allowed_actions"] = ["edit_receipt"]
        return result
    except (IntegrityError, OperationalError) as exc:
        db.rollback()
        prior = db.scalar(
            select(MaterialTransfer).where(
                MaterialTransfer.idempotency_key == payload.idempotency_key
            )
        )
        if prior is not None:
            return replay(prior, user, request_hash, team_id)
        stock._db_conflict(exc)


def list_receipts(
    db,
    team_id,
    user,
    *,
    record_filters=None,
    query=None,
    material_type=None,
    receipt_source=None,
    page=1,
    page_size=20,
):
    team = stock.require_team(db, team_id)
    # Receiving a batch creates its ledger entry; later stock depletion does not remove it.
    filters = [
        MaterialTransfer.next_team_id == team_id,
        MaterialTransfer.status == "received",
        MaterialTransfer.entry_kind != "processing_output",
    ]
    if receipt_source == "internal":
        filters.append(MaterialTransfer.entry_kind == "transfer")
    elif receipt_source == "external":
        filters.append(MaterialTransfer.entry_kind == "warehouse_receipt")
    elif receipt_source == "return":
        filters.extend(
            [
                MaterialTransfer.entry_kind == "warehouse_receipt",
                MaterialTransfer.receipt_kind == "return",
            ]
        )
    filters.extend(
        (record_filters or RecordFilters()).predicates(
            MaterialTransfer.received_at, MaterialTransfer.serial_no
        )
    )
    if material_type:
        filters.append(MaterialTransfer.material_type == material_type)
    if query and query.strip():
        filters.append(
            stock.literal_query(
                query,
                [
                    MaterialTransfer.batch_no,
                    MaterialTransfer.serial_no,
                    MaterialTransfer.material_name,
                    MaterialTransfer.source_batch_no,
                    MaterialTransfer.external_source,
                    MaterialTransfer.source_team_name,
                    MaterialTransfer.return_dispatch_no,
                    MaterialTransfer.warehouse_location,
                ],
            )
        )
    from .material_transfer_query import transfer_table_columns
    from .table_query import table_order
    from .transfer_record_filters import apply_record_headers

    columns = transfer_table_columns()
    apply_record_headers(db, columns, filters, "receipts")
    total = db.scalar(select(func.count(MaterialTransfer.id)).where(*filters)) or 0
    items = db.scalars(
        select(MaterialTransfer)
        .options(*workflow.material_transfer_list_options())
        .where(*filters)
        .order_by(
            *table_order(columns, MaterialTransfer.received_at.desc(), MaterialTransfer.id.desc())
        )
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    rows = [workflow.material_transfer_dict(item, user, include_history=False) for item in items]
    if (
        team.active
        and team.kind == "warehouse"
        and team.code == WAREHOUSE_TEAM_CODE
        and can_manage_team(user, team_id)
    ):
        receipt_ids = [item.id for item in items if item.entry_kind == "warehouse_receipt"]
        if receipt_ids:
            editable = editable_ids(db, receipt_ids)
            for row in rows:
                if row["id"] in editable:
                    row["allowed_actions"] = ["edit_receipt"]
    return {
        "items": rows,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


def locations(db, team_id, *, query=None, limit=100, page=1, selected=None, identity=None):
    from .warehouse_locations import list_locations

    return list_locations(
        db,
        team_id,
        query=query,
        page=page,
        page_size=limit,
        available_only=True,
        selected=selected,
        identity=identity,
    )
