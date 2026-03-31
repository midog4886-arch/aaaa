import os
import sys
import asyncio
import logging
import urllib.request
import threading

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("main")

backend_dir = os.path.dirname(os.path.abspath(__file__))
os.chdir(backend_dir)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

_real_app = None
_app_ready = threading.Event()
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


def _start_whatsapp_service():
    import subprocess, shutil, socket as _socket
    try:
        def _port_in_use(port):
            with _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM) as s:
                return s.connect_ex(("127.0.0.1", port)) == 0
        wa_service_dir = os.path.join(backend_dir, "whatsapp_service")
        wa_service_path = os.path.join(wa_service_dir, "index.js")
        node_modules = os.path.join(wa_service_dir, "node_modules")
        if not os.path.exists(wa_service_path) or not shutil.which("node"):
            return
        # Ensure npm dependencies are installed
        if not os.path.isdir(node_modules) and shutil.which("npm"):
            logger.info("Installing WhatsApp service npm dependencies...")
            result = subprocess.run(
                ["npm", "install", "--omit=dev"],
                cwd=wa_service_dir,
                capture_output=True,
                timeout=120,
            )
            if result.returncode != 0:
                logger.warning(f"npm install failed: {result.stderr.decode()[:200]}")
                return
        if _port_in_use(3001):
            logger.info("WhatsApp service already running on port 3001")
            return
        wa_log = open(os.path.join(wa_service_dir, "service.log"), "a")
        subprocess.Popen(
            ["node", wa_service_path],
            stdout=wa_log,
            stderr=wa_log,
            cwd=wa_service_dir,
            start_new_session=True,
        )
        logger.info("WhatsApp Node.js service started")
    except Exception as e:
        logger.warning(f"Could not start WhatsApp service: {e}")


def _load_real_app_sync():
    global _real_app
    if _real_app is not None:
        return
    try:
        logger.info("Loading full application...")
        from server import app as real
        _real_app = real
        _app_ready.set()
        logger.info("Full application loaded successfully!")
    except Exception as e:
        logger.error(f"Failed to load app: {e}")
        _app_ready.set()


async def _wait_for_app():
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, lambda: _app_ready.wait(timeout=30))
    return _real_app


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


async def _send_response(receive, send, status, content_type, body):
    await receive()
    await send({
        "type": "http.response.start",
        "status": status,
        "headers": [
            [b"content-type", content_type],
            [b"content-length", str(len(body)).encode()],
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
                t = threading.Thread(target=_load_real_app_sync, daemon=True)
                t.start()
                asyncio.ensure_future(_keep_alive_loop())
                _start_whatsapp_service()
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
        await _send_response(receive, send, 200, _index_ct, _index_html)
        return

    if path == "/health":
        await _send_response(receive, send, 200, b"application/json", b'{"status":"ok"}')
        return

    await _wait_for_app()

    if _real_app is not None:
        await _real_app(scope, receive, send)
    else:
        await _send_response(receive, send, 503, b"application/json", b'{"detail":"Service unavailable"}')


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=5000, log_level="info")
