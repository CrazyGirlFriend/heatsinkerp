"""Assemble only the supported phase-one HTTP API."""

from fastapi import APIRouter

from .admin_api import router as admin_router
from .auth_api import router as public_router
from .business_notices import router as business_notices_router
from .factory_dashboard import router as dashboard_router
from .factory_overview import router as factory_router
from .factory_performance import router as performance_router
from .factory_stream import router as stream_router
from .inspection_api import router as inspection_router
from .main_system_api import router as main_system_router
from .main_system_configuration import router as main_system_configuration_router
from .material_analytics import router as analytics_router
from .material_dispatch_api import router as dispatch_router
from .material_stock_api import router as stock_router
from .material_transfer_api import router as material_router
from .notification_api import router as notification_router
from .opening_stock import router as opening_stock_router
from .process_route_api import router as process_route_router
from .production_schedule_api import router as production_schedule_router
from .quality_feedback_api import router as quality_feedback_router
from .rework_notices import router as rework_notices_router
from .schedule_notices import router as schedule_notices_router
from .serial_urgency import router as urgency_router
from .team_business import router as team_business_router
from .team_serial_history import router as serial_history_router
from .warehouse_inventory import router as warehouse_inventory_router
from .warehouse_locations import router as warehouse_locations_router

router = APIRouter()
router.include_router(admin_router)
router.include_router(material_router)
router.include_router(stock_router)
router.include_router(inspection_router)
router.include_router(quality_feedback_router)
router.include_router(rework_notices_router)
router.include_router(business_notices_router)
router.include_router(production_schedule_router)
router.include_router(process_route_router)
router.include_router(dispatch_router)
router.include_router(analytics_router)
router.include_router(warehouse_inventory_router)
router.include_router(factory_router)
router.include_router(performance_router)
router.include_router(urgency_router)
router.include_router(stream_router)
router.include_router(main_system_router)
router.include_router(main_system_configuration_router)
router.include_router(team_business_router)
router.include_router(opening_stock_router)
router.include_router(serial_history_router)
router.include_router(notification_router)
router.include_router(schedule_notices_router)
router.include_router(dashboard_router)
router.include_router(warehouse_locations_router)

__all__ = ["public_router", "router"]
