import argparse
import errno
import http.server
import socketserver
import threading
import time
import webbrowser
from functools import partial
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent
DEFAULT_PAGE = "payroll-calculator.html"


def _is_client_disconnect(err: OSError) -> bool:
    """True when the browser closed the connection before the response finished."""
    if getattr(err, "winerror", None) == 10053:
        return True
    if err.errno in (errno.EPIPE, errno.ECONNABORTED, errno.ECONNRESET, errno.ESHUTDOWN):
        return True
    return False


class AppRequestHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path in {"", "/"}:
            self.path = f"/{DEFAULT_PAGE}"
        try:
            return super().do_GET()
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            return
        except OSError as e:
            if _is_client_disconnect(e):
                return
            raise

    def copyfile(self, source, outputfile):
        """Avoid traceback spam when the client aborts mid-download (refresh, tab close, etc.)."""
        try:
            return super().copyfile(source, outputfile)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            return
        except OSError as e:
            if _is_client_disconnect(e):
                return
            raise


def parse_args():
    parser = argparse.ArgumentParser(
        description="Serve the payroll calculator locally and open it in a browser."
    )
    parser.add_argument(
        "--host",
        default="",
        help="Host interface to bind to. Default: all interfaces (use 127.0.0.1 to limit to loopback).",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="Starting port to try. Default: 8000",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Start the server without opening a browser window.",
    )
    return parser.parse_args()


def create_server(host: str, starting_port: int):
    handler = partial(AppRequestHandler, directory=str(ROOT_DIR))

    for port in range(starting_port, starting_port + 20):
        try:
            httpd = socketserver.TCPServer((host, port), handler)
            return httpd, port
        except OSError:
            continue

    raise OSError(f"Could not bind to any port between {starting_port} and {starting_port + 19}.")


def main():
    args = parse_args()
    httpd, port = create_server(args.host, args.port)
    # Prefer IPv4 loopback in links so browsers that resolve localhost to ::1 still work when only IPv4 is bound
    link_host = "127.0.0.1" if args.host in ("", "0.0.0.0") else args.host
    url = f"http://{link_host}:{port}/{DEFAULT_PAGE}"

    print(f"Serving {ROOT_DIR}")
    print(f"Open in browser: {url}")
    print("Press Ctrl+C to stop.")

    if not args.no_browser:
        threading.Thread(
            target=lambda: (time.sleep(0.5), webbrowser.open(url)),
            daemon=True,
        ).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server.")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
