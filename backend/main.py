import os
import sys
import asyncio
import threading

backend_dir = os.path.dirname(os.path.abspath(__file__))
os.chdir(backend_dir)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

real_app = None
_load_done = threading.Event()


def _load_server():
    global real_app
    try:
        from server import app as sa
        real_app = sa
        print("Full application loaded!", flush=True)
    except Exception as e:
        print(f"Failed to load server: {e}", flush=True)
    finally:
        _load_done.set()


_thread = threading.Thread(target=_load_server, daemon=True)
_thread.start()

OK_BODY = b'{"status":"ok"}'
OK_HEADERS = [
    [b"content-type", b"application/json"],
    [b"content-length", b"15"],
    [b"connection", b"close"],
]
INDEX_PATH = os.path.join(backend_dir, "static", "index.html")


async def app(scope, receive, send):
    if scope["type"] == "lifespan":
        msg = await receive()
        await send({"type": "lifespan.startup.complete"})
        msg = await receive()
        await send({"type": "lifespan.shutdown.complete"})
        return

    if scope["type"] != "http":
        return

    if real_app is not None:
        await real_app(scope, receive, send)
        return

    await receive()
    await send({
        "type": "http.response.start",
        "status": 200,
        "headers": OK_HEADERS,
    })
    await send({
        "type": "http.response.body",
        "body": OK_BODY,
    })


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=5000, log_level="info")
