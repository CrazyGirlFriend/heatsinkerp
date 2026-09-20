from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import models  # noqa: F401
from .access_gate import SiteAccessGate, SiteAccessMiddleware, create_access_router
from .api import public_router, router
from .auth import ensure_initial_admin
from .config import settings
from .database import Base, SessionLocal, engine
from .observability import RequestLogMiddleware


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.auto_create_tables:
        Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        ensure_initial_admin(db)
    yield


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    lifespan=lifespan,
)


@app.exception_handler(RequestValidationError)
async def safe_configuration_validation(request, exc):
    if request.url.path.startswith("/api/main-system/configuration"):
        # Pydantic normally echoes invalid input, which could contain a token.
        return JSONResponse(
            status_code=422,
            content={
                "detail": [
                    {key: error[key] for key in ("loc", "msg", "type") if key in error}
                    for error in exc.errors()
                ]
            },
        )
    return await request_validation_exception_handler(request, exc)


site_access_gate = SiteAccessGate(settings)
app.state.site_access_gate = site_access_gate
app.add_middleware(SiteAccessMiddleware, gate=site_access_gate)
app.add_middleware(RequestLogMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)


app.include_router(create_access_router(site_access_gate))
app.include_router(public_router)
app.include_router(router)


@app.get("/health", include_in_schema=False)
def root_health() -> dict[str, str]:
    return {"status": "ok"}
