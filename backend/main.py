import asyncio
import os
import sys
import uvicorn

backend_dir = os.path.dirname(os.path.abspath(__file__))
os.chdir(backend_dir)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

LOADING_HTML = """<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Champions Academy</title>
<style>body{margin:0;background:#0a0a0a;color:#d4a017;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif}
.loader{text-align:center}.spinner{width:40px;height:40px;border:4px solid #333;border-top:4px solid #d4a017;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 16px}
@keyframes spin{to{transform:rotate(360deg)}}p{font-size:18px}</style></head>
<body><div class="loader"><div class="spinner"></div><p>\u062c\u0627\u0631\u064a \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u062a\u0637\u0628\u064a\u0642...</p></div>
<script>setTimeout(function(){location.reload()},3000)</script></body></html>""".encode("utf-8")


class QuickStartApp:
    def __init__(self):
        self.real_app = None

    async def __call__(self, scope, receive, send):
        if scope["type"] == "lifespan":
            msg = await receive()
            if msg["type"] == "lifespan.startup":
                asyncio.create_task(self._load_real_app())
                await send({"type": "lifespan.startup.complete"})
            msg = await receive()
            if msg["type"] == "lifespan.shutdown":
                await send({"type": "lifespan.shutdown.complete"})
            return

        if scope["type"] == "http":
            if self.real_app:
                await self.real_app(scope, receive, send)
                return

            await receive()
            path = scope.get("path", "/")
            if path == "/health" or path == "/__repl":
                await send({
                    "type": "http.response.start",
                    "status": 200,
                    "headers": [[b"content-type", b"application/json"], [b"content-length", b"15"]],
                })
                await send({"type": "http.response.body", "body": b'{"status":"ok"}'})
            else:
                body = LOADING_HTML
                await send({
                    "type": "http.response.start",
                    "status": 200,
                    "headers": [[b"content-type", b"text/html; charset=utf-8"], [b"content-length", str(len(body)).encode()]],
                })
                await send({"type": "http.response.body", "body": body})

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
