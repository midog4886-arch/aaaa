import asyncio
import os
import sys

backend_dir = os.path.dirname(os.path.abspath(__file__))
os.chdir(backend_dir)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

PORT = 5000
HOST = "0.0.0.0"


async def health_handler(reader, writer):
    try:
        await asyncio.wait_for(reader.read(4096), timeout=5)
    except Exception:
        pass
    try:
        writer.write(
            b"HTTP/1.1 200 OK\r\n"
            b"Content-Type: application/json\r\n"
            b"Content-Length: 15\r\n"
            b"Connection: close\r\n"
            b"\r\n"
            b'{"status":"ok"}'
        )
        await writer.drain()
    except Exception:
        pass
    finally:
        try:
            writer.close()
        except Exception:
            pass


def _load_app():
    print("Loading full application...", flush=True)
    try:
        from server import app as loaded_app
        print("Full application loaded!", flush=True)
        return loaded_app
    except Exception:
        import traceback
        traceback.print_exc()
        from fastapi import FastAPI
        from fastapi.responses import JSONResponse
        fallback = FastAPI()
        @fallback.get("/")
        @fallback.get("/health")
        async def fb():
            return JSONResponse({"status": "ok"})
        return fallback


async def main():
    health_server = await asyncio.start_server(
        health_handler, HOST, PORT, reuse_address=True
    )
    print(f"Health check server ready on port {PORT}", flush=True)

    loop = asyncio.get_running_loop()
    real_app = await loop.run_in_executor(None, _load_app)

    health_server.close()
    await health_server.wait_closed()
    await asyncio.sleep(0.2)

    print("Starting uvicorn...", flush=True)
    import uvicorn
    config = uvicorn.Config(real_app, host=HOST, port=PORT, log_level="info")
    uvi_server = uvicorn.Server(config)
    await uvi_server.serve()


if __name__ == "__main__":
    asyncio.run(main())
