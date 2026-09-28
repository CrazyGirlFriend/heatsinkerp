"""One receiving batch per managed slot, with renewable locks while forms are open."""

from datetime import timedelta, timezone

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from .async_api import AsyncAPIRouter
from .auth import actor_name, get_current_user
from .database import get_db
from .models import (
    AdminAuditEvent,
    Team,
    User,
    WarehouseLocation,
    WarehousePlacement,
    utcnow,
)
from .models import (
    MaterialStockBalance as Balance,
)
from .models import (
    MaterialTransfer as Transfer,
)
from .observability import record
from .team_constants import WAREHOUSE_TEAM_CODE
from .material_stock import StockAmounts

LEASE_SECONDS = 180
DRAFT_SECONDS = 600
router = AsyncAPIRouter(prefix="/api/warehouse-locations", tags=["warehouse management"])


class LocationWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=80)
    active: bool = True
    expected_version: int | None = Field(default=None, ge=1)

    @field_validator("name")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("请填写仓位名称")
        return value.strip()


class LeaseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str = Field(min_length=16, max_length=100, pattern=r"^[A-Za-z0-9_-]+$")


class PlacementWrite(StockAmounts):
    expected_version: int = Field(ge=1)


def place_stock(db, location_id, payload, user):
    from decimal import Decimal
    from .material_stock import lock_lot, _db_conflict

    try:
        with db.begin():
            team = warehouse(db)
            # Same order as dispatch: source lot, then destination slot.
            lot = lock_lot(db, payload.source_transfer_id, team.id)
            location = lock_location(db, location_id)
            if (
                location.team_id != team.id
                or not location.active
                or location.version != payload.expected_version
            ):
                raise HTTPException(409, "仓位已改变，请刷新后重试")
            require_free(db, location)
            if leased(location):
                raise HTTPException(409, "该仓位已被其他表单锁定")
            balance = db.scalar(
                select(Balance)
                .where(Balance.transfer_id == lot.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            allocated = db.execute(
                select(WarehousePlacement.quantity, WarehousePlacement.weight)
                .where(WarehousePlacement.transfer_id == lot.id)
                .with_for_update()
            ).all()
            free_q = (
                balance.on_hand_quantity
                + balance.reserved_quantity
                - balance.in_transit_quantity
                - sum(row.quantity for row in allocated)
            )
            free_w = (
                balance.on_hand_weight
                + balance.reserved_weight
                - balance.in_transit_weight
                - sum((row.weight for row in allocated), Decimal(0))
            )
            if payload.quantity > free_q or payload.weight > free_w:
                raise HTTPException(409, "未分配仓位的库存已变化，请刷新后重试")
            db.add(
                WarehousePlacement(
                    location_id=location.id,
                    transfer_id=lot.id,
                    quantity=payload.quantity,
                    weight=payload.weight,
                )
            )
            location.version += 1
            db.add(
                AdminAuditEvent(
                    actor_user_id=user.id,
                    actor=actor_name(user),
                    target_type="warehouse_slot",
                    target_id=location.id,
                    action="placed",
                    changes={
                        "batch_no": lot.batch_no,
                        "quantity": payload.quantity,
                        "weight": float(payload.weight),
                    },
                )
            )
            db.flush()
            return location_dict(location, occupants(db, [location.id]))
    except (IntegrityError, OperationalError) as exc:
        db.rollback()
        _db_conflict(exc)


def require_manager(user):
    team = user.team
    if user.role == "ADMIN" or (
        user.role == "TEAM"
        and team
        and team.active
        and team.code == WAREHOUSE_TEAM_CODE
        and team.kind == "warehouse"
    ):
        return
    raise HTTPException(403, "仅库房账号和管理员可以管理仓位")


def warehouse(db, team_id=None):
    team = db.scalar(select(Team).where(Team.code == WAREHOUSE_TEAM_CODE))
    if team is None or (team_id is not None and team.id != team_id):
        raise HTTPException(403, "仅库房可以设置仓位")
    return team


def lock_location(db, location_id):
    # A real write serializes claims on SQLite as well as MySQL; keep the lock
    # until the lease/document transaction commits. Never trust a UI-only lock.
    try:
        db.execute(
            update(WarehouseLocation)
            .where(WarehouseLocation.id == location_id)
            .values(updated_at=WarehouseLocation.updated_at)
        )
        location = db.scalar(
            select(WarehouseLocation)
            .where(WarehouseLocation.id == location_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    except OperationalError as exc:
        from .material_stock import _db_conflict

        _db_conflict(exc)
    if location is None:
        raise HTTPException(404, "仓位不存在，请刷新后选择")
    return location


def occupants(db, ids, *, locking=False):
    # Historical document locations are not current physical placement.
    placement = WarehousePlacement
    statement = (
        select(
            WarehouseLocation.id.label("location_id"),
            Transfer.id,
            Transfer.batch_no,
            Transfer.serial_no,
            Transfer.status,
            placement.quantity,
            placement.weight,
            func.coalesce(Balance.on_hand_quantity, 0).label("available_quantity"),
            func.coalesce(Balance.on_hand_weight, 0).label("available_weight"),
        )
        .join(placement, placement.location_id == WarehouseLocation.id)
        .join(Transfer, Transfer.id == placement.transfer_id)
        .outerjoin(Balance, Balance.transfer_id == Transfer.id)
        .where(
            WarehouseLocation.id.in_(ids),
            or_(placement.quantity > 0, placement.weight > 0),
        )
        .order_by(Transfer.id)
    )
    if locking:
        # Current reads avoid a stale MySQL REPEATABLE READ snapshot after a
        # concurrent submit/claim; any deadlock rolls the entire operation back.
        statement = statement.with_for_update()
    return db.execute(statement).mappings().all()


def leased(location):
    return bool(
        location.reservation_key and location.reserved_until and location.reserved_until > utcnow()
    )


def location_dict(location, rows):
    state = (
        ("occupied" if any(row["status"] == "received" for row in rows) else "locked")
        if rows
        else "locked"
        if leased(location)
        else "available"
        if location.active
        else "disabled"
    )
    return {
        "id": location.id,
        "team_id": location.team_id,
        "name": location.name,
        "active": location.active,
        "version": location.version,
        "status": state,
        "draft_locked": leased(location),
        "has_stock": any(row["status"] == "received" for row in rows),
        "batches": [{**row, "weight": float(row["weight"]), "available_weight": float(row["available_weight"])} for row in rows],
    }


def list_locations(
    db, team_id=None, *, query=None, page=1, page_size=100, available_only=False, selected=None
):
    from .material_stock import literal_query

    team = warehouse(db, team_id)
    conditions = [WarehouseLocation.team_id == team.id]
    if available_only:
        busy = (
            select(WarehousePlacement.transfer_id)
            .where(
                WarehousePlacement.location_id == WarehouseLocation.id,
            )
            .exists()
        )
        free = and_(
            WarehouseLocation.active.is_(True),
            ~busy,
            or_(
                WarehouseLocation.reserved_until.is_(None),
                WarehouseLocation.reserved_until <= utcnow(),
            ),
        )
        conditions.append(or_(free, WarehouseLocation.name == selected) if selected else free)
    if query and query.strip():
        conditions.append(literal_query(query, [WarehouseLocation.name]))
    total = db.scalar(select(func.count()).select_from(WarehouseLocation).where(*conditions))
    locations = db.scalars(
        select(WarehouseLocation)
        .where(*conditions)
        .order_by(WarehouseLocation.name)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    rows = occupants(db, [location.id for location in locations]) if locations else []
    return {
        "items": [
            location_dict(location, [r for r in rows if r["location_id"] == location.id])
            for location in locations
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
        "team_id": team.id,
    }


def require_free(db, location):
    try:
        rows = occupants(db, [location.id], locking=True)
    except OperationalError as exc:
        from .material_stock import _db_conflict

        _db_conflict(exc)
    if rows:
        raise HTTPException(409, "该仓位已被其他单据占用，请重新选择空仓位")


def clear_lease(location):
    location.reservation_key = None
    location.reserved_by_user_id = None
    location.reserved_until = None
    location.reserved_deadline = None


def reserve(db, location_id, key, user):
    from .material_stock import _db_conflict
    from .material_transfer_workflow import _require_team_actor

    _require_team_actor(user)
    try:
        with db.begin():
            location = lock_location(db, location_id)
            team = warehouse(db, location.team_id)
            if not team.active or not location.active:
                raise HTTPException(409, "该仓位已停用，请重新选择")
            require_free(db, location)
            same = location.reservation_key == key and location.reserved_by_user_id == user.id
            if leased(location) and not same:
                raise HTTPException(409, "该仓位已被其他表单锁定，请重新选择空仓位")
            now = utcnow()
            if same and location.reserved_deadline and location.reserved_deadline <= now:
                raise HTTPException(409, "仓位已锁定满 10 分钟，请重新选择空仓位")
            if not same or location.reserved_deadline is None:
                location.reserved_deadline = now + timedelta(seconds=DRAFT_SECONDS)
            location.reservation_key, location.reserved_by_user_id = key, user.id
            # Heartbeats recover dropped connections, but cannot extend the
            # ten-minute maximum while a user leaves a form unsubmitted.
            location.reserved_until = min(
                now + timedelta(seconds=LEASE_SECONDS), location.reserved_deadline
            )
            db.flush()
            if not same:
                record("warehouse.location_locked", location_id=location.id, user_id=user.id)
            return {
                "id": location.id,
                "name": location.name,
                "key": key,
                "expires_at": location.reserved_until.replace(tzinfo=timezone.utc).isoformat(),
                "hold_until": location.reserved_deadline.replace(tzinfo=timezone.utc).isoformat(),
            }
    except (IntegrityError, OperationalError) as exc:
        db.rollback()
        _db_conflict(exc)


def release(db, location_id, key, user):
    from .material_stock import _db_conflict

    try:
        with db.begin():
            location = lock_location(db, location_id)
            if location.reservation_key != key:
                return
            if location.reserved_by_user_id != user.id:
                raise HTTPException(403, "不能释放其他人的仓位锁")
            clear_lease(location)
            record("warehouse.location_released", location_id=location.id, user_id=user.id)
    except (IntegrityError, OperationalError) as exc:
        db.rollback()
        _db_conflict(exc)


def consume(db, team, payload, user):
    """Replace a live form lease with a document in the caller's transaction."""
    name = payload.warehouse_location
    key = payload.warehouse_location_reservation_key
    if not name:
        if key:
            raise HTTPException(422, "请选择仓位或清除仓位锁")
        return None
    if team is None or team.code != WAREHOUSE_TEAM_CODE:
        raise HTTPException(422, "仅转入库房时可以选择仓位")
    location_id = db.scalar(
        select(WarehouseLocation.id).where(
            WarehouseLocation.team_id == team.id, WarehouseLocation.name == name
        )
    )
    if location_id is None:
        raise HTTPException(422, "仓位不存在，请从仓库管理中已设置的仓位选择")
    location = lock_location(db, location_id)
    if not location.active or location.name != name:
        raise HTTPException(409, "仓位已改变，请重新选择")
    require_free(db, location)
    if (
        not leased(location)
        or location.reservation_key != key
        or location.reserved_by_user_id != user.id
    ):
        raise HTTPException(409, "仓位选择已失效，请重新选择空仓位后提交")
    clear_lease(location)
    db.flush([location])
    return location.name


def save_location(db, payload, user, location_id=None):
    try:
        with db.begin():
            team = warehouse(db)
            location = (
                lock_location(db, location_id)
                if location_id
                else WarehouseLocation(team_id=team.id)
            )
            before = {}
            if location_id:
                if payload.expected_version != location.version:
                    raise HTTPException(409, "仓位已被修改，请刷新后重试")
                if not payload.active:
                    require_free(db, location)
                if leased(location):
                    raise HTTPException(409, "仓位正在被填写中的单据使用，暂不能修改")
                before = {"name": location.name, "active": location.active}
                location.version += 1
            location.name, location.active = payload.name, payload.active
            db.add(location)
            db.flush()
            db.add(
                AdminAuditEvent(
                    actor_user_id=user.id,
                    actor=actor_name(user),
                    target_type="warehouse_slot",
                    target_id=location.id,
                    action="updated" if location_id else "created",
                    changes={
                        "before": before,
                        "after": {"name": location.name, "active": location.active},
                    },
                )
            )
            record("warehouse.location_saved", location_id=location.id, user_id=user.id)
            return location_dict(location, occupants(db, [location.id]))
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "仓位名称已存在") from exc
    except OperationalError as exc:
        from .material_stock import _db_conflict

        db.rollback()
        _db_conflict(exc)


@router.get("")
def catalog(
    query: str | None = Query(default=None, max_length=80),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_manager(user)
    return list_locations(db, query=query, page=page, page_size=page_size)


@router.post("", status_code=201)
def create(
    payload: LocationWrite, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    require_manager(user)
    return save_location(db, payload, user)


@router.patch("/{location_id}")
def edit(
    location_id: int,
    payload: LocationWrite,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_manager(user)
    return save_location(db, payload, user, location_id)


@router.post("/{location_id}/reservation")
def claim(
    location_id: int,
    payload: LeaseRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return reserve(db, location_id, payload.key, user)


@router.post("/{location_id}/placement")
def assign(
    location_id: int,
    payload: PlacementWrite,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_manager(user)
    return place_stock(db, location_id, payload, user)


@router.delete("/{location_id}/reservation", status_code=204)
def unclaim(
    location_id: int,
    payload: LeaseRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    release(db, location_id, payload.key, user)
