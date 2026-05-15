"""Control-plane database (separate from any tenant DB).

Stores the registry of tenants (academies) that subscribe to the platform.
Lives in MongoDB database ``champions_control`` on the same cluster as the
tenant databases. Accessed directly (NOT through the tenant proxy) since
it is consulted by the tenant middleware before any tenant context exists.
"""
import os
import logging
from datetime import datetime, timezone, timedelta

from utils.tenant import DEFAULT_TENANT_SLUG, DEFAULT_DB_NAME

DEFAULT_TRIAL_DAYS = int(os.environ.get("TENANT_TRIAL_DAYS", "30"))
DEFAULT_BILLING_CYCLE = os.environ.get("TENANT_BILLING_CYCLE", "monthly")

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
        now = datetime.now(timezone.utc)
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
            "created_at": now.isoformat(),
            "billing_cycle": "yearly",
            "subscription_start_at": now.isoformat(),
            "subscription_end_at": (now + timedelta(days=3650)).isoformat(),
            "auto_suspend_on_expiry": False,
            "renewal_history": [],
            "logo_base64": "",
            "primary_color": "",
            "onboarding_completed_at": now.isoformat(),
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


async def backfill_billing_fields():
    """Add billing fields to legacy tenant docs that predate the billing feature.

    For default tenant: 10-year subscription, auto_suspend disabled.
    For other legacy tenants: trial-length subscription from their created_at,
    auto_suspend enabled.
    """
    try:
        cursor = control_db.tenants.find({"subscription_end_at": {"$exists": False}}, {"_id": 0})
        async for t in cursor:
            slug = t.get("slug", "")
            created_at = t.get("created_at") or datetime.now(timezone.utc).isoformat()
            try:
                start = datetime.fromisoformat(created_at)
                if start.tzinfo is None:
                    start = start.replace(tzinfo=timezone.utc)
            except Exception:
                start = datetime.now(timezone.utc)
            if slug == DEFAULT_TENANT_SLUG:
                end = start + timedelta(days=3650)
                update = {
                    "billing_cycle": "yearly",
                    "subscription_start_at": start.isoformat(),
                    "subscription_end_at": end.isoformat(),
                    "auto_suspend_on_expiry": False,
                    "renewal_history": [],
                }
            else:
                end = start + timedelta(days=DEFAULT_TRIAL_DAYS)
                update = {
                    "billing_cycle": DEFAULT_BILLING_CYCLE,
                    "subscription_start_at": start.isoformat(),
                    "subscription_end_at": end.isoformat(),
                    "auto_suspend_on_expiry": True,
                    "renewal_history": [],
                }
            await control_db.tenants.update_one({"slug": slug}, {"$set": update})
            logger.info("Backfilled billing for tenant %s", slug)
    except Exception as e:
        logger.warning(f"backfill_billing_fields failed: {e}")


async def backfill_onboarding_completed():
    """Mark pre-existing tenants as having completed onboarding so the wizard
    only shows up for tenants newly created after this feature ships.
    """
    try:
        cursor = control_db.tenants.find(
            {"onboarding_completed_at": {"$exists": False}}, {"_id": 0, "slug": 1, "created_at": 1}
        )
        async for t in cursor:
            slug = t.get("slug", "")
            stamp = t.get("created_at") or datetime.now(timezone.utc).isoformat()
            await control_db.tenants.update_one(
                {"slug": slug}, {"$set": {"onboarding_completed_at": stamp}}
            )
            logger.info("Backfilled onboarding flag for tenant %s", slug)
    except Exception as e:
        logger.warning(f"backfill_onboarding_completed failed: {e}")


async def auto_suspend_expired() -> int:
    """Suspend tenants whose subscription_end_at has passed.

    Only acts on tenants with status='active' and auto_suspend_on_expiry=True.
    Returns the number of tenants suspended.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        result = await control_db.tenants.update_many(
            {
                "status": "active",
                "auto_suspend_on_expiry": True,
                "subscription_end_at": {"$lt": now_iso},
            },
            {"$set": {"status": "suspended", "suspended_at": now_iso, "suspended_reason": "expired"}},
        )
        if result.modified_count:
            logger.warning("Auto-suspended %d expired tenants", result.modified_count)
        return result.modified_count
    except Exception as e:
        logger.warning(f"auto_suspend_expired failed: {e}")
        return 0


async def get_tenant_by_slug(slug: str):
    if not slug:
        return None
    return await control_db.tenants.find_one({"slug": slug}, {"_id": 0})
