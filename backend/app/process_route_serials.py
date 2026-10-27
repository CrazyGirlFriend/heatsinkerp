"""Reserve primary normal-route serials across new records and revision families."""

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from .models import ProcessRoute, ProcessRouteSerial


def serial_conflict(serial, *, legacy=False):
    message = (
        f"流水号“{serial}”存在历史重复，请先核对原工艺"
        if legacy
        else f"流水号“{serial}”已有正常工艺，请打开原工艺修改"
    )
    return HTTPException(409, {"code": "duplicate_process_route_serial", "message": message})


def reserve_serial(db, route):
    if route.route_kind == "rework" or not route.serial_nos:
        return
    serial = route.serial_nos[0].strip()
    key = serial.casefold()
    if not key:
        return
    root = route
    while root.parent_id:
        root = db.get(ProcessRoute, root.parent_id)
    existing = db.get(ProcessRouteSerial, key)
    if existing is not None:
        if existing.route_id == root.id:
            return
        raise serial_conflict(serial, legacy=existing.route_id is None)
    try:
        # The primary key also rejects two simultaneous new registrations.
        with db.begin_nested():
            db.add(ProcessRouteSerial(serial_no=key, route_id=root.id))
            db.flush()
    except IntegrityError:
        raise serial_conflict(serial) from None
