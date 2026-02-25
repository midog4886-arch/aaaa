from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route, Mount
import threading
import sys
import os

_real_app = None
_loaded = threading.Event()


def _do_load():
    global _real_app
    try:
        os.chdir(os.path.dirname(os.path.abspath(__file__)))
        from server import app as full_app
        _real_app = full_app
        print("Full application loaded successfully", flush=True)
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"LOAD ERROR: {e}", flush=True)
    finally:
        _loaded.set()


async def health(request):
    return JSONResponse({"status": "ok"})


async def catch_all(request):
    if not _loaded.is_set():
        _loaded.wait(timeout=30)
    if _real_app is not None:
        scope = request.scope
        await _real_app(scope, request.receive, request._send)
    else:
        return JSONResponse({"error": "app not ready"}, status_code=503)


async def on_startup():
    t = threading.Thread(target=_do_load, daemon=True)
    t.start()


routes = [
    Route("/", health),
    Route("/health", health),
]

app = Starlette(routes=routes, on_startup=[on_startup])


from starlette.middleware import Middleware
from starlette.types import ASGIApp, Receive, Scope, Send


class ForwardMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] == "http":
            path = scope.get("path", "")
            if path not in ("/", "/health"):
                if not _loaded.is_set():
                    _loaded.wait(timeout=30)
                if _real_app is not None:
                    await _real_app(scope, receive, send)
                    return
                else:
                    body = b'{"error":"app not ready"}'
                    await send({
                        "type": "http.response.start",
                        "status": 503,
                        "headers": [[b"content-type", b"application/json"],
                                    [b"content-length", str(len(body)).encode()]],
                    })
                    await send({"type": "http.response.body", "body": body})
                    return
        await self.app(scope, receive, send)


app.add_middleware(ForwardMiddleware)
