"""Published dispatch routes and physical-lot progress, in stock transactions."""

from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import func, select

from .models import (
    MaterialTransfer,
    ProcessRoute,
    ProcessRouteArchive,
    ProcessRouteDrawing,
    ProcessRoutePath,
    Team,
    TeamEmployee,
    TeamProcessingTask,
    TeamPurpose,
    utcnow,
)
from .schemas import SCRAP_MATERIAL_TYPES
from .team_constants import (
    ENGINEERING_TEAM_CODE,
    PROCESSING_TEAM_CODES,
    SPLITTING_TEAM_CODES,
    WAREHOUSE_TEAM_CODE,
)


def require_route(db, route_id, lock=False):
    query = select(ProcessRoute).where(ProcessRoute.id == route_id)
    row = db.scalar(
        query.with_for_update().execution_options(populate_existing=True) if lock else query
    )
    if not row:
        raise HTTPException(404, "工艺路线不存在")
    return row


def is_engineering_user(user):
    team = user.team
    return bool(
        user.active
        and user.role == "TEAM"
        and team
        and team.active
        and team.code == ENGINEERING_TEAM_CODE
        and team.kind == "engineering"
    )


def assert_route_importer(user):
    if not (user.active and user.role == "ADMIN") and not is_engineering_user(user):
        raise HTTPException(403, "仅管理员和工艺班组可以维护工艺")
    return user


def require_route_reader(row, user):
    if row.state != "published" and user.role != "ADMIN":
        assert_route_importer(user)
    return row


def require_draft_owner(db, row, user):
    if row.route_kind == "rework":
        raise HTTPException(403, "返修班组由检验在质量反馈中指定")
    assert_route_importer(user)
    if db.get(ProcessRouteArchive, row.id):
        raise HTTPException(409, "该工艺已归入历史，请打开当前工艺")
    if row.state != "draft" or db.scalar(
        select(MaterialTransfer.id).where(MaterialTransfer.process_route_id == row.id).limit(1)
    ):
        raise HTTPException(409, "已发布或已绑定批次的工艺不能继续编辑")


def assign_engineering_employee(db, row, employee_id, *, modifier=False):
    prefix = "modified" if modifier else "engineering"
    if employee_id is None:
        setattr(row, prefix + "_employee_id", None)
        setattr(row, prefix + "_employee_name", None)
        return
    person = db.scalar(
        select(TeamEmployee)
        .join(Team, Team.id == TeamEmployee.team_id)
        .where(
            TeamEmployee.id == employee_id,
            TeamEmployee.active.is_(True),
            Team.code == ENGINEERING_TEAM_CODE,
            Team.kind == "engineering",
            Team.active.is_(True),
        )
        .with_for_update()
    )
    if person is None:
        raise HTTPException(422, "工艺人员须为工艺班组的在职员工")
    setattr(row, prefix + "_employee_id", person.id)
    setattr(row, prefix + "_employee_name", person.name)


def resolve_normal_route(db, serial):
    """Use dispatch's explicit selection before legacy engineering-serial resolution."""
    from sqlalchemy.orm import aliased

    from .process_route_paths import execution_serial, scheduled_route_ids

    scheduled = scheduled_route_ids(db, serial)
    if scheduled:
        if len(scheduled) != 1:
            raise HTTPException(409, "该流水号排期关联了多份工艺，请调度核对后再出库")
        route = require_route(db, scheduled.pop())
        if route.route_kind != "normal" or route.state != "published":
            raise HTTPException(422, "排期关联的工艺尚未发布")
        execution_serial(route, serial)
        require_route_documents(db, route)
        return route
    successor = aliased(ProcessRoute)
    rows = list(
        db.scalars(
            select(ProcessRoute).where(
                ProcessRoute.route_kind == "normal",
                ProcessRoute.state == "published",
                select(ProcessRoutePath.route_id)
                .where(
                    ProcessRoutePath.route_id == ProcessRoute.id,
                    ProcessRoutePath.serial_no == serial,
                )
                .exists(),
                ~select(ProcessRouteArchive.route_id)
                .where(
                    ProcessRouteArchive.route_id == ProcessRoute.id,
                )
                .exists(),
                ~select(successor.id)
                .where(
                    successor.parent_id == ProcessRoute.id,
                    successor.state == "published",
                )
                .exists(),
            )
        )
    )
    if not rows:
        raise HTTPException(404, "未找到该流水号的正常工艺")
    if len(rows) != 1:
        raise HTTPException(409, "该流水号有多份工艺，请工艺班组核对后再出库")
    require_route_documents(db, rows[0])
    return rows[0]


def route_document_checks():
    return {
        "工艺原件": (func.length(func.trim(ProcessRoute.filename)) > 0)
        & (func.length(ProcessRoute.source_file) > 0),
        "图纸": select(ProcessRouteDrawing.id)
        .where(
            ProcessRouteDrawing.route_id == ProcessRoute.id,
            func.length(ProcessRouteDrawing.content) > 0,
        )
        .exists(),
    }


def missing_route_documents(db, route_ids):
    if not route_ids:
        return {}
    checks = route_document_checks()
    return {
        row[0]: [label for label, present in zip(checks, row[1:], strict=True) if not present]
        for row in db.execute(
            select(ProcessRoute.id, *checks.values()).where(
                ProcessRoute.id.in_(route_ids), ProcessRoute.route_kind == "normal"
            )
        )
    }


def require_route_documents(db, row):
    missing = missing_route_documents(db, [row.id]).get(row.id, [])
    if missing:
        raise HTTPException(422, "缺少：" + "、".join(missing))


def publish_route(db, row):
    from .process_route_serials import reserve_serial

    require_route_documents(db, row)
    reserve_serial(db, row)
    row.steps = validate_steps(db, row)
    from .rework_routes import activate

    activate(db, row)
    row.state, row.published_at = "published", utcnow()
    db.add_all(
        ProcessRoutePath(
            route_id=row.id, serial_no=serial, step_index=index, team_id=step["team_id"]
        )
        for index, step in enumerate(row.steps)
        for serial in (step["serial_nos"] or dict.fromkeys(["", *row.serial_nos]))
    )


def route_document(lot):
    from .shared_material import execution_step, is_split_step

    if not lot.process_route_id:
        return None
    route = lot.process_route
    from .process_route_paths import execution_serial

    step = execution_step(lot, lot.process_step_index)
    following = None
    if lot.process_step_complete:
        try:
            index = next_index(route, lot.process_step_index, lot.serial_no, lot.shared_unallocated)
            following = execution_step(lot, index) if index is not None else None
        except HTTPException:
            pass  # Unsplit common stock is explained by the route's split marker.
    can_resume = False
    if route.route_kind == "rework":
        if step["team_id"] != lot.next_team_id:
            following = step
        elif lot.process_step_complete and following is None:
            can_resume = lot.next_team_id == route.resume_team_id
            following = {"team_id": route.resume_team_id, "purpose_id": None}
    return {
        "can_resume": can_resume,
        "id": route.id,
        "route_kind": route.route_kind,
        "execution_serial": None
        if lot.shared_unallocated
        else execution_serial(route, lot.serial_no),
        "rework_of_id": route.rework_of_id,
        "title": route.title,
        "version": route.version,
        "step_index": lot.process_step_index,
        "sequence_no": step["sequence_no"],
        "step_name": step["name"],
        "instructions": step["instructions"],
        "team_id": step["team_id"],
        "processing_task_id": step.get("processing_task_id"),
        "purpose_id": step.get("purpose_id"),
        "complete": lot.process_step_complete,
        "split_here": is_split_step(lot, lot.process_step_index),
        "next_team_id": following["team_id"] if following else None,
        "next_purpose_id": following.get("purpose_id") if following else None,
    }


def next_index(route, index, serial_no, unallocated=False):
    from .process_route_paths import execution_serial

    serial = serial_no if unallocated else execution_serial(route, serial_no)
    for position in range(index + 1, len(route.steps)):
        members = route.steps[position].get("serial_nos", [])
        if not members or (not unallocated and serial in members):
            return position
        if unallocated:
            raise HTTPException(409, "共投料已到分支工序，请先在指定工序登记实际拆分和流水号归属")
    return None


def processing_step(lot):
    if not lot.process_route_id:
        return None
    index = lot.process_step_index
    if lot.process_step_complete:
        index = next_index(lot.process_route, index, lot.serial_no, lot.shared_unallocated)
        if index is None or lot.process_route.steps[index]["team_id"] != lot.next_team_id:
            raise HTTPException(409, "本道工序已完成，请按工艺路线转出；重复加工请登记返工")
    return index


def processing_context(lot):
    doc = route_document(lot)
    if not doc:
        return None
    try:
        index = processing_step(lot)
    except HTTPException:
        return {**doc, "available": False}
    from .shared_material import execution_step, is_split_step

    step = execution_step(lot, index)

    return {
        **doc,
        **{
            key: step.get(key)
            for key in ("instructions", "processing_task_id", "purpose_id", "split_here")
        },
        "split_here": is_split_step(lot, index),
        "step_name": step["name"],
        "sequence_no": step["sequence_no"],
        "step_index": index,
        "available": True,
    }


def prepare_processing(lot, payload):
    from .rework_routes import active, pending
    from .shared_material import execution_step

    if pending(lot):
        raise HTTPException(422, "待检验指定返修班组")
    if active(lot) and payload.work_kind != "rework":
        raise HTTPException(422, "本批按返工工艺执行，不能登记为正常产量")
    if not lot.process_route_id or (payload.work_kind == "rework" and not active(lot)):
        return payload, None
    index = processing_step(lot)
    step = execution_step(lot, index)
    if step["team_id"] != lot.next_team_id:
        raise HTTPException(409, "本批工艺工序与当前班组不一致")
    if (
        step["processing_task_id"] is not None
        and payload.processing_task_id is not None
        and payload.processing_task_id != step["processing_task_id"]
    ):
        raise HTTPException(422, "请执行工艺路线指定的具体任务，不能更换工序")
    if (
        step["purpose_id"] is not None
        and payload.purpose_id is not None
        and payload.purpose_id != step["purpose_id"]
    ):
        raise HTTPException(422, "请执行工艺路线指定的业务")
    if lot.shared_unallocated and payload.outputs:
        allocated = [line for line in payload.outputs if line.role == "produced" and line.serial_no]
        from .shared_material import is_split_step

        if allocated and not is_split_step(lot, index):
            raise HTTPException(422, "本工序不是共投料的指定拆分点")
    return payload.model_copy(
        update={
            key: step[key] for key in ("processing_task_id", "purpose_id") if step[key] is not None
        }
    ), index


def processing_fields(lot, index):
    if index is None:
        return {}
    step = lot.process_route.steps[index]
    return {
        "process_route_id": lot.process_route_id,
        "process_step_index": index,
        "process_step_name": f"{step['sequence_no']} · {step['name']}",
        "process_step_instructions": step["instructions"],
    }


def finish_processing(db, lot, payload, index, outputs):
    if index is None:
        if lot.process_route_id:
            for child in outputs:
                child.process_route = lot.process_route
                child.process_route_id = lot.process_route_id
                child.process_step_index = lot.process_step_index
                child.process_step_complete = lot.process_step_complete
        return
    if outputs:
        for child in outputs:
            child.rework_route_id = lot.rework_route_id
            if lot.process_route.route_kind == "rework":
                finished = child.processing_role == "scrap" or (
                    child.processing_role == "produced"
                    and next_index(
                        lot.process_route, index, child.serial_no, child.shared_unallocated
                    )
                    is None
                )
                child.rework_count = (
                    lot.process_route.rework_round if finished else lot.rework_count
                )
            child.process_route_id = lot.process_route_id
            child.process_step_index = (
                index if child.processing_role != "remaining" else lot.process_step_index
            )
            child.process_step_complete = (
                lot.process_step_complete
                if child.processing_role == "remaining"
                else child.processing_role == "produced"
            )
            child.process_route = lot.process_route
            if (
                lot.shared_unallocated
                and child.processing_role == "produced"
                and not child.shared_unallocated
            ):
                member = next(
                    member
                    for member in lot.shared_group.members
                    if member.serial_no == child.serial_no
                )
                if member.process_route_id:
                    child.process_route = member.process_route
                    child.process_route_id = member.process_route_id
                if member.feeding_schedule_id:
                    from .processing_schedules import split_plan_id

                    child.processing_schedule_id = split_plan_id(
                        db, member, lot.next_team_id, index
                    )
    elif payload.processing_status == "complete":
        lot.process_step_index, lot.process_step_complete = index, True
        if (
            lot.process_route.route_kind == "rework"
            and next_index(lot.process_route, index, lot.serial_no, lot.shared_unallocated) is None
        ):
            lot.rework_count = lot.process_route.rework_round
    # A partial count-only entry cannot prove which pieces completed a step.
    elif payload.processing_status == "partial":
        raise HTTPException(422, "部分加工请分别登记已加工产出和未加工余料，才能按批次流转工序")


def require_dispatch_documents(db, route, lot, serial, task_id=None):
    require_route_documents(db, route)
    if route.route_kind != "rework":
        from .models import ProcessRouteOrderFile
        from .schedule_order_documents import route_order
        from .warehouse_receipt_documents import has_confirmed_order

        order = route_order(db, route.id, serial, task_id)
        legacy = db.get(ProcessRouteOrderFile, route.id)
        if (
            not order
            and not (
                legacy
                and legacy.content
                and (route.source_data.get("order_document") or {}).get("serial_no") == serial
            )
            and not has_confirmed_order(db, lot, serial)
        ):
            raise HTTPException(422, "缺少：订单表，请调度上传或在库房入库时补充后再出库")
        from .models import ProductionScheduleTask

        task = (
            db.get(ProductionScheduleTask, task_id or order.task_id) if task_id or order else None
        )
        requirement = order.document if order else route.source_data.get("order_document") or {}
        due = ((requirement.get("receipt_fields") or {}).get("delivery_date") or {}).get("value")
        if not (task and task.final_due_at) and not lot.delivery_date and not due:
            raise HTTPException(422, "缺少交期，请调度补充本批排期后再出库")


def warehouse_dispatch_portion(db, selected_route, source, serial):
    if (
        selected_route is None
        or selected_route.route_kind != "normal"
        or selected_route.state != "published"
        or selected_route.steps[0]["team_id"] != source.id
    ):
        raise HTTPException(422, "流水号或起始库房与工艺不一致")
    from .process_route_paths import require_order_route

    require_order_route(db, selected_route, serial)
    # Bind this outbound portion only; the remaining raw stock stays unassigned.
    return SimpleNamespace(
        process_route_id=selected_route.id,
        process_route=selected_route,
        process_step_index=0,
        process_step_complete=True,
        next_team_id=source.id,
        next_team_code=source.code,
        serial_no=serial,
        shared_unallocated=False,
        rework_route_id=None,
        rework_pending=False,
        rework_count=0,
    )


def prepare_dispatch_route(db, lot, line, source, serial, anonymous, user):
    """Validate the serial's documents and preserve the reviewed route cursor."""
    from .process_route_binding import bind_lot

    if not serial:
        raise HTTPException(422, "出库必须填写流水号")
    if line.process_route_id is not None:
        selected_route = require_route(db, line.process_route_id, True)
        if selected_route.version != line.process_route_version:
            raise HTTPException(409, "工艺版本已变化，请重新读取")
    elif not lot.process_route_id and source.code == WAREHOUSE_TEAM_CODE:
        selected_route = resolve_normal_route(db, serial)
    else:
        selected_route = lot.process_route
    if source.code == WAREHOUSE_TEAM_CODE:
        if selected_route is None:
            raise HTTPException(422, "未找到该流水号的工艺")
        from .models import ProductionSchedule

        plan = (
            db.get(ProductionSchedule, line.production_schedule_id)
            if line.production_schedule_id
            else None
        )
        require_dispatch_documents(db, selected_route, lot, serial, plan.task_id if plan else None)
    if anonymous:
        return warehouse_dispatch_portion(db, selected_route, source, serial)
    if line.process_route_id is not None or (not lot.process_route_id and selected_route):
        bind_lot(db, selected_route, lot, user)
    return lot


def dispatch_fields(db, lot, target, kind, rework_return=False, policy=None):
    if kind in SCRAP_MATERIAL_TYPES:
        if lot.material_type not in SCRAP_MATERIAL_TYPES and (
            lot.rework_route_id or lot.rework_pending
        ):
            raise HTTPException(422, "本批须按返工工艺加工，不能直接改为废料转出")
        return {}  # Scrap follows existing scrap/quality controls, not product stages.
    from .rework_routes import dispatch_fields as rework_dispatch

    rework_fields = rework_dispatch(lot, target, rework_return)
    if rework_fields is not None:
        return rework_fields
    if not lot.process_route_id:
        if policy and lot.next_team_code == WAREHOUSE_TEAM_CODE:
            raise HTTPException(422, "本批尚未关联工艺，请在转出前按流水号选择工艺")
        return {}
    if lot.rework_pending and not rework_return:
        raise HTTPException(422, "本批待返工，请先登记返工，不能作为正常产品转出")
    if rework_return:
        # Manual rework preserves its planned cursor; it never advances a normal step.
        return {
            "process_route_id": lot.process_route_id,
            "process_step_index": lot.process_step_index,
            "process_step_complete": lot.process_step_complete,
        }
    current = lot.process_route.steps[lot.process_step_index]
    if current["team_id"] != lot.next_team_id:
        if not target or target.id != current["team_id"] or not lot.rework_count:
            raise HTTPException(422, "返工处理后须返回原工艺工序班组，不能推进或跳过原路线")
        return {
            "process_route_id": lot.process_route_id,
            "process_step_index": lot.process_step_index,
            "process_step_complete": lot.process_step_complete,
        }
    if (
        lot.shared_unallocated
        and lot.shared_group
        and lot.shared_group.split_step_index is not None
    ):
        if lot.process_step_index >= lot.shared_group.split_step_index:
            raise HTTPException(422, "共投料须在本班组拆分并填写流水号归属后再转出")
    if not lot.process_step_complete:
        raise HTTPException(422, "本批当前工序尚未加工完成，不能转入下一工序")
    index = next_index(
        lot.process_route, lot.process_step_index, lot.serial_no, lot.shared_unallocated
    )
    if index is None:
        if target is not None:
            raise HTTPException(422, "工艺路线已完成，请按原有发货或返工流程处理")
        return {
            "process_route_id": lot.process_route_id,
            "process_step_index": lot.process_step_index,
            "process_step_complete": True,
        }
    step = lot.process_route.steps[index]
    if target is None or target.id != step["team_id"]:
        raise HTTPException(
            422,
            f"禁止跳序或更换班组；下一工序为{step['sequence_no']} · {step['name']}（{step['team_name']}）",
        )
    return {
        "process_route_id": lot.process_route_id,
        "process_step_index": index,
        "process_step_complete": target.code == WAREHOUSE_TEAM_CODE,
    }


def validate_steps(db, route):
    steps = route.steps
    if not route.serial_nos or len(set(route.serial_nos)) != len(route.serial_nos):
        raise HTTPException(422, "请确认本次派工的唯一流水号名单")
    sequences = [step["sequence_no"] for step in steps]
    if sequences != sorted(set(sequences)):
        raise HTTPException(422, "工序序号必须递增且不能重复，请核对原文重复行")
    if not steps:
        raise HTTPException(422, "至少需要一道工序")
    teams = {
        team.id: team
        for team in db.scalars(
            select(Team).where(Team.id.in_([step["team_id"] for step in steps])).with_for_update()
        )
    }
    tasks = {
        task.id: task
        for task in db.scalars(
            select(TeamProcessingTask)
            .where(
                TeamProcessingTask.id.in_(
                    [step["processing_task_id"] for step in steps if step["processing_task_id"]]
                )
            )
            .with_for_update()
        )
    }
    purposes = {
        p.id: p
        for p in db.scalars(
            select(TeamPurpose)
            .where(TeamPurpose.id.in_([step["purpose_id"] for step in steps if step["purpose_id"]]))
            .with_for_update()
        )
    }
    reviewed = []
    for step in steps:
        team = teams.get(step["team_id"])
        if not team or not team.active:
            raise HTTPException(422, "每道工序都须明确选择启用的班组")
        if route.route_kind == "rework" and team.code == WAREHOUSE_TEAM_CODE:
            raise HTTPException(422, "返工工序请选择生产班组；库房接收请设为返回工序")
        if step["name"].strip() == "中转库" and team.code != WAREHOUSE_TEAM_CODE:
            raise HTTPException(422, "中转库对应库房班组，请选择库房作为执行班组")
        if not step["name"].strip() or not step["instructions"].strip():
            raise HTTPException(422, "工序名称和工艺要求不能为空")
        if set(step["serial_nos"]) - set(route.serial_nos):
            raise HTTPException(422, "分支工序只能选择本次派工中的流水号")
        if len(set(step["serial_nos"])) != len(step["serial_nos"]):
            raise HTTPException(422, "同一工序不能重复选择适用流水号")
        if step["split_here"] and team.code not in SPLITTING_TEAM_CODES:
            raise HTTPException(422, "实际拆分点须选择轧制、线切割或雕刻工序")
        if team.code != WAREHOUSE_TEAM_CODE:
            if team.code not in PROCESSING_TEAM_CODES or team.kind != "production":
                raise HTTPException(422, "执行班组须为生产班组或库房")
            task, purpose = tasks.get(step["processing_task_id"]), purposes.get(step["purpose_id"])
            if step["processing_task_id"] is not None and (
                not task or not task.active or task.team_id != team.id
            ):
                raise HTTPException(422, f"{step['name']}须对应本班组启用的具体任务")
            if step["purpose_id"] is not None and (
                not purpose or not purpose.active or purpose.team_id != team.id
            ):
                raise HTTPException(422, f"{step['name']}须对应本班组启用的业务")
        elif step["processing_task_id"] is not None:
            raise HTTPException(422, "库房备料不选择加工任务")
        elif step["purpose_id"] is not None:
            purpose = purposes.get(step["purpose_id"])
            if not purpose or not purpose.active or purpose.team_id != team.id:
                raise HTTPException(422, "库房业务须属于本库房且处于启用状态")
        reviewed.append({**step, "team_name": team.name})
    if route.route_kind != "rework" and (
        teams[steps[0]["team_id"]].code != WAREHOUSE_TEAM_CODE or steps[0]["serial_nos"]
    ):
        raise HTTPException(422, "工艺路线须从库房公共备料工序开始")
    branch = next((i for i, step in enumerate(steps) if step["serial_nos"]), None)
    splits = [i for i, step in enumerate(steps) if step["split_here"]]
    if (
        route.route_kind != "rework"
        and len(route.serial_nos) > 1
        and (len(splits) != 1 or splits[0] == 0 or (branch is not None and splits[0] >= branch))
    ):
        raise HTTPException(422, "共投路线须指定一个位于分支之前的加工拆分点")
    if branch is not None and any(not step["serial_nos"] for step in steps[branch:]):
        raise HTTPException(422, "拆分后的工序须明确适用流水号，不能再次变回未分配共投料")
    return reviewed


def validate_schedule(db, payload, previous=None):
    if (
        previous
        and previous.process_route_id
        and (
            previous.process_route_id != payload.process_route_id
            or previous.process_step_index != payload.process_step_index
        )
    ):
        raise HTTPException(422, "工艺排期只能调整交货目标与时间，不能解除或更换工序")
    if payload.process_route_id is None:
        if payload.process_step_index is not None:
            raise HTTPException(422, "工序排期须同时指定工艺路线")
        return
    route = db.get(ProcessRoute, payload.process_route_id)
    index = payload.process_step_index
    if not route or route.state != "published" or index is None or index >= len(route.steps):
        raise HTTPException(422, "请选择本次派工已发布的工艺工序")
    require_route_documents(db, route)
    from .process_route_paths import execution_serial

    serial = execution_serial(route, payload.serial_no)
    step = route.steps[index]
    if step["team_id"] != payload.team_id or (
        step["serial_nos"] and serial not in step["serial_nos"]
    ):
        raise HTTPException(422, "排期班组或流水号与工艺工序不一致")
    following = next_index(route, index, payload.serial_no)
    if following is not None and route.steps[following]["team_id"] != payload.next_team_id:
        raise HTTPException(422, "排期接收班组须与下一工艺工序一致")
    if following is None and payload.next_team_id is not None:
        raise HTTPException(422, "工艺已结束，不能另加未定义的正常产品工序")
    for source in payload.sources:
        lot = db.get(MaterialTransfer, source.source_transfer_id)
        if lot and lot.process_route_id != route.id:
            raise HTTPException(422, "排期来源批次须绑定同一派工工艺")


def local_work_pending():
    """Keep planned repeat operations selectable without a Python post-pagination filter."""
    from sqlalchemy import case, func

    from .process_route_paths import path_serial

    path = ProcessRoutePath.__table__
    following = path.alias("following_route_step")
    serial = path_serial()
    next_step = (
        select(func.min(following.c.step_index))
        .where(
            following.c.route_id == MaterialTransfer.process_route_id,
            following.c.serial_no == serial,
            following.c.step_index > MaterialTransfer.process_step_index,
        )
        .correlate(MaterialTransfer)
        .scalar_subquery()
    )
    index = case(
        (MaterialTransfer.process_step_complete.is_(True), next_step),
        else_=MaterialTransfer.process_step_index,
    )
    return (
        select(path.c.route_id)
        .where(
            path.c.route_id == MaterialTransfer.process_route_id,
            path.c.serial_no == serial,
            path.c.step_index == index,
            path.c.team_id == MaterialTransfer.next_team_id,
        )
        .correlate(MaterialTransfer)
        .exists()
    )
