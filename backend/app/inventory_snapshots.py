"""Share only overlapping reads; never retain a completed inventory response."""

import asyncio
from collections.abc import Awaitable, Callable
from time import monotonic

from .observability import measure_database, record

VIEWS = frozenset(("inventory", "factory-live"))


class SnapshotFrames:
    def __init__(self, *, views: frozenset[str] | None = VIEWS, capacity: int = 2) -> None:
        self._views = views
        self._capacity = capacity
        self._building: dict[tuple, asyncio.Task] = {}

    async def get(
        self,
        view: str | tuple[str, int, str],
        revision: Callable[[], tuple[int, str]],
        build: Callable[[], Awaitable[str]],
    ) -> str:
        if self._views is not None and view not in self._views:
            raise ValueError("Unknown inventory snapshot view")
        key = (asyncio.get_running_loop(), view, revision())
        task = self._building.get(key)
        if task is None:

            async def compute():
                started = monotonic()
                with measure_database() as timing:
                    frame = await build()
                record(
                    "inventory.snapshot.built",
                    view=view if isinstance(view, str) else view[0],
                    duration_ms=round((monotonic() - started) * 1000, 2),
                    revision=key[2][0],
                    **timing.fields(),
                )
                return frame

            if len(self._building) >= self._capacity:
                return await compute()
            task = asyncio.create_task(compute(), name="inventory-frame")
            self._building[key] = task

            def finished(result):
                self._building.pop(key, None)
                if not result.cancelled():
                    result.exception()  # Retrieve errors even if every waiter disconnected.

            task.add_done_callback(finished)
        return await asyncio.shield(task)

    async def close(self):
        tasks = [
            task for key, task in self._building.items() if key[0] is asyncio.get_running_loop()
        ]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
