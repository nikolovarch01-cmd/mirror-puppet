import http.server, time, sys, os
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
HOLD = int(sys.argv[2]) if len(sys.argv) > 2 else 45
class H(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/hold'):
            time.sleep(HOLD)
            self.send_response(200); self.send_header('Content-Type','image/gif'); self.end_headers()
            self.wfile.write(b'GIF89a'); return
        return super().do_GET()
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
