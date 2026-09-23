"""Bulk TL allocation retains independent numbers, exhaustion and rollback."""

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.batch_numbers import next_transfer_batch_number, next_transfer_batch_numbers
from app.database import SessionLocal
from app.models import TransferBatchNumberSequence


def test_bulk_numbers_share_counter_with_single_allocations(client):
    with SessionLocal.begin() as db:
        numbers = next_transfer_batch_numbers(db, 3)
        single = next_transfer_batch_number(db)
        following = next_transfer_batch_numbers(db, 2)
        assert len(set(numbers + [single] + following)) == 6
        assert [number[-6:] for number in numbers + [single] + following] == [
            f"{value:06d}" for value in range(1, 7)
        ]
    with SessionLocal() as db:
        assert db.scalar(select(TransferBatchNumberSequence.last_value)) == 6


def test_exhausted_range_rolls_back_without_losing_last_available_number(client):
    with SessionLocal.begin() as db:
        next_transfer_batch_number(db)
        db.scalar(select(TransferBatchNumberSequence)).last_value = 999998
    with pytest.raises(HTTPException) as error, SessionLocal.begin() as db:
        next_transfer_batch_numbers(db, 2)
    assert error.value.status_code == 409
    with SessionLocal.begin() as db:
        assert db.scalar(select(TransferBatchNumberSequence.last_value)) == 999998
        assert next_transfer_batch_number(db).endswith("999999")
    with pytest.raises(HTTPException), SessionLocal.begin() as db:
        next_transfer_batch_number(db)


@pytest.mark.parametrize("count", [0, -1])
def test_empty_range_is_rejected_without_touching_counter(client, count):
    with SessionLocal.begin() as db:
        with pytest.raises(ValueError):
            next_transfer_batch_numbers(db, count)
        assert db.scalar(select(TransferBatchNumberSequence)) is None
