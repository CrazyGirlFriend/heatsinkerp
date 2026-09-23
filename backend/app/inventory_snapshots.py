"""Bounded, single-flight SSE frames; authentication is never cached here."""

from collections.abc import Callable
from threading import Condition
from time import monotonic

from .observability import record

# Expiry is checked only on demand, not by a polling task. Commit revisions
# invalidate immediately; the age bound also keeps new viewers' time windows fresh.
MAX_AGE_SECONDS = 2.0
VIEWS = frozenset(("inventory", "factory-live"))


class SnapshotFrames:
    def __init__(self) -> None:
        self._condition = Condition()
        self._frames: dict[str, tuple[tuple[int, str], float, str]] = {}
        self._building: set[str] = set()

    def get(
        self,
        view: str,
        revision: Callable[[], tuple[int, str]],
        build: Callable[[], str],
    ) -> str:
        if view not in VIEWS:
            raise ValueError("Unknown inventory snapshot view")
        while True:
            with self._condition:
                version = revision()
                cached = self._frames.get(view)
                if cached and cached[0] == version and monotonic() - cached[1] < MAX_AGE_SECONDS:
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
                record(
                    "inventory.snapshot.built",
                    view=view,
                    duration_ms=round((monotonic() - started) * 1000, 2),
                )
                return frame
            finally:
                with self._condition:
                    self._building.discard(view)
                    self._condition.notify_all()
