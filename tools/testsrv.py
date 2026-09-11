import http.server, sys, base64, os
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
class H(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(n).decode()
        name = os.path.basename(self.path.split('/save/', 1)[-1])
        if ',' in body: body = body.split(',', 1)[1]
        with open(name, 'wb') as f: f.write(base64.b64decode(body))
        self.send_response(200); self.end_headers(); self.wfile.write(b'ok')
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
