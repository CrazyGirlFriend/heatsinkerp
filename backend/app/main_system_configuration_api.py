"""Authenticated HTTP boundary for encrypted integration settings."""

from fastapi import Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from . import main_system_configuration as configuration
from .async_api import AsyncAPIRouter
from .auth import require_admin
from .database import get_db
from .main_system_schemas import (
    ConfigurationSave,
    ConfigurationTest,
    ConfigurationTestResponse,
    MainSystemConfigurationResponse,
)
from .models import User

router = AsyncAPIRouter(
    prefix="/api/main-system/configuration",
    tags=["main system configuration"],
    dependencies=[Depends(require_admin)],
)


@router.get("", response_model=MainSystemConfigurationResponse)
def get_configuration(response: Response, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    return configuration.get_configuration(db)


@router.put("", response_model=MainSystemConfigurationResponse)
def save_configuration(
    payload: ConfigurationSave,
    response: Response,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    response.headers["Cache-Control"] = "no-store"
    return configuration.save_configuration(payload, user, db)


@router.post("/test", response_model=ConfigurationTestResponse)
async def test_configuration(
    payload: ConfigurationTest, response: Response, db: AsyncSession = Depends(get_db)
):
    response.headers["Cache-Control"] = "no-store"
    return await configuration.test_configuration(payload, db)
