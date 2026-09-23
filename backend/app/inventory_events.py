"""Commit-driven notifications for the single-worker inventory stream.

Only committed ORM changes wake subscribers. Each subscriber has one event,
so bursts coalesce instead of accumulating an unbounded notification queue.
"""
import asyncio
from contextlib import contextmanager
from dataclasses import dataclass
from threading import Lock

from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

from .models import AuthSession, MaterialDispatch, MaterialLoss, MaterialTransfer, SerialUrgency, Team, User, TeamPurpose, OpeningStockSubmission


@dataclass(frozen=True)
class InventoryChange:
    # None invalidates all teams; an empty set means no inventory change.
    team_ids: frozenset[int] | None = frozenset()
    directory: bool = False
    accounts: bool = False
    user_ids: frozenset[int] = frozenset()
    sessions: frozenset[str] = frozenset()

    @property
    def inventory(self):
        return self.team_ids is None or bool(self.team_ids)

    def merge(self, other):
        return InventoryChange(
            None if self.team_ids is None or other.team_ids is None else self.team_ids | other.team_ids,
            self.directory or other.directory, self.accounts or other.accounts,
            self.user_ids | other.user_ids, self.sessions | other.sessions,
        )

    def payload(self, user_id):
        return {"changed": True, "team_ids": None if self.team_ids is None else sorted(self.team_ids),
                "directory_changed": self.directory, "accounts_changed": self.accounts,
                "current_user_changed": user_id in self.user_ids}


class ChangeSignal(asyncio.Event):
    def __init__(self):
        super().__init__()
        self.pending = InventoryChange()

    def add(self, change):
        self.pending = self.pending.merge(change)
        self.set()

    def clear(self):
        self.pending = InventoryChange()
        super().clear()

    def take(self):
        change = self.pending
        self.clear()
        return change


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
        subscriber = (asyncio.get_running_loop(), ChangeSignal())
        with self._lock:
            self._subscribers.add(subscriber)
        try:
            yield subscriber[1]
        finally:
            with self._lock:
                self._subscribers.discard(subscriber)

    def publish(self, change=None):
        change = change if change is not None else InventoryChange(team_ids=None)
        with self._lock:
            if change.inventory:
                self._revision += 1
            subscribers = tuple(self._subscribers)
        for loop, changed in subscribers:
            try:
                loop.call_soon_threadsafe(changed.add, change)
            except RuntimeError:
                # A disconnected client's event loop must not fail a committed write.
                pass


inventory_events = InventoryEvents()
WATCHED = (MaterialTransfer, MaterialLoss, MaterialDispatch, SerialUrgency, Team, User, AuthSession, TeamPurpose, OpeningStockSubmission)
PENDING = "inventory_changed_transactions"


def affected_teams(row):
    state = inspect(row)
    result = set()
    for name in ("source_team_id", "next_team_id", "team_id"):
        if name not in state.attrs:
            continue
        history = state.attrs[name].history
        if state.persistent and history.added and not history.deleted:
            return None  # An unloaded old assignment cannot be safely scoped.
        result.update(value for value in (*history.deleted, getattr(row, name)) if value is not None)
        relation = name.removesuffix("_id")
        if relation in state.attrs:
            history = state.attrs[relation].history
            if state.persistent and history.added and not history.deleted:
                return None
            result.update(team.id for team in (*history.added, *history.deleted) if team is not None and team.id is not None)
    return frozenset(result) if result else None


def change_for(row, db):
    if isinstance(row, AuthSession):
        # A new login affects no existing connection. Revocations still wake the
        # matching connection immediately, without invalidating stock snapshots.
        if row in db.new:
            return InventoryChange()
        return InventoryChange(sessions=frozenset((row.token_hash,)))
    if isinstance(row, User):
        return InventoryChange(accounts=True, user_ids=frozenset((row.id,)) if row.id is not None else frozenset())
    if isinstance(row, Team):
        return InventoryChange(team_ids=None, directory=True)
    if isinstance(row, SerialUrgency):
        # The serial may exist in several teams; refresh all affected views.
        return InventoryChange(team_ids=None)
    return InventoryChange(team_ids=affected_teams(row), directory=isinstance(row, TeamPurpose))


@event.listens_for(Session, "before_flush")
def remember_inventory_change(db, *_):
    change = InventoryChange()
    for row in db.new | db.deleted | db.dirty:
        if isinstance(row, WATCHED) and (row in db.new or row in db.deleted or db.is_modified(row, include_collections=False)):
            change = change.merge(change_for(row, db))
    if change != InventoryChange():
        transaction = db.get_nested_transaction() or db.get_transaction()
        pending = db.info.setdefault(PENDING, {})
        pending[transaction] = pending.get(transaction, InventoryChange()).merge(change)


@event.listens_for(Session, "after_commit")
def publish_inventory_change(db):
    pending = db.info.get(PENDING, {})
    nested = db.get_nested_transaction()
    if nested is not None:
        if nested in pending:
            change = pending.pop(nested)
            pending[nested.parent] = pending.get(nested.parent, InventoryChange()).merge(change)
        return
    if db.info.pop(PENDING, None):
        change = InventoryChange()
        for value in pending.values():
            change = change.merge(value)
        inventory_events.publish(change)


@event.listens_for(Session, "after_soft_rollback")
def discard_inventory_change(db, transaction):
    pending = db.info.get(PENDING, {})
    pending.pop(transaction, None)
    if transaction.parent is None:
        db.info.pop(PENDING, None)
