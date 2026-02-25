import asyncio

class HealthCheckWrapper:
    def __init__(self):
        self._app = None
        self._loading = False

    async def _load_app(self):
        if self._app is None and not self._loading:
            self._loading = True
            from server import app as real_app
            self._app = real_app
            self._loading = False

    async def __call__(self, scope, receive, send):
        if scope["type"] == "lifespan":
            if self._app is None:
                await self._load_app()
            if self._app:
                await self._app(scope, receive, send)
            return

        if scope["type"] == "http" and scope.get("path") in ("/", "/health"):
            body = b'{"status":"ok"}'
            await send({
                "type": "http.response.start",
                "status": 200,
                "headers": [
                    [b"content-type", b"application/json"],
                    [b"content-length", str(len(body)).encode()],
                ],
            })
            await send({"type": "http.response.body", "body": body})
            return

        if self._app is None:
            await self._load_app()

        if self._app:
            await self._app(scope, receive, send)
        else:
            body = b'{"status":"loading"}'
            await send({
                "type": "http.response.start",
                "status": 503,
                "headers": [
                    [b"content-type", b"application/json"],
                    [b"content-length", str(len(body)).encode()],
                ],
            })
            await send({"type": "http.response.body", "body": body})

app = HealthCheckWrapper()
