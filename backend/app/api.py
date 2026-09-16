"""Assemble only the supported phase-one HTTP API."""
from fastapi import APIRouter

from .auth_api import router as public_router
from .admin_api import router as admin_router
from .material_transfer_api import router as material_router
from .material_stock_api import router as stock_router
from .material_dispatch_api import router as dispatch_router
from .material_analytics import router as analytics_router
from .factory_overview import router as factory_router
from .serial_urgency import router as urgency_router
from .factory_stream import router as stream_router
from .main_system_api import router as main_system_router
from .main_system_configuration import router as main_system_configuration_router

router = APIRouter()
router.include_router(admin_router)
router.include_router(material_router)
router.include_router(stock_router)
router.include_router(dispatch_router)
router.include_router(analytics_router)
router.include_router(factory_router)
router.include_router(urgency_router)
router.include_router(stream_router)
router.include_router(main_system_router)
router.include_router(main_system_configuration_router)
