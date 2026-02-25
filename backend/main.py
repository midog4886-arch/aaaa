import os
import sys
import asyncio

backend_dir = os.path.dirname(os.path.abspath(__file__))
os.chdir(backend_dir)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, FileResponse
from starlette.middleware.cors import CORSMiddleware
from pathlib import Path
import threading

print("main.py: Starting lightweight app...", flush=True)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_real_app = None
_real_app_ready = asyncio.Event()
STATIC_DIR = Path(backend_dir) / "static"


@app.get("/")
async def root():
    if STATIC_DIR.exists() and (STATIC_DIR / "index.html").exists():
        return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-cache"})
    return JSONResponse({"status": "ok"})


@app.get("/health")
async def health():
    return JSONResponse({"status": "ok"})


def _background_load():
    global _real_app
    try:
        print("main.py: Loading full application...", flush=True)
        from server import app as full_app
        _real_app = full_app
        print("main.py: Full application loaded!", flush=True)
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"main.py: LOAD ERROR: {e}", flush=True)


@app.on_event("startup")
async def on_startup():
    print("main.py: Startup event fired", flush=True)
    loop = asyncio.get_running_loop()
    def load_and_signal():
        _background_load()
        loop.call_soon_threadsafe(_real_app_ready.set)
    t = threading.Thread(target=load_and_signal, daemon=True)
    t.start()


@app.middleware("http")
async def forward_to_real_app(request: Request, call_next):
    path = request.url.path
    if path == "/" or path == "/health":
        return await call_next(request)
    if _real_app is None:
        try:
            await asyncio.wait_for(_real_app_ready.wait(), timeout=25)
        except asyncio.TimeoutError:
            return JSONResponse({"error": "app loading"}, status_code=503)
    if _real_app is not None:
        scope = request.scope
        resp_started = False
        status_code = 200
        resp_headers = []
        body_parts = []

        async def receive():
            body = await request.body()
            return {"type": "http.request", "body": body, "more_body": False}

        async def send(message):
            nonlocal resp_started, status_code, resp_headers
            if message["type"] == "http.response.start":
                resp_started = True
                status_code = message["status"]
                resp_headers = message.get("headers", [])
            elif message["type"] == "http.response.body":
                body_parts.append(message.get("body", b""))

        await _real_app(scope, receive, send)

        from starlette.responses import Response
        headers_dict = {}
        for k, v in resp_headers:
            key = k.decode("utf-8") if isinstance(k, bytes) else k
            val = v.decode("utf-8") if isinstance(v, bytes) else v
            headers_dict[key] = val

        return Response(
            content=b"".join(body_parts),
            status_code=status_code,
            headers=headers_dict,
        )

    return JSONResponse({"error": "app not ready"}, status_code=503)
