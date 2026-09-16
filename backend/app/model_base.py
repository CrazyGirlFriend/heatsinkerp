"""Schema primitives shared by current and historical table definitions."""
from datetime import datetime, timezone
from sqlalchemy import String

WORK_ORDER_NUMBER_TYPE = String(64).with_variant(String(64, collation="utf8mb4_0900_as_cs"), "mysql")
TRANSFER_BATCH_NUMBER_TYPE = String(32).with_variant(String(32, collation="utf8mb4_0900_as_cs"), "mysql")


def utcnow() -> datetime:
    """Return UTC as a naive value, portable across MySQL and SQLite."""
    return datetime.now(timezone.utc).replace(tzinfo=None)
