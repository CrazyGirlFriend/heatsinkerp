"""Team-owned purpose vocabulary; never a route or a production operation."""
from fastapi import Depends, HTTPException, Path
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import actor_name, get_current_user, require_admin
from .database import get_db
from .models import Team, TeamPurpose, TeamSettingEvent, OpeningStockSubmission, MaterialTransfer, User, utcnow
from .material_stock import require_actor, require_team

from .async_api import AsyncAPIRouter as APIRouter

router = APIRouter(prefix="/api/team-materials", tags=["team business settings"])


class PurposeInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=80)
    active: bool = True
    expected_version: int | None = Field(default=None, ge=1)

    @field_validator("name")
    @classmethod
    def trim(cls, value):
        if not value.strip():
            raise ValueError("业务名称不能为空")
        return value.strip()


def purpose_dict(row):
    return {"id": row.id, "team_id": row.team_id, "name": row.name, "active": row.active, "version": row.version}


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
        if required and db.scalar(select(TeamPurpose.id).where(TeamPurpose.team_id == team_id).limit(1)) is not None:
            raise HTTPException(422, "请选择下序班组的承接业务；无可用选项时请联系该班组长")
        return {"purpose_id": None, "purpose_name": None}
    row = db.scalar(select(TeamPurpose).where(TeamPurpose.id == purpose_id).with_for_update().execution_options(populate_existing=True))
    if row is None or row.team_id != team_id or not row.active:
        raise HTTPException(422, "承接业务须属于接收班组且处于启用状态")
    return {"purpose_id": row.id, "purpose_name": row.name}


@router.get("/{team_id}/purposes")
def list_purposes(team_id: int = Path(ge=1), _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_team(db, team_id)
    return [purpose_dict(row) for row in db.scalars(select(TeamPurpose).where(TeamPurpose.team_id == team_id).order_by(TeamPurpose.id))]


def save_purpose(db, team_id, user, payload, purpose_id=None):
    require_actor(user, team_id)
    try:
        with db.begin():
            team = db.scalar(select(Team).where(Team.id == team_id).with_for_update().execution_options(populate_existing=True))
            if not team.active:
                raise HTTPException(403, "班组已停用")
            row = None if purpose_id is None else db.scalar(select(TeamPurpose).where(TeamPurpose.id == purpose_id).with_for_update())
            if purpose_id is not None and (row is None or row.team_id != team_id):
                raise HTTPException(404, "未找到本班组业务")
            before = purpose_dict(row) if row else None
            if row and payload.expected_version != row.version:
                raise HTTPException(409, "业务配置已变化，请刷新后重试")
            if row is None:
                row = TeamPurpose(team_id=team_id, name=payload.name, active=payload.active)
                db.add(row)
            else:
                row.name, row.active = payload.name, payload.active
                row.version += 1
                row.updated_at = utcnow()
            db.flush()
            result = purpose_dict(row)
            db.add(TeamSettingEvent(team_id=team_id, action="purpose_changed", actor=actor_name(user), changes={"before": before, "after": result}))
        return result
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "本班组已存在同名业务") from exc


@router.post("/{team_id}/purposes", status_code=201)
def create_purpose(payload: PurposeInput, team_id: int = Path(ge=1), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return save_purpose(db, team_id, user, payload)


@router.patch("/{team_id}/purposes/{purpose_id}")
def update_purpose(payload: PurposeInput, team_id: int = Path(ge=1), purpose_id: int = Path(ge=1), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return save_purpose(db, team_id, user, payload, purpose_id)


class OpeningAuthorization(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool


@router.put("/{team_id}/opening-stock/authorization")
def authorize_opening(payload: OpeningAuthorization, team_id: int = Path(ge=1), user: User = Depends(require_admin), db: Session = Depends(get_db)):
    with db.begin():
        team = db.scalar(select(Team).where(Team.id == team_id).with_for_update().execution_options(populate_existing=True))
        if team is None:
            raise HTTPException(404, "未找到班组")
        if payload.enabled and (not team.active or db.scalar(select(OpeningStockSubmission.id).where(OpeningStockSubmission.team_id == team_id))):
            raise HTTPException(409, "班组已完成期初入账或已停用，不能再次开启")
        if payload.enabled and db.scalar(select(MaterialTransfer.id).where(MaterialTransfer.next_team_id == team_id,
            MaterialTransfer.status == "received", MaterialTransfer.stock_tracked.is_(True)).limit(1)) is not None:
            raise HTTPException(409, "班组已有入账记录，不能将当前库存再次作为期初库存叠加")
        before = team.opening_stock_enabled
        team.opening_stock_enabled = payload.enabled
        if before != payload.enabled:
            db.add(TeamSettingEvent(team_id=team_id, action="opening_authorized", actor=actor_name(user), changes={"before": before, "after": payload.enabled}))
    return {"enabled": payload.enabled}
