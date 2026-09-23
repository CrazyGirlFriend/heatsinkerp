"""Async HTTP boundary for the existing transactional ORM services.

run_sync uses SQLAlchemy's greenlet bridge, not a blocking MySQL connection or
a worker thread. Every SQL operation awaits asyncmy through its AsyncSession.
CPU-heavy work and non-SQL blocking I/O must be awaited outside this boundary.
Keeping transaction services intact preserves their row-lock order and retries.
"""

from functools import wraps
from inspect import iscoroutinefunction, signature

from fastapi import APIRouter
from fastapi.routing import APIRoute
from sqlalchemy.ext.asyncio import AsyncSession


class AsyncDatabaseRoute(APIRoute):
    def __init__(self, path, endpoint, **kwargs):
        if not iscoroutinefunction(endpoint):
            operation = endpoint

            @wraps(operation)
            async def endpoint(**values):
                db = values.get("db")
                if db is not None:
                    if not isinstance(db, AsyncSession):
                        raise TypeError("HTTP database dependency must be an AsyncSession")
                    return await db.run_sync(lambda session: operation(**{**values, "db": session}))
                return operation(**values)

            endpoint.__signature__ = signature(operation, eval_str=True)
        super().__init__(path, endpoint=endpoint, **kwargs)


class AsyncAPIRouter(APIRouter):
    def __init__(self, **kwargs):
        super().__init__(route_class=AsyncDatabaseRoute, **kwargs)
