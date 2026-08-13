"""Guard: EVERY check-in path must notify the GUARDIAN, not just the
checked-in child:
  (a) an in-app `attendance_recorded` notification is persisted AND visible
      in the portal notifications feed of a guardian logged in via a LINKED
      sibling account (family = members sharing the guardian phone), and
  (b) the push sender targets the guardian's enrolled device even though that
      device's subscription is stored under the sibling's member id.

Paths covered (memory attendance-route-shadowing.md — the LIVE manual/QR
handlers are routes/attendance.py; quick/bulk live in server.py):
  1. routes.attendance.create_attendance   (manual POST /api/attendance)
  2. routes.attendance.qr_checkin          (POST /api/attendance/qr-checkin)
  3. server.quick_attendance               (POST /api/attendance/quick)
  4. server.record_bulk_attendance         (POST /api/attendance/bulk)

Hermetic w.r.t. transports: handlers run in-process (no HTTP server) and the
single web-push seam `routes.push_notifications.send_push_notification` is
monkeypatched to a recorder — both push paths (send_attendance_push used by
manual/QR AND _push_attendance_notice -> send_push_to_members used by
quick/bulk) funnel through it. Uses throwaway guardian+child pairs in the dev
DB; everything is cleaned up. Fails (not skips) when the DB/tenant is missing.
"""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone, timedelta

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

TENANT_SLUG = "default"
SAUDI_TZ = timezone(timedelta(hours=3))

ARABIC_DAYS = {
    "sunday": "الأحد", "monday": "الإثنين", "tuesday": "الثلاثاء",
    "wednesday": "الأربعاء", "thursday": "الخميس", "friday": "الجمعة",
    "saturday": "السبت",
}


async def _setup_tenant():
    from control_db import control_db
    from utils.tenant import set_current_tenant
    tenant = await control_db.tenants.find_one({"slug": TENANT_SLUG})
    assert tenant, "default tenant missing in control DB"
    set_current_tenant(tenant)
    from database import db
    admin = await db.users.find_one({"is_admin": True}, {"_id": 0})
    assert admin, "no admin user in tenant DB"
    # Handlers normally receive the JWT-derived user dict, which carries
    # `user_id` alongside the stored fields — mirror that shape.
    admin = {**admin, "user_id": admin.get("id")}
    return db, admin


def _today():
    return datetime.now(SAUDI_TZ).strftime("%Y-%m-%d")


async def _make_fixture(db, tag):
    """Per check-in path: a CHILD member (with an active subscription
    scheduled today) + a GUARDIAN-side sibling member sharing the same phone,
    whose device holds the active push subscription. This mirrors the real
    family flow: guardian logs in via one child account; another child is the
    one who checks in. `tag` is provided by the caller so cleanup can run by
    tag even when creation fails midway."""
    start = (datetime.now(SAUDI_TZ) - timedelta(days=3)).strftime("%Y-%m-%d")
    end = (datetime.now(SAUDI_TZ) + timedelta(days=30)).strftime("%Y-%m-%d")
    schedule = ARABIC_DAYS[datetime.now(SAUDI_TZ).strftime("%A").lower()]
    branch = await db.branches.find_one({}, {"_id": 0, "id": 1})
    branch_id = (branch or {}).get("id", "")
    now_iso = datetime.now(timezone.utc).isoformat()

    activity_id = f"test-act-{tag}"
    await db.activities.insert_one({
        "id": activity_id, "name": f"Test Activity {tag}",
        "name_ar": f"نشاط اختبار {tag}", "branch_id": branch_id,
        "monthly_fee": 0, "created_at": now_iso,
    })

    pairs = {}
    for i, path in enumerate(("manual", "qr", "quick", "bulk", "bulkabs")):
        phone = f"0590{tag[:4]}{i}9"  # unique per pair, shared within the pair
        child_id = f"test-child-{path}-{tag}"
        guardian_id = f"test-guard-{path}-{tag}"
        code = f"TSTN-{path[:2].upper()}-{tag[:4]}"
        # Register the pair BEFORE inserting so a mid-creation failure still
        # lets the caller's cleanup remove whatever was already written.
        pairs[path] = {"child_id": child_id, "guardian_id": guardian_id, "code": code}
        await db.members.insert_one({
            "id": child_id, "member_code": code,
            "name": f"Test child {path} {tag}", "name_ar": f"طفل اختبار {path}",
            "phone": phone, "branch_id": branch_id,
            "activities": [{
                "activity_id": activity_id,
                "activity_name": f"نشاط اختبار {tag}",
                "status": "active",
                "start_date": start, "end_date": end,
                "schedule": schedule,
            }],
            "created_at": now_iso,
        })
        await db.members.insert_one({
            "id": guardian_id, "member_code": f"{code}G",
            "name": f"Test guardian {path} {tag}", "name_ar": f"ولي أمر اختبار {path}",
            "phone": phone, "branch_id": branch_id,
            "activities": [], "created_at": now_iso,
        })
        # Guardian's device subscription lives under the GUARDIAN-side account,
        # NOT the checked-in child (fake endpoint — sender is mocked).
        await db.push_subscriptions.insert_one({
            "id": f"test-push-{path}-{tag}",
            "member_id": guardian_id,
            "endpoint": f"https://push.test.invalid/{tag}/{path}",
            "keys": {"p256dh": "x", "auth": "y"},
            "is_active": True,
            "created_at": now_iso,
        })
    return {"tag": tag, "activity_id": activity_id, "pairs": pairs}


async def _cleanup(db, tag):
    """Delete every fixture doc carrying `tag` — id patterns are fixed
    (test-child-*/test-guard-*/test-act-*), so this works even after a
    partial fixture creation and guarantees no test-* docs remain."""
    id_re = {"$regex": f"^test-(child|guard)-[a-z]+-{tag}$"}
    await db.members.delete_many({"id": id_re})
    await db.activities.delete_many({"id": f"test-act-{tag}"})
    await db.attendance.delete_many({"member_id": id_re})
    await db.member_notifications.delete_many({"member_id": id_re})
    await db.member_points.delete_many({"member_id": id_re})
    await db.push_subscriptions.delete_many({"member_id": id_re})


async def _drain_background_tasks(pushed, guardian_id, attempts=20):
    """quick/bulk push via asyncio.create_task — give the loop time to run it."""
    for _ in range(attempts):
        if any(p["member_id"] == guardian_id for p in pushed):
            return
        await asyncio.sleep(0.25)


async def _authenticate_guardian(db, guardian_id: str):
    """Build the authenticated portal member exactly as get_current_member
    does (same-phone family linkage), starting from the guardian-side login."""
    from routes.member_portal import get_current_member
    from fastapi.security import HTTPAuthorizationCredentials
    import jwt as pyjwt
    from routes.member_portal import MEMBER_JWT_SECRET
    token = pyjwt.encode(
        {"member_id": guardian_id, "type": "member", "tenant_slug": TENANT_SLUG},
        MEMBER_JWT_SECRET, algorithm="HS256",
    )
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
    return await get_current_member(credentials=creds)


@pytest.mark.asyncio
async def test_all_four_checkin_paths_notify_guardian(monkeypatch):
    db, admin = await _setup_tenant()

    import routes.attendance as att_routes
    import routes.push_notifications as push_mod
    import server as server_mod

    pushed = []

    async def _fake_send_push_notification(subscription, payload, *a, **kw):
        pushed.append({
            "member_id": subscription.get("member_id"),
            "endpoint": subscription.get("endpoint"),
            "title": getattr(payload, "title", ""),
            "tag": getattr(payload, "tag", ""),
            "data": getattr(payload, "data", None) or {},
        })
        return {"success": True}

    monkeypatch.setattr(push_mod, "send_push_notification", _fake_send_push_notification)

    failures = []
    tag = uuid.uuid4().hex[:8]
    try:
        # Inside try so a mid-creation failure still reaches the tag-based
        # cleanup below (which removes even a partially created fixture).
        fx = await _make_fixture(db, tag)
        # 1) manual — routes/attendance.py POST /attendance
        p = fx["pairs"]["manual"]
        res = await att_routes.create_attendance(
            att_routes.AttendanceCreate(member_id=p["child_id"], activity_id=fx["activity_id"]),
            current_user=admin,
        )
        assert res.get("record", {}).get("member_id") == p["child_id"]

        # 2) QR — routes/attendance.py POST /attendance/qr-checkin
        p = fx["pairs"]["qr"]
        await att_routes.qr_checkin(
            member_code=p["code"], activity_id=fx["activity_id"],
            force=True, method=None, current_user=admin,
        )

        # 3) quick scanner — server.py POST /attendance/quick
        p = fx["pairs"]["quick"]
        await server_mod.quick_attendance(
            member_code=p["code"], activity_id=fx["activity_id"], current_user=admin,
        )

        # 4) bulk — server.py POST /attendance/bulk
        p = fx["pairs"]["bulk"]
        await server_mod.record_bulk_attendance(
            server_mod.BulkAttendanceRequest(
                activity_id=fx["activity_id"], date=_today(),
                records=[{"member_id": p["child_id"], "status": "present"}],
            ),
            current_user=admin,
        )

        # 4b) bulk ABSENT — must NOT notify the family ("attendance recorded"
        # for an absent child would be a false alert).
        p = fx["pairs"]["bulkabs"]
        await server_mod.record_bulk_attendance(
            server_mod.BulkAttendanceRequest(
                activity_id=fx["activity_id"], date=_today(),
                records=[{"member_id": p["child_id"], "status": "absent"}],
            ),
            current_user=admin,
        )
        await asyncio.sleep(1.0)  # let any (wrongly) scheduled push run
        if await db.member_notifications.find_one(
            {"member_id": p["child_id"], "type": "attendance_recorded"}, {"_id": 0, "id": 1}
        ):
            failures.append("bulk-absent: attendance_recorded notification was created for an ABSENT child")
        if any(s["member_id"] == p["guardian_id"] for s in pushed):
            failures.append("bulk-absent: push was sent to the guardian for an ABSENT child")

        from routes.member_portal import get_member_notifications
        for path, p in fx["pairs"].items():
            if path == "bulkabs":
                continue  # negative case asserted above
            # (a) in-app row persisted for the checked-in child…
            notif = await db.member_notifications.find_one(
                {"member_id": p["child_id"], "type": "attendance_recorded"}, {"_id": 0}
            )
            if not notif:
                failures.append(f"{path}: no attendance_recorded in member_notifications")
                continue
            # …and visible to the GUARDIAN authenticated via the sibling
            # account (real get_current_member linkage — same phone).
            guardian = await _authenticate_guardian(db, p["guardian_id"])
            if p["child_id"] not in guardian.get("_linked_member_ids", []):
                failures.append(f"{path}: family linkage did not link child to guardian")
                continue
            feed = await get_member_notifications(member=guardian)
            feed_types = [n.get("type") for n in feed.get("notifications", [])]
            if "attendance_recorded" not in feed_types:
                failures.append(f"{path}: child's notification not visible in guardian's portal feed")

            # (b) push targeted the guardian's enrolled device (subscription
            # stored under the SIBLING account, not the checked-in child).
            await _drain_background_tasks(pushed, p["guardian_id"])
            sent = [s for s in pushed if s["member_id"] == p["guardian_id"]]
            if not sent:
                failures.append(f"{path}: push never targeted the guardian's device")
            else:
                s = sent[0]
                is_attendance = (
                    "attendance" in (s.get("tag") or "")
                    or (s.get("data") or {}).get("type", "").startswith("attendance")
                )
                if not is_attendance:
                    failures.append(f"{path}: push payload not attendance-typed: {s}")
    finally:
        await _cleanup(db, tag)

    assert not failures, " | ".join(failures)
