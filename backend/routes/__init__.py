"""Routes package"""
from .users import router as users_router
from .levels import router as levels_router
from .branches import router as branches_router
from .activities import router as activities_router
from .coaches import router as coaches_router
from .member_portal import router as member_portal_router
from .members import router as members_router
from .invoices import router as invoices_router
from .attendance import router as attendance_router
from .notifications import router as notifications_router

__all__ = [
    'users_router',
    'levels_router', 
    'branches_router',
    'activities_router',
    'coaches_router',
    'member_portal_router',
    'members_router',
    'invoices_router',
    'attendance_router',
    'notifications_router'
]
