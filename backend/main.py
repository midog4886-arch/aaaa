import asyncio
import os
import sys
import uvicorn

backend_dir = os.path.dirname(os.path.abspath(__file__))
os.chdir(backend_dir)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)


class QuickStartApp:
    def __init__(self):
        self.real_app = None
        self._loading = False

    async def __call__(self, scope, receive, send):
        if scope["type"] == "lifespan":
            msg = await receive()
            if msg["type"] == "lifespan.startup":
                asyncio.create_task(self._load_real_app())
                await send({"type": "lifespan.startup.complete"})
            msg = await receive()
            if msg["type"] == "lifespan.shutdown":
                if self.real_app:
                    try:
                        lifespan_scope = {"type": "lifespan", "asgi": scope.get("asgi", {})}
                        shutdown_received = False

                        async def shutdown_receive():
                            nonlocal shutdown_received
                            if not shutdown_received:
                                shutdown_received = True
                                return {"type": "lifespan.startup"}
                            return {"type": "lifespan.shutdown"}

                        async def noop_send(msg):
                            pass

                    except Exception:
                        pass
                await send({"type": "lifespan.shutdown.complete"})
            return

        if scope["type"] == "http":
            if self.real_app:
                await self.real_app(scope, receive, send)
            else:
                body = await receive()
                await send({
                    "type": "http.response.start",
                    "status": 200,
                    "headers": [
                        [b"content-type", b"application/json"],
                        [b"content-length", b"15"],
                    ],
                })
                await send({
                    "type": "http.response.body",
                    "body": b'{"status":"ok"}',
                })

    async def _load_real_app(self):
        loop = asyncio.get_running_loop()

        def do_import():
            from server import app
            return app

        self.real_app = await loop.run_in_executor(None, do_import)
        print("Full application loaded!", flush=True)


app = QuickStartApp()

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=5000, log_level="info")
