import os
import sys

backend_dir = os.path.dirname(os.path.abspath(__file__))
os.chdir(backend_dir)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

_real_app = None
_index_html = None

_static_index = os.path.join(backend_dir, "static", "index.html")
if os.path.exists(_static_index):
    with open(_static_index, "rb") as f:
        _index_html = f.read()
    _index_len = str(len(_index_html)).encode()


def _get_real_app():
    global _real_app
    if _real_app is None:
        from server import app
        _real_app = app
        print("Full application loaded!", flush=True)
    return _real_app


async def app(scope, receive, send):
    if scope["type"] == "lifespan":
        msg = await receive()
        if msg["type"] == "lifespan.startup":
            await send({"type": "lifespan.startup.complete"})
        msg = await receive()
        if msg["type"] == "lifespan.shutdown":
            await send({"type": "lifespan.shutdown.complete"})
        return

    if scope["type"] != "http":
        return

    if _real_app is not None:
        await _real_app(scope, receive, send)
        return

    path = scope.get("path", "/")

    if path == "/" or path == "/health":
        await receive()
        if path == "/health" or _index_html is None:
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
        else:
            await send({
                "type": "http.response.start",
                "status": 200,
                "headers": [
                    [b"content-type", b"text/html; charset=utf-8"],
                    [b"content-length", _index_len],
                ],
            })
            await send({
                "type": "http.response.body",
                "body": _index_html,
            })
        return

    real = _get_real_app()
    await real(scope, receive, send)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=5000, log_level="info")
