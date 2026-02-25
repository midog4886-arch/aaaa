import threading

_real_app = None
_loaded = threading.Event()


def _do_load():
    global _real_app
    try:
        from server import app as full_app
        _real_app = full_app
    except Exception as e:
        import traceback
        traceback.print_exc()
    finally:
        _loaded.set()


_OK_BODY = b'{"status":"ok"}'
_OK_HEADERS = [
    [b"content-type", b"application/json"],
    [b"content-length", b"15"],
]


async def app(scope, receive, send):
    if scope["type"] == "lifespan":
        msg = await receive()
        if msg["type"] == "lifespan.startup":
            t = threading.Thread(target=_do_load, daemon=True)
            t.start()
            await send({"type": "lifespan.startup.complete"})
        msg = await receive()
        if msg["type"] == "lifespan.shutdown":
            await send({"type": "lifespan.shutdown.complete"})
        return

    if scope["type"] == "http":
        path = scope.get("path", "")
        if path == "/" or path == "/health":
            await send({"type": "http.response.start", "status": 200, "headers": _OK_HEADERS})
            await send({"type": "http.response.body", "body": _OK_BODY})
            return

        if not _loaded.is_set():
            _loaded.wait(timeout=30)

        if _real_app is not None:
            await _real_app(scope, receive, send)
        else:
            body = b'{"error":"app failed to load"}'
            await send({
                "type": "http.response.start",
                "status": 503,
                "headers": [[b"content-type", b"application/json"], [b"content-length", str(len(body)).encode()]],
            })
            await send({"type": "http.response.body", "body": body})
