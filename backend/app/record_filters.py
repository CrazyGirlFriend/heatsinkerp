"""Calendar filters use factory-local dates and index-friendly UTC ranges."""
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo
from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from .config import settings
from .models import SerialUrgency


def day_bounds(day: date):
    zone = ZoneInfo(settings.factory_timezone)
    return tuple(datetime.combine(d, time.min, zone).astimezone(timezone.utc).replace(tzinfo=None)
                 for d in (day, day + timedelta(days=1)))


def urgent_serials():
    return select(SerialUrgency.serial_no).where(SerialUrgency.urgent.is_(True))


class RecordFilters(BaseModel):
    date_from: date | None = None
    date_to: date | None = None
    urgent_only: bool = False

    def dates(self, column):
        if self.date_from and self.date_to and self.date_from > self.date_to:
            raise HTTPException(422, "开始日期不能晚于结束日期")
        return ([column >= day_bounds(self.date_from)[0]] if self.date_from else []) + (
            [column < day_bounds(self.date_to)[1]] if self.date_to else [])

    def predicates(self, column, serial):
        return self.dates(column) + ([serial.in_(urgent_serials())] if self.urgent_only else [])
