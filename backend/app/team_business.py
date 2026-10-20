"""Team-owned purpose vocabulary; never a route or a production operation."""

from fastapi import Depends, HTTPException, Path
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .async_api import AsyncAPIRouter as APIRouter
from .auth import actor_name, get_current_user, require_admin
from .database import get_db
from .material_stock import require_actor, require_team
from .models import (
    InspectionProblemType,
    Team,
    TeamEmployee,
    TeamProcessingTask,
    TeamPurpose,
    TeamSettingEvent,
    User,
    utcnow,
)
from .team_constants import INSPECTION_TEAM_CODE, PROCESSING_TEAM_CODES

router = APIRouter(prefix="/api/team-materials", tags=["team business settings"])


class DirectoryItemInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=80)
    active: bool = True
    expected_version: int | None = Field(default=None, ge=1)

    @field_validator("name")
    @classmethod
    def trim(cls, value):
        if not value.strip():
            raise ValueError("名称不能为空")
        return value.strip()


def directory_item_dict(row):
    return {
        "id": row.id,
        "team_id": row.team_id,
        "name": row.name,
        "active": row.active,
        "version": row.version,
    }


def purpose_snapshot(db, team_id, purpose_id, *, required=True):
    """Call with target Team locked; configuration writes take that same lock."""
    if team_id is None:
        if purpose_id is not None:
            raise HTTPException(422, "对外出库不能指定下序班组业务")
        return {"purpose_id": None, "purpose_name": None}
    if purpose_id is None:
        # Unconfigured teams and historical clients remain usable. Once a team
        # configures its vocabulary, new handoffs cannot bypass it (even if all
        # options have subsequently been disabled).
        if (
            required
            and db.scalar(select(TeamPurpose.id).where(TeamPurpose.team_id == team_id).limit(1))
            is not None
        ):
            raise HTTPException(422, "请选择下序班组的接收业务；无可用选项时请联系该班组长")
        return {"purpose_id": None, "purpose_name": None}
    row = db.scalar(
        select(TeamPurpose)
        .where(TeamPurpose.id == purpose_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if row is None or row.team_id != team_id or not row.active:
        raise HTTPException(422, "接收业务须属于接收班组且处于启用状态")
    return {"purpose_id": row.id, "purpose_name": row.name}


@router.get("/{team_id}/purposes")
def list_purposes(
    team_id: int = Path(ge=1), _: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    require_team(db, team_id)
    return [
        directory_item_dict(row)
        for row in db.scalars(
            select(TeamPurpose).where(TeamPurpose.team_id == team_id).order_by(TeamPurpose.id)
        )
    ]


def save_directory_item(
    db,
    team_id,
    user,
    payload,
    item_id=None,
    *,
    employee=False,
    processing_task=False,
    inspection_problem=False,
):
    model, label, action = (
        (TeamEmployee, "员工", "employee_changed")
        if employee
        else (TeamPurpose, "业务", "purpose_changed")
    )
    if processing_task:
        model, label, action = TeamProcessingTask, "加工任务", "processing_task_changed"
    if inspection_problem:
        if user.role != "TEAM" or not user.team or user.team.code != INSPECTION_TEAM_CODE:
            raise HTTPException(403, "仅检验班组长可以维护检验问题")
        require_actor(user, team_id)
        model, label, action = InspectionProblemType, "检验问题", "inspection_problem_changed"
    if user.role != "ADMIN":
        require_actor(user, team_id)
    try:
        with db.begin():
            team = db.scalar(
                select(Team)
                .where(Team.id == team_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if team is None:
                raise HTTPException(404, "未找到班组")
            if not team.active:
                raise HTTPException(403, "班组已停用")
            if processing_task and (
                team.code not in PROCESSING_TEAM_CODES or team.kind != "production"
            ):
                raise HTTPException(422, "库房不登记加工，请选择生产班组")
            row = (
                None
                if item_id is None
                else db.scalar(select(model).where(model.id == item_id).with_for_update())
            )
            if item_id is not None and (row is None or row.team_id != team_id):
                raise HTTPException(404, f"未找到本班组{label}")
            before = directory_item_dict(row) if row else None
            if row and payload.expected_version != row.version:
                raise HTTPException(409, f"{label}配置已变化，请刷新后重试")
            if row is None:
                row = model(team_id=team_id, name=payload.name, active=payload.active)
                db.add(row)
            else:
                row.name, row.active = payload.name, payload.active
                row.version += 1
                row.updated_at = utcnow()
            db.flush()
            result = directory_item_dict(row)
            db.add(
                TeamSettingEvent(
                    team_id=team_id,
                    action=action,
                    actor=actor_name(user),
                    changes={"before": before, "after": result},
                )
            )
        return result
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, f"本班组已存在同名{label}") from exc


@router.post("/{team_id}/purposes", status_code=201)
def create_purpose(
    payload: DirectoryItemInput,
    team_id: int = Path(ge=1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return save_directory_item(db, team_id, user, payload)


@router.patch("/{team_id}/purposes/{purpose_id}")
def update_purpose(
    payload: DirectoryItemInput,
    team_id: int = Path(ge=1),
    purpose_id: int = Path(ge=1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return save_directory_item(db, team_id, user, payload, purpose_id)


@router.get("/{team_id}/employees")
def list_employees(
    team_id: int = Path(ge=1), user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    if user.role != "ADMIN":
        require_actor(user, team_id)
    require_team(db, team_id)
    return [
        directory_item_dict(row)
        for row in db.scalars(
            select(TeamEmployee).where(TeamEmployee.team_id == team_id).order_by(TeamEmployee.id)
        )
    ]


@router.post("/{team_id}/employees", status_code=201)
def create_employee(
    payload: DirectoryItemInput,
    team_id: int = Path(ge=1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return save_directory_item(db, team_id, user, payload, employee=True)


@router.patch("/{team_id}/employees/{employee_id}")
def update_employee(
    payload: DirectoryItemInput,
    team_id: int = Path(ge=1),
    employee_id: int = Path(ge=1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return save_directory_item(db, team_id, user, payload, employee_id, employee=True)


class OpeningAuthorization(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool


@router.get("/{team_id}/processing-tasks")
def list_processing_tasks(
    team_id: int = Path(ge=1), user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    if user.role != "ADMIN":
        require_actor(user, team_id)
    require_team(db, team_id)
    return [
        directory_item_dict(row)
        for row in db.scalars(
            select(TeamProcessingTask)
            .where(TeamProcessingTask.team_id == team_id)
            .order_by(TeamProcessingTask.id)
        )
    ]


@router.post("/{team_id}/processing-tasks", status_code=201)
def create_processing_task(
    payload: DirectoryItemInput,
    team_id: int = Path(ge=1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return save_directory_item(db, team_id, user, payload, processing_task=True)


@router.patch("/{team_id}/processing-tasks/{task_id}")
def update_processing_task(
    payload: DirectoryItemInput,
    team_id: int = Path(ge=1),
    task_id: int = Path(ge=1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return save_directory_item(db, team_id, user, payload, task_id, processing_task=True)


@router.get("/{team_id}/inspection-problems")
def list_inspection_problems(
    team_id: int = Path(ge=1), _: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    team = require_team(db, team_id)
    if team.code != INSPECTION_TEAM_CODE:
        raise HTTPException(422, "检验问题由检验班组统一维护")
    return [
        directory_item_dict(row)
        for row in db.scalars(
            select(InspectionProblemType)
            .where(InspectionProblemType.team_id == team_id)
            .order_by(InspectionProblemType.id)
        )
    ]


@router.post("/{team_id}/inspection-problems", status_code=201)
def create_inspection_problem(
    payload: DirectoryItemInput,
    team_id: int = Path(ge=1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return save_directory_item(db, team_id, user, payload, inspection_problem=True)


@router.patch("/{team_id}/inspection-problems/{problem_id}")
def update_inspection_problem(
    payload: DirectoryItemInput,
    team_id: int = Path(ge=1),
    problem_id: int = Path(ge=1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return save_directory_item(db, team_id, user, payload, problem_id, inspection_problem=True)


@router.put("/{team_id}/opening-stock/authorization")
def authorize_opening(
    payload: OpeningAuthorization,
    team_id: int = Path(ge=1),
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    with db.begin():
        team = db.scalar(
            select(Team)
            .where(Team.id == team_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if team is None:
            raise HTTPException(404, "未找到班组")
        if payload.enabled and not team.active:
            raise HTTPException(409, "班组已停用，不能开启库存录入")
        before = team.opening_stock_enabled
        team.opening_stock_enabled = payload.enabled
        if before != payload.enabled:
            db.add(
                TeamSettingEvent(
                    team_id=team_id,
                    action="opening_authorized",
                    actor=actor_name(user),
                    changes={"before": before, "after": payload.enabled},
                )
            )
    return {"enabled": payload.enabled}
