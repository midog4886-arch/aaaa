import socket
import asyncio
import os
import sys

backend_dir = os.path.dirname(os.path.abspath(__file__))
os.chdir(backend_dir)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
sock.bind(("0.0.0.0", 5000))
sock.listen(128)
sock.setblocking(False)
print("Port 5000 bound", flush=True)


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


_real_app = None
_uvicorn_mod = None


def _load_all():
    global _real_app, _uvicorn_mod
    print("Loading full application...", flush=True)
    import uvicorn as uvi
    _uvicorn_mod = uvi
    from server import app as real
    _real_app = real
    print("Full application loaded!", flush=True)


async def main():
    health_sock = socket.socket(fileno=os.dup(sock.fileno()))
    health_sock.setblocking(False)
    health_server = await asyncio.start_server(health_handler, sock=health_sock)
    print("Health check server ready", flush=True)

    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, _load_all)

    health_server.close()
    await health_server.wait_closed()
    print("Switching to uvicorn...", flush=True)

    config = _uvicorn_mod.Config(_real_app, host="0.0.0.0", port=5000, log_level="info")
    uvi_server = _uvicorn_mod.Server(config)
    config.load()
    uvi_server.lifespan = config.lifespan_class(config)
    await uvi_server.startup(sockets=[sock])
    await uvi_server.main_loop()
    await uvi_server.shutdown(sockets=[sock])


if __name__ == "__main__":
    asyncio.run(main())
