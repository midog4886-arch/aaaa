"""Persist operational warnings independently of the failing push transport."""
import logging
import uuid
import hashlib
from datetime import datetime, timezone
from pymongo.errors import DuplicateKeyError


async def report_notification_failure(db, *, source, branch_id=None):
    """Never fail the saved business operation or expose transport secrets."""
    instant = datetime.now(timezone.utc)
    now = instant.isoformat()
    # Tenant-local collections plus unique _id coalesce a transport outage,
    # rather than creating another staff email for every attempted message.
    warning_key = hashlib.sha256(
        f"{source}:{branch_id}:{int(instant.timestamp()) // 900}".encode()
    ).hexdigest()
    title = "تعذر إرسال بعض الإشعارات"
    body = f"تم حفظ العملية، لكن خدمة الإشعارات تحتاج مراجعة. المصدر: {source}"
    for collection, document in (
        ("notifications", {
            "id": str(uuid.uuid4()), "title": title, "title_ar": title,
            "message": body, "message_ar": body, "type": "notification_service_failure",
            "branch_id": branch_id, "is_read": False, "created_at": now,
            "action_url": "/admin/settings",
        }),
        ("ops_alerts", {
            "id": str(uuid.uuid4()), "kind": "notification_service_failure",
            "title": title, "body": body, "branch_id": branch_id,
            "severity": "warning", "created_at": now, "acknowledged": False,
            "attempts": 0, "next_attempt_at": now, "delivered_email": False,
            "delivered_whatsapp": False, "delivery_status": "pending", "last_error": "",
        }),
    ):
        try:
            document["_id"] = warning_key
            await db[collection].insert_one(document)
        except DuplicateKeyError:
            pass
        except Exception:
            logging.getLogger(__name__).exception("Cannot persist notification health warning")