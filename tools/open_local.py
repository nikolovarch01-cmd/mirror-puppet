"""Open the page on this computer (double-click open-local.cmd).

Since the code was split into modules the browser refuses to load them from a file:// address, so the page
needs a local web server. This starts one on 127.0.0.1 (this computer only, never the network), port 8770,
and opens the page in the default browser. http://127.0.0.1 counts as a secure address, so the camera works.
If the server is already running (a second double-click), only the browser is opened. Close the window to
stop the server. Nothing is written to disk by this server.
"""
import http.server, os, socket, sys, threading, webbrowser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8770
URL = "http://127.0.0.1:%d/mirror-puppet.html" % PORT


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")     # always the file as it is on disk (F5 is enough)
        super().end_headers()

    def log_message(self, *a):
        pass


def port_open(port):
    try:
        socket.create_connection(("127.0.0.1", port), 0.3).close(); return True
    except OSError:
        return False


def main():
    for stream in (sys.stdout, sys.stderr):
        try: stream.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
        except Exception: pass
    if port_open(PORT):
        print("server already running, opening", URL); webbrowser.open(URL); return 0
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H)
    threading.Timer(0.4, lambda: webbrowser.open(URL)).start()
    print("Mirror Puppet at", URL)
    print("Keep this window open while you use the page; close it to stop.")
    try: httpd.serve_forever()
    except KeyboardInterrupt: pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
