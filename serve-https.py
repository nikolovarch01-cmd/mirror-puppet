"""Serves the Mirror Puppet page over https on the local network, so a phone can use its camera.

Run:  py serve-https.py          (or double-click start-for-phone.cmd)
Then on the phone, on the same Wi-Fi, open the address that is printed.
The phone will warn about the certificate once (it is self-signed) - tap "Advanced" / "Proceed".
"""
import http.server, re, ssl, socket, os, subprocess, sys

PORT = 8443
HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = "mirror-puppet.html"
CERT, KEY = os.path.join(HERE, "cert.pem"), os.path.join(HERE, "key.pem")
OPENSSL = [p for p in ("openssl",
                       r"C:\Program Files\Git\usr\bin\openssl.exe",
                       r"C:\Program Files\Git\mingw64\bin\openssl.exe") if p == "openssl" or os.path.exists(p)]


def make_cert():
    if os.path.exists(CERT) and os.path.exists(KEY):
        return
    for exe in OPENSSL:
        try:
            subprocess.run([exe, "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", KEY, "-out", CERT,
                            "-days", "3650", "-subj", "/CN=Mirror Puppet"], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return
        except Exception:
            continue
    sys.exit("Не мога да направя сертификат: няма openssl. Инсталирай Git for Windows или сложи cert.pem и key.pem тук.")


def lan_ips():
    ips = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127.") and ip not in ips:
                ips.append(ip)
    except Exception:
        pass
    # the address actually used to reach the outside world goes first
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        main = s.getsockname()[0]
        s.close()
        if main in ips:
            ips.remove(main)
        ips.insert(0, main)
    except Exception:
        pass
    return ips


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=HERE, **kw)

    def _route(self):
        """True when the request was answered here (redirect or refusal)."""
        if self.path in ("/", ""):
            self.send_response(302)
            self.send_header("Location", "/" + PAGE)
            self.end_headers()
            return True
        # only the page, its modules (js/) and its models (assets/) are served -- never the key, the tools or a folder listing
        path = self.path.split("?")[0]
        if path != "/" + PAGE and not re.fullmatch(r"/js/[\w-]+\.js", path) and not re.fullmatch(r"/assets/[\w.-]+", path):
            self.send_error(404)
            return True
        return False

    def do_GET(self):
        if not self._route():
            super().do_GET()

    def do_HEAD(self):
        if not self._route():
            super().do_HEAD()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        print(self.address_string(), fmt % args)


if __name__ == "__main__":
    os.chdir(HERE)
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
        except Exception:
            pass
    make_cert()
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(CERT, KEY)
    host = "127.0.0.1" if "--local" in sys.argv else "0.0.0.0"
    httpd = http.server.ThreadingHTTPServer((host, PORT), Handler)
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    print("Огледална кукла - адрес за телефона (същото Wi-Fi):")
    for ip in lan_ips():
        print("    https://%s:%d/" % (ip, PORT))
    print("На телефона: при предупреждението за сертификата натисни 'Advanced' и 'Proceed'.")
    print("Прозорецът трябва да стои отворен, докато ползваш страницата. Ctrl+C го спира.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
