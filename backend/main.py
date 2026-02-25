import asyncio
import threading
import os

_real_app = None
_loaded = asyncio.Event()


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


_OK_BODY = b'{"status":"ok"}'
_OK_HEADERS = [
    [b"content-type", b"application/json"],
    [b"content-length", b"15"],
]
_503_BODY = b'{"error":"loading"}'
_503_HEADERS = [
    [b"content-type", b"application/json"],
    [b"content-length", b"19"],
]

_startup_done = False


async def app(scope, receive, send):
    global _startup_done

    if scope["type"] == "lifespan":
        msg = await receive()
        if msg["type"] == "lifespan.startup":
            loop = asyncio.get_running_loop()

            def load_and_signal():
                _do_load()
                loop.call_soon_threadsafe(_loaded.set)

            t = threading.Thread(target=load_and_signal, daemon=True)
            t.start()
            _startup_done = True
            await send({"type": "lifespan.startup.complete"})

        msg = await receive()
        if msg["type"] == "lifespan.shutdown":
            await send({"type": "lifespan.shutdown.complete"})
        return

    if scope["type"] != "http":
        return

    path = scope.get("path", "")

    if path == "/" or path == "/health":
        await send({"type": "http.response.start", "status": 200, "headers": _OK_HEADERS})
        await send({"type": "http.response.body", "body": _OK_BODY})
        return

    if _real_app is not None:
        await _real_app(scope, receive, send)
        return

    try:
        await asyncio.wait_for(_loaded.wait(), timeout=30)
    except asyncio.TimeoutError:
        pass

    if _real_app is not None:
        await _real_app(scope, receive, send)
    else:
        await send({"type": "http.response.start", "status": 503, "headers": _503_HEADERS})
        await send({"type": "http.response.body", "body": _503_BODY})
