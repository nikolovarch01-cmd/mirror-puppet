"""Write CODE_MAP.md: what is where in the code, generated from the files themselves so it cannot go stale.

    py tools\\codemap.py            rewrite CODE_MAP.md (prints "code map: unchanged" or "code map: updated")
    py tools\\codemap.py --check    exit 1 if CODE_MAP.md is behind the code (nothing written)

tools/check.py runs this after every check. The block between the "hand-written" markers in CODE_MAP.md is
kept as it is: it holds the notes that cannot be derived from the code (where to look for what, the seams).
Everything below the markers is generated: per module its purpose (the comment at the top of the file), what
it imports from whom, what it exports, and every top-level declaration and event wiring with its line number
and the comment above it; then the page's elements by id.
"""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS = os.path.join(ROOT, "js")
OUT = os.path.join(ROOT, "CODE_MAP.md")
ORDER = ["core", "engines", "threads", "skeleton", "eyes", "character", "phone", "overlay", "camera", "monitor", "main"]
HAND_START, HAND_END = "<!-- hand-written: start -->", "<!-- hand-written: end -->"
DEFAULT_HAND = """# Mirror Puppet — code map

The page is `mirror-puppet.html` (style, markup, the import map with the pinned addresses and the build stamp,
one module tag); the code is in `js/`, one file per section, loaded as ES modules. No build step.
"""
DECL = re.compile(r"^(?:export\s+)?(async\s+function|function|class|const|let|var)\s+([\w$]+)(\s*\([^)]*\))?")
WIRE = re.compile(r"^([\w$.'()]+)\.(on\w+)\s*=|^([\w$.'()]+)\.addEventListener\(\s*'(\w+)'|^new ResizeObserver\(")
SECTION = re.compile(r"^// -{10,}\s*(.*)$")


def module_map(name):
    path = os.path.join(JS, name + ".js")
    lines = open(path, encoding="utf-8").read().split("\n")
    purpose, i = [], 0
    while i < len(lines) and lines[i].startswith("//"):
        purpose.append(lines[i][2:].strip()); i += 1
    text = "\n".join(lines)
    imports = re.findall(r"import\s+(?:\{([^}]*)\}|\*\s+as\s+(\w+))\s+from\s+'([^']+)'", text)
    exports = []
    for m in re.finditer(r"export\s*\{([^}]*)\}", text):
        exports += [n.strip() for n in m.group(1).split(",") if n.strip()]
    out = ["## `js/%s.js`" % name, ""]
    if purpose:
        p = " ".join(purpose)
        p = p.replace("Mirror Puppet — ", "", 1)
        out += [p, ""]
    imp_lines = []
    for names, star, src in imports:
        n = [x.strip() for x in names.split(",") if x.strip()] if names else [star]
        label = src[2:-3] if src.startswith("./") else src
        imp_lines.append("`%s` (%d: %s)" % (label, len(n), ", ".join(n)) if len(n) <= 6 else "`%s` (%d names)" % (label, len(n)))
    out += ["- imports from: " + ("; ".join(imp_lines) if imp_lines else "nothing")]
    out += ["- exports: " + (", ".join("`%s`" % e for e in exports) if exports else "nothing"), ""]
    # declarations and wiring, grouped by section marker
    rows, section_open = [], False
    prev_comment = []
    in_header = True
    for k, ln in enumerate(lines, 1):
        if in_header and (ln.startswith("//") or ln.startswith("import") or ln.strip() == "" or ln.startswith("  ")):
            continue
        in_header = False
        sm = SECTION.match(ln)
        if sm:
            rows.append(("section", k, sm.group(1).strip(), ""))
            prev_comment = []; continue
        if ln.startswith("//"):
            prev_comment.append(ln[2:].strip()); continue
        if ln.startswith("export") or ln.startswith("import"):
            prev_comment = []; continue
        dm = DECL.match(ln)
        if dm:
            kind, ident, sig = dm.group(1), dm.group(2), dm.group(3) or ""
            comment = " ".join(prev_comment)
            trail = re.search(r"(?<=[\s;])//\s*(.*)$", ln)      # a trailing comment, not the // of an address
            if not comment and trail and "http" not in trail.group(1):
                comment = trail.group(1).strip()
            more = ""
            if kind in ("const", "let", "var"):
                rest = ln[dm.end():]
                others = re.findall(r",\s*([\w$]+)\s*=", rest)
                if others:
                    more = ", " + ", ".join(others)
            rows.append((kind.replace("async function", "async"), k, ident + sig + more, comment[:140]))
            prev_comment = []; continue
        wm = WIRE.match(ln)
        if wm:
            if wm.group(1): what = "%s.%s" % (wm.group(1), wm.group(2))
            elif wm.group(3): what = "%s '%s'" % (wm.group(3), wm.group(4))
            else: what = "ResizeObserver"
            rows.append(("wiring", k, what, " ".join(prev_comment)[:140]))
            prev_comment = []; continue
        if ln.strip() and not ln.startswith(" ") and not ln.startswith("}") and not ln.startswith(")"):
            # a top-level statement that is neither a declaration nor a wiring (start-up calls, for loops)
            rows.append(("statement", k, ln.strip()[:90], " ".join(prev_comment)[:140]))
        if ln.strip():
            prev_comment = []
    for kind, k, what, comment in rows:
        if kind == "section":
            out += ["", "**%s**" % what, ""]
        else:
            tag = {"function": "fn", "async": "async fn", "const": "const", "let": "let", "var": "var", "class": "class",
                   "wiring": "on", "statement": "run"}[kind]
            out.append("- L%d `%s` %s%s" % (k, tag, "`%s`" % what if kind != "statement" else "`%s`" % what, (" — " + comment) if comment else ""))
    out.append("")
    return out


def page_map():
    path = os.path.join(ROOT, "mirror-puppet.html")
    lines = open(path, encoding="utf-8").read().split("\n")
    out = ["## `mirror-puppet.html` — elements by id", ""]
    for k, ln in enumerate(lines, 1):
        for m in re.finditer(r"<(\w+)[^>]*\bid=\"([\w-]+)\"", ln):
            title = re.search(r'title="([^"]*)"', ln[m.start():])
            out.append("- L%d `#%s` %s%s" % (k, m.group(2), m.group(1), (" — " + title.group(1)) if title and title.start() < 200 else ""))
    out.append("")
    return out


def build():
    hand = DEFAULT_HAND
    if os.path.isfile(OUT):
        old = open(OUT, encoding="utf-8").read()
        if HAND_START in old and HAND_END in old:
            hand = old.split(HAND_START, 1)[1].split(HAND_END, 1)[0]
    body = [HAND_START + hand + HAND_END, "", "<!-- everything below is generated by tools/codemap.py — edit the code, not this -->", ""]
    body += ["## Files", "", "| file | lines | what |", "|---|---|---|"]
    for name in ORDER:
        lines = open(os.path.join(JS, name + ".js"), encoding="utf-8").read().split("\n")
        purpose = []
        for ln in lines:
            if not ln.startswith("//"): break
            purpose.append(ln[2:].strip())
        body.append("| `js/%s.js` | %d | %s |" % (name, len(lines) - 1, " ".join(purpose).replace("Mirror Puppet — ", "", 1)))
    page = open(os.path.join(ROOT, "mirror-puppet.html"), encoding="utf-8").read().split("\n")
    body.append("| `mirror-puppet.html` | %d | style, markup, import map + build stamp, the module tag |" % (len(page) - 1))
    body.append("")
    for name in ORDER:
        body += module_map(name)
    body += page_map()
    return "\n".join(body) + "\n"


def main():
    new = build()
    old = open(OUT, encoding="utf-8").read() if os.path.isfile(OUT) else ""
    if "--check" in sys.argv:
        print("code map: %s" % ("up to date" if new == old else "BEHIND THE CODE -- run py tools\\codemap.py"))
        return 0 if new == old else 1
    if new != old:
        open(OUT, "w", encoding="utf-8", newline="\n").write(new)
    print("code map: %s (%s)" % ("updated" if new != old else "unchanged", os.path.relpath(OUT, ROOT)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
