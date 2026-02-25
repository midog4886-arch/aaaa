import threading

_real_app = None
_loading_done = threading.Event()


def _background_load():
    global _real_app
    from server import app as loaded
    _real_app = loaded
    _loading_done.set()


async def app(scope, receive, send):
    if scope["type"] == "lifespan":
        while True:
            message = await receive()
            if message["type"] == "lifespan.startup":
                t = threading.Thread(target=_background_load, daemon=True)
                t.start()
                await send({"type": "lifespan.startup.complete"})
            elif message["type"] == "lifespan.shutdown":
                await send({"type": "lifespan.shutdown.complete"})
                return
            else:
                return
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

    _loading_done.wait(timeout=30)
    if _real_app is not None:
        await _real_app(scope, receive, send)
    else:
        body = b'{"error":"app loading"}'
        await send({
            "type": "http.response.start",
            "status": 503,
            "headers": [
                [b"content-type", b"application/json"],
                [b"content-length", str(len(body)).encode()],
            ],
        })
        await send({"type": "http.response.body", "body": body})
