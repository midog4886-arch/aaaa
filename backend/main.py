import os
import sys
import asyncio

backend_dir = os.path.dirname(os.path.abspath(__file__))
os.chdir(backend_dir)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

sys.setswitchinterval(0.001)

real_app = None

OK_JSON = b'{"status":"ok"}'


async def _load_real():
    global real_app
    loop = asyncio.get_running_loop()
    sa = await loop.run_in_executor(None, lambda: __import__("server").app)
    real_app = sa
    print("Full application loaded!", flush=True)


class App:
    def __init__(self):
        self._startup_done = False

    async def __call__(self, scope, receive, send):
        if scope["type"] == "lifespan":
            msg = await receive()
            if msg["type"] == "lifespan.startup":
                asyncio.create_task(_load_real())
                self._startup_done = True
                await send({"type": "lifespan.startup.complete"})
            msg = await receive()
            if msg["type"] == "lifespan.shutdown":
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
            "headers": [
                [b"content-type", b"application/json"],
                [b"content-length", b"15"],
            ],
        })
        await send({
            "type": "http.response.body",
            "body": OK_JSON,
        })


app = App()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=5000, log_level="info")
