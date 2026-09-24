"""Reviewed schedule edits. No invoices or attendance history are rewritten."""
import copy
import hashlib
import json
import math
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException
from pymongo.read_concern import ReadConcern
from pymongo.write_concern import WriteConcern
from pymongo.errors import OperationFailure
from utils.effective_periods import source_key, original_window, effective_period_map, operational_window
from utils.training_closures import training_day_closed


def conflict(message):
    raise HTTPException(409, detail=message)


def weekdays(activity):
    from routes.attendance import parse_schedule_days
    return set(parse_schedule_days(activity.get("schedule") or ""))


def protect_schedule_edit(before, after):
    """Renewals are distinct periods, not a way to overwrite current schedules."""
    if not before:
        return
    same_period = (
        after.get("source_id") == before.get("source_id")
        or after.get("start_date", "") <= before.get("end_date", "")
    )
    changed = weekdays(before) != weekdays(after)
    # Some clients send structured weekdays without updating the display text.
    if set(before.get("training_days") or []) != set(after.get("training_days") or []):
        changed = True
    if same_period and changed:
        conflict("تغيير أيام التدريب يتطلب معاينة وتأكيد تاريخ الانتهاء — schedule_preview_required")


def plan_dates(old, new, item, attendance, closures, freezes, branch, today):
    """Carry future calendar opportunities, never reimburse elapsed absence."""
    from routes.attendance import parse_schedule_days
    start, end = original_window(item)
    purchased_days = parse_schedule_days(item.get("schedule") or "")
    old_days, new_days = weekdays(old), weekdays(new)
    if not purchased_days or not old_days or not new_days:
        conflict("تعذر تحديد أيام الاشتراك الأصلية والحالية؛ يلزم مراجعة مصدر الاشتراك")
    try:
        span = (date.fromisoformat(end) - date.fromisoformat(start)).days
        lower = max(today, date.fromisoformat(old["start_date"][:10]))
        upper = date.fromisoformat(old["end_date"][:10])
    except (ValueError, KeyError, TypeError):
        conflict("تواريخ الاشتراك الأصلية أو الحالية غير صالحة؛ يلزم مراجعتها")
    if span < 0:
        conflict("فترة الشراء الأصلية غير صالحة")
    total = max(1, math.ceil(span / 7)) * len(purchased_days)
    used = len(attendance)
    if used > total:
        conflict("الحضور المسجل يتجاوز عدد الحصص المدفوع؛ يلزم مراجعة السجل")
    for c in closures:
        if c.get("branch_id") in (None, "", "all", branch) and c.get("stop_type", "full_day") != "full_day":
            conflict("يوجد إغلاق جزئي؛ يلزم مراجعة الموعد يدويًا قبل تغييره")

    def allowed(d, days):
        s = d.isoformat()
        return (
            d.strftime("%A").lower() in days
            and not training_day_closed(
                [c for c in closures if c.get("start_date", "") <= s <= c.get("end_date", "")],
                branch, old["activity_id"],
            )
            and not any(f.get("start_date", "") <= s <= f.get("end_date", "") for f in freezes)
        )

    if upper < today:
        conflict("لا يمكن إعادة جدولة اشتراك منتهٍ؛ يلزم مراجعة مستقلة")
    if (upper - lower).days > 730:
        conflict("مدة الاشتراك أطول من نطاق المعاينة الآمن")
    attended = {r["date"][:10] for r in attendance}
    capacity = sum(
        allowed(lower + timedelta(days=i), old_days)
        and (lower + timedelta(days=i)).isoformat() not in attended
        for i in range((upper - lower).days + 1)
    )
    return total, used, capacity, allowed, lower, purchased_days


async def build_plan(db, member, activity_id, payload, today=None, session=None):
    from routes.attendance import _previous_scheduled_date
    kw = {"session": session} if session is not None else {}
    today = today or datetime.now(timezone(timedelta(hours=3))).date()
    matches = [(i, a) for i, a in enumerate(member.get("activities") or []) if a.get("activity_id") == activity_id]
    if len(matches) != 1:
        conflict("اشتراك النشاط غير موجود أو مكرر؛ لا يمكن اختيار فترة تلقائيًا")
    index, old = matches[0]
    if old.get("status", "active") not in ("active", "expired"):
        conflict("الاشتراك غير نشط؛ يلزم معالجة حالته قبل تعديل الموعد")
    new = payload["activity"]
    if new.get("training_days"):
        from routes.attendance import parse_schedule_days
        structured = set(parse_schedule_days(" ".join(new["training_days"])))
        if structured != weekdays(new):
            conflict("أيام التدريب لا تطابق نص الموعد؛ صحّح الموعد قبل المعاينة")
    for key in ("activity_id", "start_date", "source", "source_id", "level_id"):
        if (new.get(key) or "") != (old.get(key) or ""):
            conflict("تغيير مصدر الاشتراك أو بدايته أو المستوى يتطلب إجراءً منفصلًا")
    if new.get("end_date") != old.get("end_date"):
        conflict("اترك تاريخ الانتهاء الحالي؛ المعاينة تحسب التاريخ الجديد")
    invoice = await db.invoices.find_one({"id": old.get("source_id"), "status": {"$in": ["paid", "partial"]}}, {"_id": 0}, **kw)
    candidates = []
    for n, item in enumerate((invoice or {}).get("items") or []):
        if item.get("is_product") or (item.get("member_id") or invoice.get("member_id")) != member["id"]:
            continue
        key = source_key(invoice, item, n)
        if old.get("source_period_key"):
            match = key == old["source_period_key"]
        else:
            match = item.get("activity_id") == activity_id
        if match:
            candidates.append((key, item))
    if len(candidates) != 1:
        conflict("مصدر الحصص المدفوعة غير محدد بشكل فريد؛ يلزم مراجعة الفاتورة")
    key, item = candidates[0]
    effective = await db.subscription_effective_periods.find_one({"source_key": key}, {"_id": 0}, **kw)
    aids = list({activity_id, item["activity_id"]})
    attendance = await db.attendance.find({
        "member_id": member["id"], "activity_id": {"$in": aids},
        "date": {"$gte": old["start_date"][:10]},
    }, {"_id": 0}, **kw).to_list(None)
    if any(r["date"][:10] > today.isoformat() for r in attendance):
        conflict("يوجد حضور مؤرخ في المستقبل؛ يلزم مراجعته أولًا")
    closures = await db.closures.find({"end_date": {"$gte": today.isoformat()}}, {"_id": 0}, **kw).to_list(None)
    freezes = await db.member_freezes.find({"member_id": member["id"], "status": "active"}, {"_id": 0}, **kw).to_list(None)
    levels = await db.level_subscriptions.find({"member_id": member["id"], "level_id": old.get("level_id")}, {"_id": 0}, **kw).to_list(None) if old.get("level_id") else []
    levels = [r for r in levels if (
        str(r.get("start_date") or "")[:10] == old["start_date"][:10]
        or (not r.get("start_date") and r.get("end_date", "") >= old["start_date"][:10])
    )]
    if len(levels) > 1:
        conflict("ارتباط المستوى مكرر؛ يلزم مراجعة الاشتراك")
    if levels and any(a is not old and a.get("level_id") == old.get("level_id") for a in member["activities"]):
        conflict("المستوى مرتبط بأكثر من نشاط؛ لا يمكن تعديل فترة مشتركة تلقائيًا")
    total, used, capacity, allowed, lower, purchased_days = plan_dates(
        old, new, item, attendance, closures, freezes, member.get("branch_id"), today,
    )
    previous = old.get("schedule_reconciliation") or {}
    neutralized = set(previous.get("neutralized_attendance_ids") or [])
    repair_rows = await db.audit_logs.find({
        "action": "subscription.manual_expiry_repair",
        "$or": [{"member_id": member["id"]}, {"entity_id": member["id"]},
                {"entity_id": f'{member["id"]}:{activity_id}'}],
    }, {"_id": 0}, **kw).to_list(None)
    relevant_repairs = []
    for repair in repair_rows:
        # Old repair formats vary. Exclude only when explicit source evidence
        # establishes another activity/period; unknown provenance is not safety.
        parts = [repair] + [repair[k] for k in ("extra", "before", "after")
                            if isinstance(repair.get(k), dict)]
        explicit_aids = {p["activity_id"] for p in parts if p.get("activity_id")}
        entity = str(repair.get("entity_id") or "")
        if entity.startswith(member["id"] + ":"):
            explicit_aids.add(entity[len(member["id"]) + 1:])
        explicit_keys = {p["source_period_key"] for p in parts if p.get("source_period_key")}
        explicit_sources = {p.get("source_id") or p.get("invoice_id") for p in parts
                            if p.get("source_id") or p.get("invoice_id")}
        explicit_starts = {str(p["start_date"])[:10] for p in parts if p.get("start_date")}
        if ((explicit_aids and not explicit_aids.intersection(aids))
                or (explicit_keys and key not in explicit_keys)
                or (explicit_sources and old.get("source_id") not in explicit_sources)
                or (explicit_starts and old["start_date"][:10] not in explicit_starts)):
            continue
        relevant_repairs.append(repair)
        if payload["mode"] == "retrospective_correction":
            recorded_ids = []
            for part in parts:
                value = part.get("neutralized_attendance_ids")
                if value is None and isinstance(part.get("schedule_reconciliation"), dict):
                    value = part["schedule_reconciliation"].get("neutralized_attendance_ids")
                if isinstance(value, list) and value and all(isinstance(v, str) and v for v in value):
                    recorded_ids.extend(value)
            if not recorded_ids:
                conflict("سبق تصحيح انتهاء هذا الاشتراك يدويًا دون تحديد خصومات الحضور التي عُكست؛ يلزم مراجعة التصحيح السابق لمنع تعويض الحصص مرتين")
            neutralized.update(recorded_ids)
    corrected = []
    if payload["mode"] == "retrospective_correction":
        if not (payload.get("reason") or "").strip():
            raise HTTPException(422, detail="سبب تصحيح الموعد السابق مطلوب")
        for record in attendance:
            if not record.get("off_schedule") or record.get("id") in neutralized:
                continue
            if date.fromisoformat(record["date"][:10]).strftime("%A").lower() not in weekdays(new):
                continue
            before, after = record.get("end_shift_from"), record.get("end_shift_to")
            if not record.get("id") or not before or _previous_scheduled_date(before, purchased_days) != after:
                conflict("دليل خصم الحضور القديم غير كافٍ؛ لا يمكن عكسه تلقائيًا")
            corrected.append(record["id"])
        capacity += len(corrected)
    capacity = min(capacity, max(0, total - used))
    if not capacity and weekdays(old) != weekdays(new):
        conflict("لا توجد مواعيد مستقبلية مستحقة لإعادة توزيعها؛ لا يمكن تعويض الغياب بتغيير الموعد")
    dates = []
    for offset in range(731):
        d = lower + timedelta(days=offset)
        if len(dates) == capacity:
            break
        if allowed(d, weekdays(new)) and d.isoformat() not in {r["date"][:10] for r in attendance}:
            dates.append(d.isoformat())
    if len(dates) != capacity:
        conflict("تعذر توزيع الحصص ضمن سنتين؛ راجع التجميد والإغلاق")
    # A time-only/no-op edit must not unexpectedly collapse a flexible deadline.
    end = dates[-1] if dates and (weekdays(old) != weekdays(new) or corrected) else old["end_date"]
    # This endpoint never shifts a prepaid renewal or consumes its opportunities.
    # Cascading purchased periods requires its own explicit review.
    purchases = await db.invoices.find({
        "status": {"$in": ["paid", "partial"]},
        "$or": [{"member_id": member["id"]}, {"items.member_id": member["id"]}],
    }, {"_id": 0}, **kw).to_list(None)
    periods = await effective_period_map(db, purchases, session=session)
    for purchase in purchases:
        for n, other in enumerate(purchase.get("items") or []):
            if other.get("is_product") or other.get("activity_id") not in aids:
                continue
            if (other.get("member_id") or purchase.get("member_id")) != member["id"]:
                continue
            if source_key(purchase, other, n) == key:
                continue
            other_start, other_end = operational_window(purchase, other, n, periods)
            if not other_start or not other_end:
                conflict("يوجد اشتراك آخر بلا تواريخ واضحة؛ يلزم مراجعة الفترات")
            if other_start <= end and other_end >= old["start_date"][:10]:
                conflict("التعديل يتداخل مع فترة مدفوعة أخرى؛ يلزم مراجعة التجديد قبل التأكيد")
    after = {**old, **new, "end_date": end, "source_period_key": key}
    after["schedule_reconciliation"] = {
        "paid_total": total, "neutralized_attendance_ids": sorted(neutralized | set(corrected)),
        "mode": payload["mode"], "effective_date": today.isoformat(),
        "reason": payload.get("reason") or "",
    }
    public = {
        "old_end_date": old["end_date"], "new_end_date": end,
        "old_schedule": old.get("schedule"), "new_schedule": new.get("schedule"),
        "total_allowed": total, "used_sessions": used, "remaining": max(0, total - used),
        "future_dates": dates, "mode": payload["mode"],
        "warnings": ["الحصص التي مضى موعدها دون حضور لا تُعاد؛ عدد الحصص المدفوع والفاتورة والحضور لا تتغير."],
    }
    evidence = [member, invoice, effective, sorted(attendance, key=lambda r: r.get("id", "")),
                sorted(closures, key=lambda r: r.get("id", "")), sorted(freezes, key=lambda r: r.get("id", "")), levels,
                sorted(purchases, key=lambda r: r.get("id", "")), periods,
                sorted(relevant_repairs, key=lambda r: r.get("id", "")),
                {k: v for k, v in payload.items() if k != "preview_token"}, today.isoformat()]
    public["preview_token"] = hashlib.sha256(json.dumps(evidence, sort_keys=True, default=str, ensure_ascii=False).encode()).hexdigest()
    return dict(public=public, index=index, before=old, after=after, effective=effective,
                key=key, item=item, invoice=invoice, levels=levels)


async def commit_plan(db, scoped, activity_id, payload, actor):
    try:
        return await _commit_plan(db, scoped, activity_id, payload, actor)
    except OperationFailure as exc:
        if exc.code in (20, 263, 303):
            raise HTTPException(503, detail="الحفظ الذري غير متاح؛ لم يتم اعتماد تعديل الموعد") from exc
        if exc.code in (112, 244, 251, 11000) or exc.has_error_label("TransientTransactionError"):
            raise HTTPException(409, detail="تغيرت البيانات أثناء الحفظ؛ أعد المعاينة والتأكيد") from exc
        raise


async def _commit_plan(db, scoped, activity_id, payload, actor):
    client = db.client
    async with await client.start_session() as session:
        async with session.start_transaction(
            read_concern=ReadConcern("snapshot"), write_concern=WriteConcern("majority"),
        ):
            member = await db.members.find_one(scoped, {"_id": 0}, session=session)
            if not member:
                raise HTTPException(404, detail="Member not found")
            plan = await build_plan(db, member, activity_id, payload, session=session)
            if not payload.get("preview_token") or payload["preview_token"] != plan["public"]["preview_token"]:
                conflict("تغيرت بيانات المعاينة؛ أعد المعاينة والتأكيد")
            activities = copy.deepcopy(member["activities"])
            activities[plan["index"]] = plan["after"]
            result = await db.members.update_one(
                {**scoped, "activities": member["activities"]}, {"$set": {"activities": activities}}, session=session,
            )
            if result.matched_count != 1:
                conflict("تغير الاشتراك؛ أعد المعاينة")
            start, end = original_window(plan["item"])
            row = {**(plan["effective"] or {}), "source_key": plan["key"],
                   "invoice_id": plan["invoice"]["id"], "member_id": member["id"],
                   "activity_id": plan["item"]["activity_id"],
                   "original_start_date": start, "original_end_date": end,
                   "effective_start_date": plan["after"]["start_date"],
                   "effective_end_date": plan["after"]["end_date"]}
            if plan["effective"]:
                res = await db.subscription_effective_periods.replace_one(plan["effective"], row, session=session)
                if res.matched_count != 1:
                    conflict("تغيرت فترة الاشتراك؛ أعد المعاينة")
            else:
                await db.subscription_effective_periods.insert_one(row, session=session)
            for level in plan["levels"]:
                res = await db.level_subscriptions.update_one(
                    level, {"$set": {"end_date": plan["after"]["end_date"]}}, session=session,
                )
                if res.matched_count != 1:
                    conflict("تغير اشتراك المستوى؛ أعد المعاينة")
            await db.audit_logs.insert_one({
                "id": str(uuid.uuid4()), "action": "subscription.schedule_reconciliation",
                "entity_type": "member_activity", "entity_id": f'{member["id"]}:{activity_id}',
                "member_id": member["id"],
                "entity_name": member.get("name_ar") or member.get("name") or "",
                "actor_id": actor.get("user_id"), "branch_id": member.get("branch_id"),
                "actor_username": actor.get("username") or "", "actor_is_admin": bool(actor.get("is_admin")),
                "before": plan["before"], "after": plan["after"],
                "diff": {k: {"before": plan["before"].get(k), "after": v}
                         for k, v in plan["after"].items() if plan["before"].get(k) != v},
                "created_at": datetime.now(timezone.utc).isoformat(),
            }, session=session)
    return member, plan