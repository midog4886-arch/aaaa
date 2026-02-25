import threading

_real_app = None
_lock = threading.Lock()

def _get_real_app():
    global _real_app
    if _real_app is None:
        with _lock:
            if _real_app is None:
                from server import app as loaded
                _real_app = loaded
    return _real_app

async def app(scope, receive, send):
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

    real = _get_real_app()
    await real(scope, receive, send)
