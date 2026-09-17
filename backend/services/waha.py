"""Small, provider-specific client for the WAHA HTTP API.

The client deliberately returns normalized results and never returns request
headers/configuration, so callers cannot accidentally expose the API key.
"""
import base64
import os
from typing import Any, Optional

import httpx


class WAHAClient:
    def __init__(self, base_url: Optional[str] = None, api_key: Optional[str] = None):
        self.base_url = (base_url or os.environ.get("WAHA_BASE_URL") or "").rstrip("/")
        self.api_key = api_key if api_key is not None else os.environ.get("WAHA_API_KEY", "")

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.api_key)

    def _headers(self) -> dict:
        if not self.configured:
            raise RuntimeError("WAHA is not configured")
        return {"X-Api-Key": self.api_key}

    async def _request(self, method: str, path: str, **kwargs) -> tuple[bool, Any, Optional[str]]:
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                headers = self._headers()
                headers.update(kwargs.pop("headers", {}))
                response = await client.request(method, f"{self.base_url}{path}", headers=headers, **kwargs)
            if not 200 <= response.status_code < 300:
                return False, None, f"http_{response.status_code}"
            try:
                return True, response.json(), None
            except ValueError:
                return True, response.content, None
        except Exception as exc:
            return False, None, type(exc).__name__

    async def sessions(self):
        return await self._request("GET", "/api/sessions")

    async def session(self, name: str):
        return await self._request("GET", f"/api/sessions/{name}")

    async def create_session(self, payload: dict):
        return await self._request("POST", "/api/sessions", json=payload)

    async def lifecycle(self, name: str, action: str):
        if action not in {"start", "stop", "restart"}:
            raise ValueError("Unsupported WAHA lifecycle action")
        return await self._request("POST", f"/api/sessions/{name}/{action}")

    async def logout(self, name: str):
        return await self._request("POST", "/api/sessions/logout", json={"session": name})

    async def qr(self, name: str):
        return await self._request(
            "POST", f"/api/{name}/auth/qr", headers={"Accept": "image/png"}
        )

    async def send_text(self, session: str, chat_id: str, text: str):
        return await self._request("POST", "/api/sendText", json={
            "session": session, "chatId": chat_id, "text": text,
        })

    async def send_media(self, session: str, chat_id: str, content: bytes,
                         mime_type: str, filename: str, caption: str = "",
                         image: bool = False):
        return await self._request("POST", "/api/sendImage" if image else "/api/sendFile", json={
            "session": session, "chatId": chat_id,
            "file": {"data": base64.b64encode(content).decode("ascii"),
                     "mimetype": mime_type, "filename": filename},
            "caption": caption,
        })

    async def send_voice(self, session: str, chat_id: str, content: bytes,
                         mime_type: str, filename: str):
        """Use WAHA's dedicated voice endpoint, rather than sendFile."""
        return await self._request("POST", "/api/sendVoice", json={
            "session": session, "chatId": chat_id,
            "file": {
                "data": base64.b64encode(content).decode("ascii"),
                "mimetype": mime_type,
                "filename": filename,
            },
            "convert": False,
        })