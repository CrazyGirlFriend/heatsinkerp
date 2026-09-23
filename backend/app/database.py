from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import NullPool, StaticPool

from .config import settings
from .observability import instrument_database


class Base(DeclarativeBase):
    pass


def _engine_options(database_url: str) -> dict:
    options: dict = {"pool_pre_ping": True}
    if database_url.startswith("sqlite"):
        options["connect_args"] = {"check_same_thread": False}
        if database_url in {"sqlite://", "sqlite:///:memory:"}:
            options["poolclass"] = StaticPool
    else:
        options.update({"pool_recycle": 1800, "pool_size": 10, "max_overflow": 20})
    return options


engine = create_engine(settings.database_url, **_engine_options(settings.database_url))
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def _async_options():
    url = make_url(settings.database_url)
    if url.get_backend_name() == "mysql":
        return url.set(drivername="mysql+asyncmy"), _engine_options(settings.database_url)
    if url.get_backend_name() == "sqlite":
        if url.database in (None, "", ":memory:"):
            raise ValueError("Use a SQLite file: async HTTP and maintenance connections must share one database")
        options = _engine_options(settings.database_url)
        options["poolclass"] = NullPool
        return url.set(drivername="sqlite+aiosqlite"), options
    raise ValueError("Unsupported async database backend")


_async_url, _async_engine_options = _async_options()
async_engine = create_async_engine(_async_url, **_async_engine_options)
instrument_database(engine)
instrument_database(async_engine.sync_engine)
AsyncSessionLocal = async_sessionmaker(async_engine, autoflush=False, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as db:
        yield db
