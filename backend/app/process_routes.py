"""Published dispatch routes and physical-lot progress, in stock transactions."""

from fastapi import HTTPException
from sqlalchemy import select

from .models import (
    MaterialTransfer,
    ProcessRoute,
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
    if user.role != "ADMIN" and not is_engineering_user(user):
        raise HTTPException(403, "仅工艺班组或管理员可以维护工艺")
    return user


def require_route_reader(row, user):
    if row.state != "published":
        assert_route_importer(user)
    return row


def require_draft_owner(db, row, user):
    assert_route_importer(user)
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


def publish_route(db, row):
    row.steps = validate_steps(db, row)
    from .rework_routes import activate

    activate(db, row)
    row.state, row.published_at = "published", utcnow()
    db.add_all(
        ProcessRoutePath(
            route_id=row.id, serial_no=serial, step_index=index, team_id=step["team_id"]
        )
        for index, step in enumerate(row.steps)
        for serial in (step["serial_nos"] or ["", *row.serial_nos])
    )


def route_options(db, team_id):
    """Read only the active execution vocabulary required to review an imported route."""
    from .team_business import directory_item_dict

    team = db.get(Team, team_id)
    if not team or not team.active:
        raise HTTPException(404, "执行班组不存在或已停用")
    warehouse = team.code == WAREHOUSE_TEAM_CODE and team.kind == "warehouse"
    production = team.code in PROCESSING_TEAM_CODES and team.kind == "production"
    if not warehouse and not production:
        raise HTTPException(422, "执行班组须为正式生产班组或库房")
    return {
        "tasks": [
            directory_item_dict(row)
            for row in db.scalars(
                select(TeamProcessingTask)
                .where(TeamProcessingTask.team_id == team.id, TeamProcessingTask.active.is_(True))
                .order_by(TeamProcessingTask.id)
            )
        ]
        if production
        else [],
        "purposes": [
            directory_item_dict(row)
            for row in db.scalars(
                select(TeamPurpose)
                .where(TeamPurpose.team_id == team.id, TeamPurpose.active.is_(True))
                .order_by(TeamPurpose.id)
            )
        ],
    }


def route_document(lot):
    if not lot.process_route_id:
        return None
    route = lot.process_route
    step = route.steps[lot.process_step_index]
    following = None
    if lot.process_step_complete:
        try:
            index = next_index(route, lot.process_step_index, lot.serial_no, lot.shared_unallocated)
            following = route.steps[index] if index is not None else None
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
        "split_here": step.get("split_here", False),
        "next_team_id": following["team_id"] if following else None,
        "next_purpose_id": following.get("purpose_id") if following else None,
    }


def next_index(route, index, serial_no, unallocated=False):
    for position in range(index + 1, len(route.steps)):
        members = route.steps[position].get("serial_nos", [])
        if not members or (not unallocated and serial_no in members):
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
    step = lot.process_route.steps[index]
    return {
        **doc,
        **{
            key: step.get(key)
            for key in ("instructions", "processing_task_id", "purpose_id", "split_here")
        },
        "step_name": step["name"],
        "sequence_no": step["sequence_no"],
        "step_index": index,
        "available": True,
    }


def prepare_processing(lot, payload):
    from .rework_routes import active, pending

    if pending(lot):
        raise HTTPException(422, "返工工艺尚未制定，请联系工艺人员")
    if active(lot) and payload.work_kind != "rework":
        raise HTTPException(422, "本批按返工工艺执行，不能登记为正常产量")
    if not lot.process_route_id or (payload.work_kind == "rework" and not active(lot)):
        return payload, None
    index = processing_step(lot)
    step = lot.process_route.steps[index]
    if step["team_id"] != lot.next_team_id:
        raise HTTPException(409, "本批工艺工序与当前班组不一致")
    if (
        payload.processing_task_id is not None
        and payload.processing_task_id != step["processing_task_id"]
    ):
        raise HTTPException(422, "请执行工艺路线指定的具体任务，不能更换工序")
    if payload.purpose_id is not None and payload.purpose_id != step["purpose_id"]:
        raise HTTPException(422, "请执行工艺路线指定的业务")
    if lot.shared_unallocated and payload.outputs:
        allocated = [line for line in payload.outputs if line.role == "produced" and line.serial_no]
        if allocated and not step.get("split_here"):
            raise HTTPException(422, "本工序不是共投料的指定拆分点")
    return payload.model_copy(
        update={"processing_task_id": step["processing_task_id"], "purpose_id": step["purpose_id"]}
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


def finish_processing(lot, payload, index, outputs):
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


def dispatch_fields(db, lot, target, kind, rework_return=False, policy=None):
    if kind in SCRAP_MATERIAL_TYPES:
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
            if not task or not task.active or task.team_id != team.id:
                raise HTTPException(422, f"{step['name']}须对应本班组启用的具体任务")
            if not purpose or not purpose.active or purpose.team_id != team.id:
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
    if (
        not route
        or route.state != "published"
        or index is None
        or index >= len(route.steps)
        or payload.serial_no not in route.serial_nos
    ):
        raise HTTPException(422, "请选择本次派工已发布的工艺工序")
    step = route.steps[index]
    if step["team_id"] != payload.team_id or (
        step["serial_nos"] and payload.serial_no not in step["serial_nos"]
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

    from .models import ProcessRoutePath

    path = ProcessRoutePath.__table__
    following = path.alias("following_route_step")
    serial = case(
        (MaterialTransfer.shared_unallocated.is_(True), ""), else_=MaterialTransfer.serial_no
    )
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
