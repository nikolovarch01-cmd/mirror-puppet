"""Renew the build stamp in mirror-puppet.html before a deploy.

Every module address in the page (the import map entries for ./js/*.js and the main script tag) carries the
same ?v= stamp. GitHub Pages lets a browser keep a file for ten minutes, and phones drop files from their
cache one by one, so without the stamp a phone could run an old core.js with a new main.js. A new stamp makes
the page ask for a fresh set of files as one unit. The stamp is shown in Settings as "build …" and is
window.mirrorPuppet.build, so a phone screenshot tells which build it runs.

    py tools\\stamp.py            write a new stamp (local time, YYYYMMDD-HHMM) and print it
    py tools\\stamp.py --show     print the current stamp only
    py tools\\stamp.py --check    exit 1 if the js/ files are newer than the stamp (a deploy without a stamp)

The routine before a push: py tools\\stamp.py, then commit the page together with the js/ changes.
"""
import datetime, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(ROOT, "mirror-puppet.html")
STAMP_RE = re.compile(r'(js/[\w-]+\.js\?v=)([\w.-]+)')


def current(text):
    stamps = set(m.group(2) for m in STAMP_RE.finditer(text))
    if len(stamps) != 1:
        sys.exit("the page carries %d different stamps: %s" % (len(stamps), ", ".join(sorted(stamps)) or "none"))
    return stamps.pop()


def main():
    text = open(PAGE, encoding="utf-8").read()
    old = current(text)
    if "--show" in sys.argv:
        print(old); return 0
    if "--check" in sys.argv:
        try: stamped = datetime.datetime.strptime(old, "%Y%m%d-%H%M").timestamp() + 60
        except ValueError: stamped = 0
        newer = [f for f in os.listdir(os.path.join(ROOT, "js")) if f.endswith(".js")
                 and os.path.getmtime(os.path.join(ROOT, "js", f)) > stamped]
        if newer:
            print("stamp %s is older than: %s -- run py tools\\stamp.py before the deploy" % (old, ", ".join(sorted(newer))))
            return 1
        print("stamp %s is newer than every js file" % old); return 0
    new = datetime.datetime.now().strftime("%Y%m%d-%H%M")
    if new == old:
        new = new + "a"
    text, n = STAMP_RE.subn(lambda m: m.group(1) + new, text)
    open(PAGE, "w", encoding="utf-8", newline="\n").write(text)
    print("stamp %s -> %s (%d addresses)" % (old, new, n))
    return 0


if __name__ == "__main__":
    sys.exit(main())
