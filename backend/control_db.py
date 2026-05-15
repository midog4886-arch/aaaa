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
        # Always (re)assert the email_log indexes — cheap and idempotent.
        try:
            await control_db.email_log.create_index([("sent_at", -1)])
            await control_db.email_log.create_index("tenant_slug")
        except Exception:
            pass
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
        try:
            await control_db.email_log.create_index([("sent_at", -1)])
            await control_db.email_log.create_index("tenant_slug")
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
    Returns the number of tenants suspended. Also sends a "suspended" email
    to each affected tenant (best-effort; never raises).
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        # Stream the to-be-suspended set via a cursor (no fixed cap) so very
        # large fleets don't silently miss the suspension email.
        send_email = None
        try:
            from utils.email_service import send_email as _se
            send_email = _se
        except Exception:
            logger.exception("failed to import email_service in auto_suspend_expired")

        # Atomic transition first so we never email a tenant that raced a
        # renewal in between the read and the update. Then re-query the
        # exact set we just suspended (matched by the unique suspended_at
        # stamp we just wrote) and email those owners.
        result = await control_db.tenants.update_many(
            {
                "status": "active",
                "auto_suspend_on_expiry": True,
                "subscription_end_at": {"$lt": now_iso},
            },
            {"$set": {"status": "suspended", "suspended_at": now_iso, "suspended_reason": "expired"}},
        )

        emailed = 0
        if result.modified_count and send_email is not None:
            just_suspended = control_db.tenants.find(
                {"suspended_at": now_iso, "suspended_reason": "expired"},
                {"_id": 0, "slug": 1, "name": 1, "owner_email": 1},
            )
            async for t in just_suspended:
                email = (t.get("owner_email") or "").strip()
                if not email:
                    continue
                try:
                    res = await send_email(
                        kind="suspended",
                        to=email,
                        tenant_slug=t.get("slug"),
                        ctx={"academy_name": t.get("name", ""), "reason": "expired"},
                    )
                    if (res or {}).get("status") == "sent":
                        emailed += 1
                except Exception:
                    logger.exception("suspended email failed for %s", t.get("slug"))

        if result.modified_count:
            logger.warning(
                "Auto-suspended %d expired tenants (emails sent: %d)",
                result.modified_count, emailed,
            )

        return result.modified_count
    except Exception as e:
        logger.warning(f"auto_suspend_expired failed: {e}")
        return 0


async def send_trial_ending_emails() -> dict:
    """Send "trial_ending" emails to tenants at 7/3/1 days before expiry.

    Idempotent per (tenant, threshold) — uses ``trial_emails_sent`` array on
    the tenant doc to dedupe so each threshold fires at most once per cycle
    (the array is cleared on renewal).
    Returns ``{"sent": N, "skipped": M, "errors": [...]}``.
    """
    THRESHOLDS = [7, 3, 1]
    now = datetime.now(timezone.utc)
    sent = 0
    skipped = 0
    errors: list = []
    try:
        cursor = control_db.tenants.find(
            {"status": "active", "subscription_end_at": {"$exists": True}},
            {"_id": 0, "slug": 1, "name": 1, "owner_email": 1,
             "subscription_end_at": 1, "trial_emails_sent": 1, "auto_suspend_on_expiry": 1},
        )
        send_email = None
        try:
            from utils.email_service import send_email as _se
            send_email = _se
        except Exception:
            logger.exception("send_trial_ending_emails: email_service import failed")
            return {"sent": 0, "skipped": 0, "errors": ["email_service import failed"]}

        async for t in cursor:
            email = (t.get("owner_email") or "").strip()
            if not email:
                skipped += 1
                continue
            end_iso = t.get("subscription_end_at") or ""
            try:
                end = datetime.fromisoformat(end_iso.replace("Z", "+00:00"))
                if end.tzinfo is None:
                    end = end.replace(tzinfo=timezone.utc)
            except Exception:
                skipped += 1
                continue
            # Tolerant window: hours-based so a daily run that fires anywhere
            # within ±12h of the threshold still catches it. Pick the smallest
            # not-yet-sent threshold whose window has been reached.
            hours_left = (end - now).total_seconds() / 3600.0
            if hours_left <= 0:
                skipped += 1
                continue
            already = set(t.get("trial_emails_sent") or [])
            target = None
            for th in THRESHOLDS:  # 7, 3, 1 (largest first)
                if th in already:
                    continue
                # Fire once we're inside the threshold window (e.g. ≤7d24h
                # for the 7-day reminder) but not below the next finer one.
                upper_h = th * 24 + 12
                lower_h = 0
                for finer in THRESHOLDS:
                    if finer < th:
                        lower_h = finer * 24 + 12
                        break
                if lower_h < hours_left <= upper_h:
                    target = th
                    break
            if target is None:
                skipped += 1
                continue
            try:
                res = await send_email(
                    kind="trial_ending",
                    to=email,
                    tenant_slug=t.get("slug"),
                    ctx={
                        "academy_name": t.get("name", ""),
                        "days_remaining": target,
                        "subscription_end_at": end_iso,
                    },
                )
                # Only mark the threshold as handled when the email actually
                # went out — that way a misconfigured provider can be fixed
                # later and the reminder will still fire on the next run.
                if res.get("status") == "sent":
                    sent += 1
                    await control_db.tenants.update_one(
                        {"slug": t.get("slug")},
                        {"$addToSet": {"trial_emails_sent": target}},
                    )
                else:
                    skipped += 1
            except Exception as e:
                errors.append(f"{t.get('slug')}: {e}")
                logger.exception("trial_ending email failed for %s", t.get("slug"))
    except Exception as e:
        logger.exception("send_trial_ending_emails failed")
        errors.append(str(e))
    return {"sent": sent, "skipped": skipped, "errors": errors}


async def notify_expired_email_confirmations() -> dict:
    """Email a reminder to the OLD/confirmed address when a pending owner or
    billing email change request expires without being clicked.

    The new ``pending_{role}_email`` is intentionally left in place on the
    tenant doc so the in-app Settings → Billing badge can surface the
    "expired – please retry" state until the admin acts (resend or save a new
    address). To avoid re-emailing on every daily run, we stamp
    ``pending_{role}_email_expired_notified_at`` with the expiry time we
    handled; if the admin later resends, ``_send_confirmation`` writes a fresh
    ``pending_{role}_email_expires_at`` and the next expiry will reopen this
    code path.

    Returns ``{"sent": N, "skipped": M, "errors": [...]}``.
    """
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    sent = 0
    skipped = 0
    errors: list = []
    try:
        send_email = None
        try:
            from utils.email_service import send_email as _se
            send_email = _se
        except Exception:
            logger.exception("notify_expired_email_confirmations: email_service import failed")
            return {"sent": 0, "skipped": 0, "errors": ["email_service import failed"]}

        for role in ("owner", "billing"):
            field_email = f"pending_{role}_email"
            field_exp = f"pending_{role}_email_expires_at"
            field_req = f"pending_{role}_email_requested_at"
            field_notified = f"pending_{role}_email_expired_notified_at"
            cursor = control_db.tenants.find(
                {
                    field_email: {"$nin": ["", None]},
                    field_exp: {"$lt": now_iso, "$nin": ["", None]},
                },
                {
                    "_id": 0, "slug": 1, "name": 1,
                    "owner_email": 1, "billing_email": 1,
                    field_email: 1, field_exp: 1, field_req: 1, field_notified: 1,
                },
            )
            async for t in cursor:
                exp_iso = t.get(field_exp) or ""
                already = t.get(field_notified) or ""
                if already and already == exp_iso:
                    skipped += 1
                    continue
                # Reminder always goes to the previously confirmed owner_email
                # (the address the admin still controls). The billing address
                # is only a delegated recipient for payment mails.
                recipient = (t.get("owner_email") or "").strip()
                if not recipient:
                    skipped += 1
                    continue
                try:
                    res = await send_email(
                        kind="email_confirmation_expired",
                        to=recipient,
                        tenant_slug=t.get("slug"),
                        ctx={
                            "academy_name": t.get("name", ""),
                            "role": role,
                            "pending_email": t.get(field_email, ""),
                            "requested_at": t.get(field_req, ""),
                        },
                    )
                    if (res or {}).get("status") == "sent":
                        sent += 1
                        await control_db.tenants.update_one(
                            {"slug": t.get("slug")},
                            {"$set": {field_notified: exp_iso}},
                        )
                    else:
                        skipped += 1
                except Exception as e:
                    errors.append(f"{t.get('slug')}/{role}: {e}")
                    logger.exception(
                        "email_confirmation_expired send failed for %s (%s)",
                        t.get("slug"), role,
                    )
    except Exception as e:
        logger.exception("notify_expired_email_confirmations failed")
        errors.append(str(e))
    return {"sent": sent, "skipped": skipped, "errors": errors}


async def get_tenant_by_slug(slug: str):
    if not slug:
        return None
    return await control_db.tenants.find_one({"slug": slug}, {"_id": 0})
