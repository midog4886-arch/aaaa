import logging
from database import db

logger = logging.getLogger("db_indexes")

INDEXES = {
    "members": [
        ([("branch_id", 1)], {}),
        ([("phone", 1)], {}),
        ([("national_id", 1)], {}),
        ([("member_code", 1)], {}),
        ([("id", 1)], {}),
        ([("branch_id", 1), ("name", 1)], {}),
        ([("activities.end_date", 1)], {}),
        ([("guardian_phone", 1)], {}),
    ],
    "invoices": [
        ([("branch_id", 1)], {}),
        ([("member_id", 1)], {}),
        ([("invoice_number", 1)], {}),
        ([("invoice_date", -1)], {}),
        ([("created_at", -1)], {}),
        ([("branch_id", 1), ("invoice_date", -1)], {}),
        ([("branch_id", 1), ("created_at", -1)], {}),
        ([("branch_id", 1), ("invoice_number", 1)], {}),
    ],
    "attendance": [
        ([("member_id", 1)], {}),
        ([("branch_id", 1)], {}),
        ([("date", -1)], {}),
        ([("created_at", -1)], {}),
        ([("branch_id", 1), ("date", -1)], {}),
        ([("branch_id", 1), ("created_at", -1)], {}),
        ([("member_id", 1), ("date", -1)], {}),
    ],
    "coach_attendance": [
        ([("coach_id", 1)], {}),
        ([("date", -1)], {}),
        ([("coach_id", 1), ("date", -1)], {}),
        ([("branch_id", 1), ("date", -1)], {}),
    ],
    "coaches": [
        ([("branch_id", 1)], {}),
        ([("id", 1)], {}),
    ],
    "activities": [
        ([("branch_id", 1)], {}),
        ([("id", 1)], {}),
    ],
    "levels": [
        ([("branch_id", 1)], {}),
        ([("activity_id", 1)], {}),
        ([("id", 1)], {}),
    ],
    "notifications": [
        ([("user_id", 1), ("created_at", -1)], {}),
        ([("user_id", 1), ("read", 1)], {}),
        ([("created_at", -1)], {}),
    ],
    "messages": [
        ([("recipient_id", 1), ("created_at", -1)], {}),
        ([("sender_id", 1), ("created_at", -1)], {}),
    ],
    "users": [
        ([("username", 1)], {}),
        ([("id", 1)], {}),
        ([("branch_id", 1)], {}),
    ],
    "branches": [
        ([("id", 1)], {}),
        ([("code_prefix", 1)], {
            "unique": True,
            "partialFilterExpression": {"code_prefix": {"$type": "string", "$gt": ""}},
            "name": "uniq_code_prefix",
        }),
    ],
    "daily_ledger": [
        ([("branch_id", 1), ("date", -1)], {}),
        ([("date", -1)], {}),
    ],
    "payment_vouchers": [
        ([("branch_id", 1), ("date", -1)], {}),
    ],
    "freezes": [
        ([("member_id", 1)], {}),
        ([("branch_id", 1)], {}),
    ],
    "day_extensions": [
        ([("member_id", 1)], {}),
        ([("closure_id", 1), ("member_id", 1), ("scope_type", 1), ("activity_id", 1)], {
            "unique": True,
            "name": "uniq_closure_member_activity",
            "partialFilterExpression": {"scope_type": "activity"},
        }),
    ],
    "subscription_effective_periods": [
        ([("source_key", 1)], {"unique": True, "name": "uniq_effective_period_source"}),
        ([("member_id", 1), ("activity_id", 1), ("effective_start_date", 1)], {}),
    ],
    "tournaments": [
        ([("branch_id", 1)], {}),
        ([("date", -1)], {}),
    ],
    "loyalty_transactions": [
        ([("member_id", 1), ("created_at", -1)], {}),
    ],
    "registration_forms": [
        ([("member_id", 1)], {}),
        ([("branch_id", 1)], {}),
    ],
    "campaign_inquiries": [
        ([("id", 1)], {"unique": True}),
        ([("branch_id", 1), ("phone", 1)], {"unique": True}),
        ([("branch_id", 1), ("created_at", -1)], {}),
        ([("branch_id", 1), ("status", 1), ("followup_due_at", 1)], {}),
        ([("branch_id", 1), ("automation_status", 1), ("automation_next_due_at", 1)], {}),
        ([("branch_id", 1), ("phone", 1), ("automation_enrolled", 1)], {}),
        ([("branch_id", 1), ("automation_claim_id", 1)], {"sparse": True}),
    ],
    "campaign_inquiry_automation_settings": [
        ([("tenant_slug", 1), ("branch_id", 1)], {"unique": True}),
    ],
    "campaign_inquiry_automation_previews": [
        ([("tenant_slug", 1), ("preview_id", 1)], {"unique": True}),
        ([("tenant_slug", 1), ("branch_id", 1), ("expires_at", 1)], {}),
    ],
    "activity_notes": [
        ([("branch_id", 1), ("created_at", -1)], {}),
        ([("created_at", -1)], {}),
    ],
    "discounts": [
        ([("branch_id", 1)], {}),
    ],
    "audit_logs": [
        ([("member_id", 1), ("created_at", -1)], {}),
        ([("entity_type", 1), ("action", 1)], {}),
    ],
}


async def ensure_indexes():
    if not hasattr(db, "command"):
        logger.info("Skipping index creation (HTTP Atlas client in use)")
        return
    created = 0
    skipped = 0
    for collection_name, idx_list in INDEXES.items():
        coll = db[collection_name]
        for keys, opts in idx_list:
            try:
                await coll.create_index(keys, background=True, **opts)
                created += 1
            except Exception as e:
                skipped += 1
                logger.debug(f"Index skip {collection_name}{keys}: {e}")
    logger.info(f"Indexes ensured: {created} created/verified, {skipped} skipped")
