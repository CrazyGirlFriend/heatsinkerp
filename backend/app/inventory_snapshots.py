"""Bounded, single-flight serialized reads; authentication is never cached here."""

from collections import OrderedDict
from collections.abc import Callable
from threading import Condition
from time import monotonic

from .observability import record

# Expiry is checked only on demand, not by a polling task. Commit revisions
# invalidate immediately; the age bound also keeps new viewers' time windows fresh.
MAX_AGE_SECONDS = 2.0
VIEWS = frozenset(("inventory", "factory-live"))


class SnapshotFrames:
    def __init__(self, *, views: frozenset[str] | None = VIEWS, capacity: int = 2) -> None:
        self._condition = Condition()
        self._views = views
        self._capacity = capacity
        self._frames: OrderedDict[
            str | tuple[str, int, str], tuple[tuple[int, str], float, str]
        ] = OrderedDict()
        self._building: set[str | tuple[str, int, str]] = set()

    def get(
        self,
        view: str | tuple[str, int, str],
        revision: Callable[[], tuple[int, str]],
        build: Callable[[], str],
    ) -> str:
        if self._views is not None and view not in self._views:
            raise ValueError("Unknown inventory snapshot view")
        while True:
            with self._condition:
                version = revision()
                cached = self._frames.get(view)
                if cached and cached[0] == version and monotonic() - cached[1] < MAX_AGE_SECONDS:
                    self._frames.move_to_end(view)
                    return cached[2]
                if view in self._building:
                    self._condition.wait()
                    continue
                self._building.add(view)
            started = monotonic()
            try:
                # No database session or frame computation under the condition lock.
                frame = build()
                with self._condition:
                    if revision() == version:
                        self._frames[view] = (version, monotonic(), frame)
                        self._frames.move_to_end(view)
                        while len(self._frames) > self._capacity:
                            self._frames.popitem(last=False)
                record(
                    "inventory.snapshot.built",
                    # Team keys contain search criteria; never put them in logs.
                    view=view if isinstance(view, str) else view[0],
                    duration_ms=round((monotonic() - started) * 1000, 2),
                )
                return frame
            finally:
                with self._condition:
                    self._building.discard(view)
                    self._condition.notify_all()
