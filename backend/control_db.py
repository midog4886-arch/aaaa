"""Control-plane database (separate from any tenant DB).

Stores the registry of tenants (academies) that subscribe to the platform.
Lives in MongoDB database ``champions_control`` on the same cluster as the
tenant databases. Accessed directly (NOT through the tenant proxy) since
it is consulted by the tenant middleware before any tenant context exists.
"""
import os
import logging
from datetime import datetime, timezone

from utils.tenant import DEFAULT_TENANT_SLUG, DEFAULT_DB_NAME

logger = logging.getLogger("control_db")

CONTROL_DB_NAME = os.environ.get("CONTROL_DB_NAME", "champions_control")


def _build_control_db():
    from database import _raw_client
    return _raw_client[CONTROL_DB_NAME]


control_db = _build_control_db()


async def ensure_default_tenant():
    """Make sure the registry has a row for the legacy single-tenant deployment.

    Idempotent: only inserts the ``default`` tenant if it is missing.
    The default tenant points at the existing DB (``DB_NAME`` env var) so
    no data migration is required.
    """
    try:
        existing = await control_db.tenants.find_one({"slug": DEFAULT_TENANT_SLUG}, {"_id": 0})
        if existing:
            return existing
        doc = {
            "id": DEFAULT_TENANT_SLUG,
            "slug": DEFAULT_TENANT_SLUG,
            "name": "الأكاديمية الافتراضية",
            "db_name": DEFAULT_DB_NAME,
            "status": "active",
            "plan": "enterprise",
            "max_branches": 0,
            "max_members": 0,
            "features": ["social_publisher", "mobile_app", "whatsapp", "tournaments"],
            "owner_email": "",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await control_db.tenants.insert_one(doc)
        try:
            await control_db.tenants.create_index("slug", unique=True)
        except Exception:
            pass
        logger.info("Seeded default tenant in control DB")
        return doc
    except Exception as e:
        logger.warning(f"ensure_default_tenant failed: {e}")
        return None


async def get_tenant_by_slug(slug: str):
    if not slug:
        return None
    return await control_db.tenants.find_one({"slug": slug}, {"_id": 0})
