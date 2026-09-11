"""One-command headless check for Mirror Puppet (Windows, Python 3.11).

(No shebang on purpose: the py launcher would follow `#!/usr/bin/env python3` to the
Windows Store `python3` stub, which prints "Python was not found".)

    py tools\\check.py            desktop harness (tools/harness.html)
    py tools\\check.py --avatar   character/rig harness (tools/avatar-harness.html)
    py tools\\check.py --phone    390x844 window + iPhone user agent (adds ?phone for --avatar)
    py tools\\check.py --fresh    delete the persistent Chrome profile first (re-downloads the models)
    py tools\\check.py --keep     leave Chrome and the server running (prints their PIDs)
    py tools\\check.py --timeout 150

Starts tools/testsrv.py on a free port serving the repo root, runs headless Chrome with a
fake camera against the harness page, reads Chrome's stderr live and stops as soon as the
harness prints DONE or ERROR. The profile %TEMP%\\mirror-puppet-check-profile is kept between
runs so the page's IndexedDB store keeps the models (~33 MB): the second run must print
"files from the local store: 5". PNGs posted by the harness land in the repo root.
Exit code 0 only if DONE was reached and no error line appeared.
"""
import argparse
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PROFILE = os.path.join(os.environ.get("TEMP", ROOT), "mirror-puppet-check-profile")
IPHONE_UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 "
             "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")
DONE_MARKS = ("HARNESS DONE", "HARNESS ERROR", "AVATAR_DONE", "AVATAR_ERROR")
OK_MARKS = ("HARNESS DONE", "AVATAR_DONE")
ERROR_WORDS = ("Uncaught", "TypeError", "ReferenceError", "SyntaxError", "engine failed", "detect failed")
# Chrome writes console lines as `[pid:tid:date:INFO:CONSOLE:4] "text", source: url (4)`;
# older builds wrote `CONSOLE(4)]` -- both forms are stripped.
CONSOLE_PREFIX = re.compile(r'^.*CONSOLE(?::\d+|\(\d+\))\] "')
CONSOLE_SUFFIX = re.compile(r'", source: .*$')
DEVNULL = subprocess.DEVNULL


def free_port(preferred=8765):
    for port in (preferred, 0):
        s = socket.socket()
        try:
            s.bind(("127.0.0.1", port))
            return s.getsockname()[1]
        except OSError:
            continue
        finally:
            s.close()
    raise SystemExit("no free port")


def wait_port(port, seconds=10):
    end = time.time() + seconds
    while time.time() < end:
        try:
            socket.create_connection(("127.0.0.1", port), 0.3).close()
            return True
        except OSError:
            time.sleep(0.1)
    return False


def kill_tree(proc):
    """Stop a process by PID (with its children on Windows). Never by image name."""
    if proc.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], stdout=DEVNULL, stderr=DEVNULL)
    else:
        proc.terminate()
    try:
        proc.wait(10)
    except subprocess.TimeoutExpired:
        proc.kill()


def strip_console(line):
    return CONSOLE_SUFFIX.sub("", CONSOLE_PREFIX.sub("", line))


def main():
    ap = argparse.ArgumentParser(description="headless check for Mirror Puppet")
    ap.add_argument("--avatar", action="store_true", help="run tools/avatar-harness.html")
    ap.add_argument("--phone", action="store_true", help="390x844 window + iPhone user agent")
    ap.add_argument("--fresh", action="store_true", help="delete the persistent profile first")
    ap.add_argument("--keep", action="store_true", help="leave Chrome and the server running")
    ap.add_argument("--timeout", type=float, default=150, help="seconds to wait for DONE (default 150)")
    ap.add_argument("--port", type=int, default=8765, help="preferred server port (default 8765)")
    ap.add_argument("--log", metavar="FILE", help="also write Chrome's full stderr to FILE")
    args = ap.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")    # status text has "·" and "×"; never die on the console codepage

    if not os.path.isfile(CHROME):
        print("Chrome not found:", CHROME)
        return 2
    if args.fresh:
        shutil.rmtree(PROFILE, ignore_errors=True)
    warm = os.path.isdir(os.path.join(PROFILE, "Default"))

    page = "tools/avatar-harness.html" if args.avatar else "tools/harness.html"
    if args.avatar and args.phone:
        page += "?phone"
    port = free_port(args.port)
    url = "http://127.0.0.1:%d/%s" % (port, page)

    t0 = time.time()
    server = subprocess.Popen([sys.executable, os.path.join(ROOT, "tools", "testsrv.py"), str(port)],
                              cwd=ROOT, stdout=DEVNULL, stderr=DEVNULL)
    chrome = None
    lines = []           # raw stderr lines from Chrome
    done = threading.Event()
    t_done = [None]
    try:
        if not wait_port(port):
            print("server did not start on port", port)
            return 2
        width, height = (390, 844) if args.phone else (1400, 800)
        cmd = [CHROME, "--headless=new", "--no-first-run", "--window-size=%d,%d" % (width, height),
               "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
               "--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader",
               "--enable-logging=stderr", "--v=0", "--user-data-dir=" + PROFILE]
        if args.phone:
            cmd.append("--user-agent=" + IPHONE_UA)
        cmd.append(url)
        print("check: %s  port %d  window %dx%d  profile %s (%s)" % (
            page, port, width, height, PROFILE, "warm" if warm else "fresh"))
        chrome = subprocess.Popen(cmd, cwd=ROOT, stdout=DEVNULL, stderr=subprocess.PIPE)

        def reader():
            for raw in chrome.stderr:
                line = raw.decode("utf-8", "replace").rstrip("\r\n")
                lines.append(line)
                if any(m in line for m in DONE_MARKS) and not done.is_set():
                    t_done[0] = time.time() - t0
                    done.set()
            done.set()

        threading.Thread(target=reader, daemon=True).start()
        finished = done.wait(args.timeout)
        if finished and chrome.poll() is None:
            time.sleep(0.5)    # let the last stderr lines through
    finally:
        if args.keep:
            print("--keep: Chrome PID %s and server PID %s (port %d) left running" % (
                chrome.pid if chrome else "-", server.pid, port))
        else:
            if chrome:
                kill_tree(chrome)
            kill_tree(server)
    elapsed = time.time() - t0
    if args.log:
        with open(args.log, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")

    # ---- summary ----
    summary, errors, saved = [], [], []
    in_msg = False
    for line in lines:
        is_console = bool(CONSOLE_PREFIX.match(line))
        text = strip_console(line)
        keep = False
        if is_console:
            in_msg = '", source: ' not in line          # multi-line console message continues
            keep = text.startswith("HARNESS") or "files from the local store" in text
        elif in_msg:
            keep = True                                   # continuation (stack trace) of a console line
            if '", source: ' in line:
                in_msg = False
        is_error = any(w in text for w in ERROR_WORDS) or "HARNESS ERROR" in text or "AVATAR_ERROR" in text
        if is_error:
            errors.append(text)
            keep = True
        if keep:
            summary.append(text)
        m = re.match(r"HARNESS saved (\S+) (\d+)$", text)
        if m:
            saved.append(m.group(1) + ("" if m.group(2) == "200" else " (HTTP %s)" % m.group(2)))

    for text in summary:
        print(text)
    reached = any(any(m in l for m in OK_MARKS) for l in lines)
    ended = any(any(m in l for m in DONE_MARKS) for l in lines)
    print("-- errors: %s" % ("none" if not errors else "%d line(s), see above" % len(errors)))
    if saved:
        sizes = []
        for name in saved:
            p = os.path.join(ROOT, name.split(" ")[0])
            sizes.append("%s %s" % (name, ("%d B" % os.path.getsize(p)) if os.path.isfile(p) else "MISSING"))
        print("-- PNGs in %s: %s" % (ROOT, ", ".join(sizes)))
    else:
        print("-- PNGs: none posted")
    status = "PASS" if reached and not errors else ("FAIL" if ended else "TIMEOUT")
    print("-- elapsed %.1f s%s  result: %s" % (
        elapsed, (" (DONE at %.1f s)" % t_done[0]) if t_done[0] else "", status))
    return 0 if status == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
