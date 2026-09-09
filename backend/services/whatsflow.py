"""Focused client for the Whatsflow HTTP API."""
import base64
import binascii
from typing import Any, Optional
from urllib.parse import quote

import httpx


class WhatsflowClient:
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