"""Focused client for the Whatsflow HTTP API."""
import base64
import binascii
import re
from typing import Any, Optional
from urllib.parse import quote

import httpx


class WhatsflowClient:
    MAX_MEDIA_BYTES = 20 * 1024 * 1024
    MAX_HISTORY_RECORDS = 1
    MAX_CONVERSATION_HISTORY_RECORDS = 50
    _MIME_TYPE_RE = re.compile(
        r"^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+$"
    )

    def __init__(
        self,
        instance: str,
        api_key: str,
        base_url: str = "https://connect.whats-flow.net",
    ):
        self.instance = instance.strip()
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")

    @property
    def configured(self) -> bool:
        return bool(self.instance and self.api_key)

    def _headers(self) -> dict:
        if not self.configured:
            raise RuntimeError("Whatsflow is not configured")
        return {"apikey": self.api_key}

    async def _request(self, method: str, path: str, **kwargs) -> tuple[bool, Any, Optional[str]]:
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                headers = self._headers()
                headers.update(kwargs.pop("headers", {}))
                response = await client.request(
                    method, f"{self.base_url}{path}", headers=headers, **kwargs
                )
            if not 200 <= response.status_code < 300:
                return False, None, f"http_{response.status_code}"
            try:
                return True, response.json(), None
            except ValueError:
                return True, response.content, None
        except Exception as exc:
            return False, None, type(exc).__name__

    def _instance_path(self) -> str:
        return quote(self.instance, safe="")

    async def connection_state(self):
        return await self._request("GET", f"/instance/connectionState/{self._instance_path()}")

    async def qr(self):
        ok, data, error = await self._request(
            "GET", f"/instance/connect/{self._instance_path()}"
        )
        if not ok:
            return ok, data, error
        value = data
        if isinstance(data, dict):
            value = data.get("base64") or data.get("qrcode") or data.get("qr")
            if isinstance(value, dict):
                value = value.get("base64")
        if isinstance(value, str):
            value = value.split(",", 1)[-1]
            try:
                return True, base64.b64decode(value, validate=True), None
            except (ValueError, binascii.Error):
                return False, None, "invalid_qr"
        return False, None, "invalid_qr"

    async def send_text(self, number: str, text: str, delay: int = 0, link_preview: bool = False):
        return await self._request(
            "POST",
            f"/message/sendText/{self._instance_path()}",
            json={
                "number": "".join(filter(str.isdigit, number or "")),
                "text": text,
                "delay": delay,
                "linkPreview": link_preview,
            },
        )

    async def send_media(
        self, number: str, media_type: str, mime_type: str, caption: str,
        media: str, filename: str,
    ):
        if media_type not in {"image", "document"}:
            raise ValueError("Unsupported Whatsflow media type")
        return await self._request(
            "POST",
            f"/message/sendMedia/{self._instance_path()}",
            json={
                "number": "".join(filter(str.isdigit, number or "")),
                "mediatype": media_type,
                "mimetype": mime_type,
                "caption": caption,
                "media": media,
                "fileName": filename,
            },
        )

    async def send_whatsapp_audio(self, number: str, audio: str, delay: int = 0):
        """Send a push-to-talk voice note through Evolution's audio endpoint.

        Whatsflow exposes Evolution's ``sendWhatsAppAudio`` endpoint separately
        from ``sendMedia``.  In particular, sending an OGG as generic media
        does not mark it as a WhatsApp voice note.
        """
        return await self._request(
            "POST",
            f"/message/sendWhatsAppAudio/{self._instance_path()}",
            json={
                "number": "".join(filter(str.isdigit, number or "")),
                "audio": audio,
                "delay": delay,
            },
        )

    @classmethod
    def _decode_provider_media(cls, data: Any) -> tuple[bool, Any, Optional[str]]:
        """Validate Evolution's decrypted-media response before returning bytes."""
        if not isinstance(data, dict):
            return False, None, "invalid_media_response"
        encoded = data.get("base64")
        if not isinstance(encoded, str) or not encoded:
            return False, None, "invalid_media_response"
        # Reject oversized base64 before decoding so a provider response cannot
        # allocate an unbounded byte buffer in the API process.
        max_encoded = ((cls.MAX_MEDIA_BYTES + 2) // 3) * 4
        if len(encoded) > max_encoded:
            return False, None, "media_too_large"
        try:
            content = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error):
            return False, None, "invalid_media_base64"
        if not content or len(content) > cls.MAX_MEDIA_BYTES:
            return False, None, "media_too_large" if len(content) > cls.MAX_MEDIA_BYTES else "invalid_media_response"

        # Do not reflect an arbitrary provider string into Content-Type.
        mime_type = str(data.get("mimetype") or "").split(";", 1)[0].strip().lower()
        if not cls._MIME_TYPE_RE.fullmatch(mime_type):
            return False, None, "invalid_media_mime"
        return True, {
            "content": content,
            "mime_type": mime_type,
            "filename": str(data.get("fileName") or data.get("filename") or ""),
            "media_type": str(data.get("mediaType") or ""),
        }, None

    async def get_base64_from_media_message(self, provider_message_id: str):
        """Ask Evolution to decrypt a message it has stored.

        WhatsApp CDN media URLs carry encrypted blobs.  This endpoint is the
        provider-supported retrieval path and deliberately never follows those
        URLs directly.
        """
        if not provider_message_id:
            return False, None, "missing_message_id"
        ok, data, error = await self._request(
            "POST",
            f"/chat/getBase64FromMediaMessage/{self._instance_path()}",
            json={
                "message": {"key": {"id": provider_message_id}},
                "convertToMp4": False,
            },
        )
        if not ok:
            return False, None, error
        return self._decode_provider_media(data)

    async def find_message(self, provider_message_id: str, from_me: bool):
        """Read one exact message from Evolution's persisted message history.

        Evolution API 2.3.7 implements ``chat/findMessages`` as a Prisma read
        ordered by message timestamp.  Supplying the provider key and an
        offset of one keeps this recovery lookup both exact and bounded.
        """
        if not provider_message_id:
            return False, None, "missing_message_id"
        ok, data, error = await self._request(
            "POST",
            f"/chat/findMessages/{self._instance_path()}",
            json={
                "where": {
                    "key": {
                        "id": provider_message_id,
                        "fromMe": from_me,
                    }
                },
                "page": 1,
                "offset": self.MAX_HISTORY_RECORDS,
            },
        )
        if not ok:
            return False, None, error
        records = (
            data.get("messages", {}).get("records")
            if isinstance(data, dict)
            and isinstance(data.get("messages"), dict)
            else None
        )
        if not isinstance(records, list) or len(records) != 1:
            return False, None, "message_not_found"
        record = records[0]
        key = record.get("key") if isinstance(record, dict) else None
        if not isinstance(key, dict):
            return False, None, "invalid_history_response"
        if (
            key.get("id") != provider_message_id
            or key.get("fromMe") is not from_me
        ):
            return False, None, "history_message_mismatch"
        return True, record, None

    async def find_messages(
        self, remote_jid: str, from_me: bool, limit: int = 50
    ):
        """Read one bounded page for an exact Evolution message key.

        Evolution API 2.3.7 supports ``key.remoteJid`` and ``key.fromMe`` in
        the same ``chat/findMessages`` where clause used by ``find_message``.
        This method deliberately exposes neither pagination nor an unbounded
        scan because phone-reply recovery only needs the latest page.
        """
        if (
            not isinstance(remote_jid, str)
            or not remote_jid
            or not isinstance(from_me, bool)
        ):
            return False, None, "invalid_history_query"
        bounded_limit = min(
            max(int(limit), 1), self.MAX_CONVERSATION_HISTORY_RECORDS
        )
        ok, data, error = await self._request(
            "POST",
            f"/chat/findMessages/{self._instance_path()}",
            json={
                "where": {
                    "key": {
                        "remoteJid": remote_jid,
                        "fromMe": from_me,
                    }
                },
                "page": 1,
                "offset": bounded_limit,
            },
        )
        if not ok:
            return False, None, error
        records = (
            data.get("messages", {}).get("records")
            if isinstance(data, dict)
            and isinstance(data.get("messages"), dict)
            else None
        )
        if not isinstance(records, list) or len(records) > bounded_limit:
            return False, None, "invalid_history_response"
        return True, records, None

    async def set_webhook(self, url: str, secret: str):
        return await self._request(
            "POST",
            f"/webhook/set/{self._instance_path()}",
            json={
                "webhook": {
                    "enabled": True,
                    "url": url,
                    "byEvents": False,
                    "base64": False,
                    "headers": {"X-Webhook-Secret": secret},
                    "events": [
                        "MESSAGES_UPSERT",
                        "MESSAGES_UPDATE",
                        "CONNECTION_UPDATE",
                    ],
                }
            },
        )