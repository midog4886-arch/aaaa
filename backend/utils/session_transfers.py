"""Reviewed transfers preserve invoices and attendance; both balances commit together."""
import copy
import hashlib
import json
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from pymongo.read_concern import ReadConcern
from pymongo.write_concern import WriteConcern
from pymongo.errors import OperationFailure
from utils.transferred_session_dates import effective_transfer_end, next_training_dates, transfer_dates


def reject(message):
    raise HTTPException(409, detail=message)


async def preview(db, sender_query, recipient_query, activity_id, payload, session=None):
    from routes.attendance import check_member_session_quota
    kw = {"session": session} if session is not None else {}
    sender = await db.members.find_one(sender_query, {"_id": 0}, **kw)
    recipient = await db.members.find_one(recipient_query, {"_id": 0}, **kw)
    if not sender or not recipient:
        raise HTTPException(404, detail="المشترك غير موجود أو خارج صلاحياتك")
    if sender["id"] == recipient["id"]:
        reject("اختر مشتركًا آخر")
    if not sender.get("branch_id") or sender.get("branch_id") != recipient.get("branch_id"):
        reject("نقل الحصص متاح داخل نفس الفرع")
    if not payload.get("reason", "").strip():
        raise HTTPException(422, detail="اكتب سبب النقل")
    source = [a for a in sender.get("activities", []) if a.get("activity_id") == activity_id]
    target = [a for a in recipient.get("activities", []) if a.get("activity_id") == activity_id]
    if len(source) != 1 or len(target) > 1:
        reject("اشتراك النشاط غير موجود أو مكرر")
    source = source[0]
    today = datetime.now(timezone(timedelta(hours=3))).date().isoformat()
    source_end = effective_transfer_end(source)
    if source.get("status", "active") != "active" or not source.get("start_date", "") <= today <= source_end:
        reject("يلزم اشتراك مصدر نشط وساري")
    quotas = await check_member_session_quota(sender["id"], activity_id, session=session)
    matching = [q for q in quotas if q["start_date"] == source["start_date"][:10] and q["end_date"] == source_end]
    if len(matching) != 1:
        reject("تعذر تحديد رصيد المصدر")
    balance = matching[0]["remaining"]
    amount = payload["sessions"]
    if amount < 1 or amount > balance:
        reject("عدد الحصص أكبر من المتبقي أو غير صالح")
    recipient_balance = 0
    recipient_end = source_end
    if target:
        dest = target[0]
        recipient_end = effective_transfer_end(dest)
        if (dest.get("status", "active") != "active"
                or not dest.get("start_date", "") <= today <= recipient_end):
            reject("يلزم اشتراك ساري للمستلم في النشاط نفسه")
        dest_quotas = await check_member_session_quota(recipient["id"], activity_id, session=session)
        rows = [q for q in dest_quotas if q["start_date"] == dest["start_date"][:10] and q["end_date"] == recipient_end]
        if len(rows) != 1 or rows[0]["used_sessions"] > rows[0]["total_allowed"]:
            reject("يلزم مراجعة رصيد المستلم أولًا")
        recipient_balance = rows[0]["remaining"]
    else:
        # Reject invoice-only entitlements instead of hiding their paid balance.
        if await check_member_session_quota(recipient["id"], activity_id, session=session):
            reject("يلزم ربط اشتراك المستلم القديم قبل النقل")
    recipient_schedule = target[0].get("schedule") if target else source.get("schedule")
    new_dates = next_training_dates(recipient_end, recipient_schedule, amount)
    if len(new_dates) != amount:
        reject("يلزم تحديد أيام التدريب للمستلم لإضافة تواريخ الحصص")
    public = {
        "sender_name": sender.get("name_ar") or sender.get("name"),
        "recipient_name": recipient.get("name_ar") or recipient.get("name"),
        "activity_name": source.get("activity_name"), "sessions": amount,
        "end_date": new_dates[-1], "previous_end_date": recipient_end,
        "added_dates": new_dates,
        "sender_end_date": source_end, "reason": payload["reason"].strip(),
        "sender_before": balance, "sender_after": balance - amount,
        "recipient_before": recipient_balance, "recipient_after": recipient_balance + amount,
    }
    state = {"sender": sender, "recipient": recipient, "review": public}
    public["preview_token"] = hashlib.sha256(json.dumps(state, sort_keys=True, default=str, ensure_ascii=False).encode()).hexdigest()
    return sender, recipient, source, target, public


async def confirm(db, sender_query, recipient_query, activity_id, payload, actor):
    try:
        async with await db.client.start_session() as session:
            async with session.start_transaction(read_concern=ReadConcern("snapshot"), write_concern=WriteConcern("majority")):
                sender, recipient, source, target, review = await preview(db, sender_query, recipient_query, activity_id, payload, session)
                if payload.get("preview_token") != review["preview_token"]:
                    reject("تغير الرصيد أو الاشتراك؛ أعد المراجعة")
                transfer_id = str(uuid.uuid4())
                for member, delta in ((sender, -payload["sessions"]), (recipient, payload["sessions"])):
                    activities = copy.deepcopy(member.get("activities", []))
                    matches = [a for a in activities if a.get("activity_id") == activity_id]
                    if matches:
                        act = matches[0]
                    else:
                        act = {k: copy.deepcopy(source.get(k)) for k in ("activity_id", "activity_name", "end_date", "schedule", "training_days", "training_time", "day_times")}
                        act.update(start_date=datetime.now(timezone(timedelta(hours=3))).date().isoformat(), status="active", source="session_transfer", source_id=transfer_id, fee=0, level_id="", coach_id="")
                        activities.append(act)
                    if delta > 0:
                        existing_dates = transfer_dates(act)
                    act["session_transfer_delta"] = int(act.get("session_transfer_delta") or 0) + delta
                    if delta > 0:
                        act["session_transfer_dates"] = sorted(set(existing_dates + review["added_dates"]))
                        act["end_date"] = review["end_date"]
                    result = await db.members.update_one({"id": member["id"], "activities": member.get("activities", [])}, {"$set": {"activities": activities}}, session=session)
                    if result.matched_count != 1:
                        reject("تغير الاشتراك؛ أعد المراجعة")
                await db.session_transfers.insert_one({"id": transfer_id, "sender_id": sender["id"], "recipient_id": recipient["id"], "activity_id": activity_id, **review, "actor_id": actor.get("user_id") or actor.get("id"), "actor_name": actor.get("username"), "created_at": datetime.now(timezone.utc).isoformat()}, session=session)
                for member, side, other in ((sender, "sender", recipient), (recipient, "recipient", sender)):
                    await db.audit_logs.insert_one({
                        "id": f"{transfer_id}:{side}", "member_id": member["id"],
                        "action": "subscription.session_transfer", "entity_type": "member_activity",
                        "entity_id": f"{member['id']}:{activity_id}", "entity_name": review["activity_name"],
                        "actor_id": actor.get("user_id") or actor.get("id"), "actor_username": actor.get("username"),
                        "branch_id": member.get("branch_id"), "created_at": datetime.now(timezone.utc).isoformat(),
                        "diff": {"remaining_sessions": {"before": review[f"{side}_before"], "after": review[f"{side}_after"]},
                                 "transfer_reason": {"before": "", "after": review["reason"]},
                                 "transfer_member": {"before": "", "after": other.get("name_ar") or other.get("name")}},
                        "extra": {"transfer_id": transfer_id, "sessions": payload["sessions"], "end_date": review["end_date"]},
                    }, session=session)
                return {"id": transfer_id, **review}
    except OperationFailure as exc:
        if exc.code in (20, 263, 303):
            raise HTTPException(503, detail="الحفظ الذري غير متاح؛ لم يتم نقل الحصص") from exc
        if exc.has_error_label("TransientTransactionError") or exc.code in (112, 244, 251):
            reject("تغيرت البيانات؛ أعد المراجعة")
        raise
