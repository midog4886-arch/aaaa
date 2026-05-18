from typing import Any

PUSH_TEMPLATES = {
    "attendance_title": {
        "ar": "✅ تم تسجيل حضورك",
        "en": "✅ Attendance recorded",
    },
    "attendance_body_with_activity": {
        "ar": "{activity} - {time}",
        "en": "{activity} - {time}",
    },
    "attendance_body_time_only": {
        "ar": "وقت الدخول: {time}",
        "en": "Check-in time: {time}",
    },
    "message_title_prefix": {
        "ar": "✉️ رسالة جديدة: {subject}",
        "en": "✉️ New message: {subject}",
    },
    "new_video_title": {
        "ar": "🎬 فيديو جديد!",
        "en": "🎬 New video!",
    },
}


def normalize_lang(lang: Any) -> str:
    if isinstance(lang, str) and lang.lower().startswith("en"):
        return "en"
    return "ar"


def t(key: str, lang: Any = "ar", **kwargs) -> str:
    template = PUSH_TEMPLATES.get(key) or {}
    text = template.get(normalize_lang(lang)) or template.get("ar") or key
    if kwargs:
        try:
            return text.format(**kwargs)
        except Exception:
            return text
    return text


async def get_member_language(db, member_id: str) -> str:
    try:
        m = await db.members.find_one(
            {"id": member_id},
            {"_id": 0, "preferred_language": 1, "preferences": 1},
        )
        if m:
            pref = m.get("preferred_language")
            if pref:
                return normalize_lang(pref)
            lang = (m.get("preferences") or {}).get("language")
            return normalize_lang(lang)
    except Exception:
        pass
    return "ar"


async def get_member_languages_map(db, member_ids):
    out = {}
    if not member_ids:
        return out
    try:
        cursor = db.members.find(
            {"id": {"$in": list(member_ids)}},
            {"_id": 0, "id": 1, "preferred_language": 1, "preferences": 1},
        )
        async for m in cursor:
            pref = m.get("preferred_language")
            if pref:
                out[m["id"]] = normalize_lang(pref)
            else:
                out[m["id"]] = normalize_lang((m.get("preferences") or {}).get("language"))
    except Exception:
        pass
    return out
