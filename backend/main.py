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

HTTP_200 = (
    b"HTTP/1.1 200 OK\r\n"
    b"Content-Type: application/json\r\n"
    b"Content-Length: 15\r\n"
    b"Connection: close\r\n"
    b"\r\n"
    b'{"status":"ok"}'
)


async def health_handler(reader, writer):
    try:
        await asyncio.wait_for(reader.readline(), timeout=2)
        writer.write(HTTP_200)
        await writer.drain()
    except Exception:
        pass
    finally:
        try:
            writer.close()
        except Exception:
            pass


def _load_all():
    print("Loading full application...", flush=True)
    import uvicorn as uvi
    from server import app as real
    print("Full application loaded!", flush=True)
    return uvi, real


async def main():
    health_sock = socket.socket(fileno=os.dup(sock.fileno()))
    health_sock.setblocking(False)
    health_server = await asyncio.start_server(health_handler, sock=health_sock)
    print("Health check server ready", flush=True)

    loop = asyncio.get_running_loop()
    uvi_mod, real_app = await loop.run_in_executor(None, _load_all)

    health_server.close()
    await health_server.wait_closed()

    config = uvi_mod.Config(real_app, host="0.0.0.0", port=5000, log_level="info")
    server = uvi_mod.Server(config)
    config.load()
    server.lifespan = config.lifespan_class(config)
    await server.startup(sockets=[sock])
    await server.main_loop()
    await server.shutdown(sockets=[sock])


if __name__ == "__main__":
    asyncio.run(main())
