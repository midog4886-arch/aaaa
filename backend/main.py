import os
import sys
import asyncio
import logging
import urllib.request

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("main")

backend_dir = os.path.dirname(os.path.abspath(__file__))
os.chdir(backend_dir)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

_real_app = None
_loading = False
_index_html = b"<html><body>Loading...</body></html>"
_index_len = str(len(_index_html)).encode()
_index_ct = b"text/html; charset=utf-8"

KEEP_ALIVE_URL = "https://adaa-alabtal.replit.app/health"
KEEP_ALIVE_INTERVAL = 240

_static_index = os.path.join(backend_dir, "static", "index.html")
if os.path.exists(_static_index):
    with open(_static_index, "rb") as f:
        _index_html = f.read()
    _index_len = str(len(_index_html)).encode()

logger.info("Lightweight wrapper ready")


def _load_real_app():
    global _real_app, _loading
    if _real_app is not None:
        return _real_app
    if _loading:
        return None
    _loading = True
    try:
        from server import app as real
        _real_app = real
        logger.info("Full application loaded successfully!")
        return _real_app
    except Exception as e:
        logger.error(f"Failed to load app: {e}")
        _loading = False
        return None


async def _keep_alive_loop():
    await asyncio.sleep(30)
    logger.info(f"Keep-alive started: pinging {KEEP_ALIVE_URL} every {KEEP_ALIVE_INTERVAL}s")
    while True:
        try:
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(
                None,
                lambda: urllib.request.urlopen(KEEP_ALIVE_URL, timeout=10).read()
            )
            logger.info("Keep-alive ping OK")
        except Exception as e:
            logger.warning(f"Keep-alive ping failed: {e}")
        await asyncio.sleep(KEEP_ALIVE_INTERVAL)


async def _send_200_html(receive, send):
    await receive()
    await send({
        "type": "http.response.start",
        "status": 200,
        "headers": [
            [b"content-type", _index_ct],
            [b"content-length", _index_len],
        ],
    })
    await send({
        "type": "http.response.body",
        "body": _index_html,
    })


async def _send_200_json(receive, send):
    await receive()
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


async def _send_503(receive, send):
    await receive()
    body = b'{"detail":"Loading, please retry"}'
    await send({
        "type": "http.response.start",
        "status": 503,
        "headers": [
            [b"content-type", b"application/json"],
            [b"content-length", str(len(body)).encode()],
            [b"retry-after", b"2"],
        ],
    })
    await send({
        "type": "http.response.body",
        "body": body,
    })


async def app(scope, receive, send):
    if scope["type"] == "lifespan":
        while True:
            msg = await receive()
            if msg["type"] == "lifespan.startup":
                await send({"type": "lifespan.startup.complete"})
                loop = asyncio.get_running_loop()
                loop.run_in_executor(None, _load_real_app)
                asyncio.ensure_future(_keep_alive_loop())
            elif msg["type"] == "lifespan.shutdown":
                await send({"type": "lifespan.shutdown.complete"})
                return
        return

    if scope["type"] != "http":
        return

    path = scope.get("path", "/")

    if _real_app is not None:
        await _real_app(scope, receive, send)
        return

    if path == "/":
        await _send_200_html(receive, send)
        return

    if path == "/health":
        await _send_200_json(receive, send)
        return

    real = _load_real_app()
    if real is not None:
        await real(scope, receive, send)
    else:
        await _send_503(receive, send)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=5000, log_level="info")
