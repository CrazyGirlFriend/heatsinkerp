"""Concurrency-safe allocation of the shared TL Code 128 business number."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from .config import settings
from .models import TransferBatchNumberSequence, utcnow


def next_transfer_batch_number(db) -> str:
    """Allocate a TL number, retaining the historical counter to prevent reuse."""
    return next_transfer_batch_numbers(db, 1)[0]


def next_transfer_batch_numbers(db, count: int) -> list[str]:
    """Reserve one contiguous range in the caller's stock transaction."""
    if count < 1:
        raise ValueError("batch number count must be positive")
    today = datetime.now(ZoneInfo(settings.factory_timezone)).date()
    now = utcnow()
    dialect = db.get_bind().dialect.name
    values = {"sequence_date": today, "last_value": count, "updated_at": now}
    if dialect == "mysql":
        statement = mysql_insert(TransferBatchNumberSequence).values(**values)
        statement = statement.on_duplicate_key_update(
            last_value=TransferBatchNumberSequence.last_value + count,
            updated_at=now,
        )
        db.execute(statement)
    elif dialect == "sqlite":
        statement = sqlite_insert(TransferBatchNumberSequence).values(**values)
        statement = statement.on_conflict_do_update(
            index_elements=[TransferBatchNumberSequence.sequence_date],
            set_={
                "last_value": TransferBatchNumberSequence.last_value + count,
                "updated_at": now,
            },
        )
        db.execute(statement)
    else:
        row = db.scalar(
            select(TransferBatchNumberSequence)
            .where(TransferBatchNumberSequence.sequence_date == today)
            .with_for_update()
        )
        if row is None:
            row = TransferBatchNumberSequence(sequence_date=today, last_value=count)
            db.add(row)
        else:
            row.last_value += count
        db.flush()
    value = db.scalar(
        select(TransferBatchNumberSequence.last_value)
        .where(TransferBatchNumberSequence.sequence_date == today)
        .with_for_update()
    )
    if value is None or value > 999999:
        raise HTTPException(409, "daily transfer-batch number range is exhausted")
    return [f"TL{today:%Y%m%d}{number:06d}" for number in range(value - count + 1, value + 1)]
