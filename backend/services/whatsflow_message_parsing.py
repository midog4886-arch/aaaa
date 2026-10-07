"""Pure parsing and privacy guards for Whatsflow/Evolution messages."""
import re
from pathlib import Path
from typing import Optional
from urllib.parse import quote


def _strict_provider_bool(value: object) -> Optional[bool]:
    """Accept only JSON booleans and Evolution's canonical string form."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized == "true":
            return True
        if normalized == "false":
            return False
    return None


def _provider_from_me(key: dict, data: dict) -> Optional[bool]:
    """Resolve duplicate provider fields only when all evidence agrees."""
    values = []
    if "fromMe" in key:
        values.append(key.get("fromMe"))
    if "fromMe" in data:
        values.append(data.get("fromMe"))
    if not values:
        return None
    normalized = [_strict_provider_bool(value) for value in values]
    if any(value is None for value in normalized) or len(set(normalized)) != 1:
        return None
    return normalized[0]


def _normalize_whatsflow_message(message: dict) -> dict:
    """Unwrap non-private Evolution message containers.

    Evolution nests captioned documents and disappearing messages one level
    down.  View-once containers are intentionally not traversed: retrieving
    their media later would defeat the sender's privacy choice.
    """
    current = message if isinstance(message, dict) else {}
    for _ in range(4):
        if any(key in current for key in (
            "viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension",
        )):
            return current
        nested = None
        for container in ("ephemeralMessage", "documentWithCaptionMessage"):
            value = current.get(container)
            if isinstance(value, dict) and isinstance(value.get("message"), dict):
                nested = value["message"]
                break
        if nested is None:
            return current
        current = nested
    return current


WHATSFLOW_TEXT_MAX_CHARS = 65536


def _bounded_message_text(value: object) -> str:
    """Return text only; provider objects must never become stored body text."""
    if not isinstance(value, str):
        return ""
    return value[:WHATSFLOW_TEXT_MAX_CHARS]


def _whatsflow_text_field(value: object) -> str:
    """Accept Evolution's explicit text forms, without recursive traversal."""
    if isinstance(value, str):
        return _bounded_message_text(value)
    if isinstance(value, dict):
        return _bounded_message_text(value.get("body"))
    return ""


def _extract_whatsflow_body(raw_message: object, data: object = None) -> str:
    """Extract only documented, non-private Evolution text locations.

    Only ephemeral/document caption wrappers are normalized.  In particular,
    this deliberately does not recurse through quoted/context messages and
    refuses all view-once wrappers.
    """
    if not isinstance(raw_message, dict):
        raw_message = {}
    if _provider_marks_view_once(raw_message):
        return ""
    message = _normalize_whatsflow_message(raw_message)
    if any(key in message for key in (
        "viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension",
    )):
        return ""

    extended = message.get("extendedTextMessage")
    extended_text = (
        _bounded_message_text(extended.get("text"))
        if isinstance(extended, dict)
        else ""
    )
    media_caption = ""
    for key in ("imageMessage", "documentMessage", "audioMessage", "videoMessage"):
        media = message.get(key)
        if isinstance(media, dict):
            media_caption = _bounded_message_text(media.get("caption"))
            if media_caption:
                break

    data = data if isinstance(data, dict) else {}
    candidates = (
        _bounded_message_text(message.get("conversation")),
        extended_text,
        _whatsflow_text_field(message.get("text")),
        media_caption,
        _whatsflow_text_field(data.get("text")),
        _bounded_message_text(data.get("body")),
    )
    return next((text for text in candidates if text), "")


def _whatsflow_media_headers(filename: str, mime_type: str) -> dict:
    """Build an RFC 5987 disposition without reflecting unsafe filenames."""
    name = Path(str(filename or "attachment").replace("\\", "/")).name
    name = "".join(char for char in name if char.isprintable() and char not in "\r\n")
    name = name.strip()[:180] or "attachment"
    ascii_name = re.sub(r"[^A-Za-z0-9._-]", "_", name).strip("._") or "attachment"
    disposition = "inline" if (
        mime_type.startswith(("audio/", "video/"))
        or mime_type in {"image/jpeg", "image/png", "image/gif", "image/webp"}
    ) else "attachment"
    return {
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "Content-Disposition": (
            f"{disposition}; filename=\"{ascii_name}\"; "
            f"filename*=UTF-8''{quote(name, safe='')}"
        ),
    }


def _is_inbound_attachment(message: dict) -> bool:
    """Only ordinary inbound media is eligible; view-once never enters storage."""
    return bool(
        message.get("direction") == "inbound"
        and message.get("type") in {"image", "audio", "video", "document"}
        and (message.get("media_id") or message.get("media_url")
             or (message.get("provider") == "whatsflow" and message.get("provider_message_id")))
        and not message.get("view_once")
    )


def _provider_marks_view_once(value: object, depth: int = 0) -> bool:
    """Read provider view-once wrappers without traversing arbitrary payloads."""
    if not isinstance(value, dict) or depth > 4:
        return False
    if any(value.get(key) is True for key in ("view_once", "viewOnce", "isViewOnce")):
        return True
    if any(key in value for key in (
        "viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension",
    )):
        return True
    return any(_provider_marks_view_once(value.get(key), depth + 1)
               for key in ("message", "_data", "media", "imageMessage",
                           "videoMessage", "audioMessage", "documentMessage"))


def _archive_pending_fields(message: dict) -> dict:
    if not _is_inbound_attachment(message):
        return message
    return {
        **message, "archive_status": "pending", "archive_error": None,
    }
