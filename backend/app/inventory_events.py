"""Commit-driven notifications for the single-worker inventory stream.

Only committed ORM changes wake subscribers. Each subscriber has one event,
so bursts coalesce instead of accumulating an unbounded notification queue.
"""
import asyncio
from contextlib import contextmanager
from threading import Lock

from sqlalchemy import event
from sqlalchemy.orm import Session

from .models import AuthSession, MaterialDispatch, MaterialLoss, MaterialTransfer, SerialUrgency, Team, User, TeamPurpose, OpeningStockSubmission


class InventoryEvents:
    def __init__(self):
        self._lock = Lock()
        self._subscribers = set()
        self._revision = 0

    @property
    def revision(self):
        with self._lock:
            return self._revision

    @contextmanager
    def subscribe(self):
        subscriber = (asyncio.get_running_loop(), asyncio.Event())
        with self._lock:
            self._subscribers.add(subscriber)
        try:
            yield subscriber[1]
        finally:
            with self._lock:
                self._subscribers.discard(subscriber)

    def publish(self):
        with self._lock:
            self._revision += 1
            subscribers = tuple(self._subscribers)
        for loop, changed in subscribers:
            try:
                loop.call_soon_threadsafe(changed.set)
            except RuntimeError:
                # A disconnected client's event loop must not fail a committed write.
                pass


inventory_events = InventoryEvents()
WATCHED = (MaterialTransfer, MaterialLoss, MaterialDispatch, SerialUrgency, Team, User, AuthSession, TeamPurpose, OpeningStockSubmission)
PENDING = "inventory_changed_transactions"


@event.listens_for(Session, "before_flush")
def remember_inventory_change(db, *_):
    if any(isinstance(row, WATCHED) for row in db.new | db.deleted) or any(
        isinstance(row, WATCHED) and db.is_modified(row, include_collections=False) for row in db.dirty
    ):
        transaction = db.get_nested_transaction() or db.get_transaction()
        db.info.setdefault(PENDING, set()).add(transaction)


@event.listens_for(Session, "after_commit")
def publish_inventory_change(db):
    pending = db.info.get(PENDING, set())
    nested = db.get_nested_transaction()
    if nested is not None:
        if nested in pending:
            pending.discard(nested)
            pending.add(nested.parent)
        return
    if db.info.pop(PENDING, None):
        inventory_events.publish()


@event.listens_for(Session, "after_soft_rollback")
def discard_inventory_change(db, transaction):
    pending = db.info.get(PENDING, set())
    pending.discard(transaction)
    if transaction.parent is None:
        db.info.pop(PENDING, None)
