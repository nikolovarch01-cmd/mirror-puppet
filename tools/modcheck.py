"""Static check of the js/ modules: every name a module uses that is declared at the top of ANOTHER module
must be imported; every import must name a real export; every export must be declared; no name is declared
at the top of two modules; unused imports are listed. Approximate (a regex tokenizer, no parser): a local
variable that happens to share a name with another module's top-level name shows up as a false positive —
read the list, do not trust it blindly. Exit 1 on a missing import / bad export / duplicate.

    py tools\\modcheck.py
"""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "js")   # another folder can be checked (tests of the checker)
KEYWORDS = set("""break case catch class const continue debugger default delete do else export extends finally for
function if import in instanceof new return super switch this throw try typeof var void while with yield let static
async await of get set null true false undefined NaN Infinity""".split())
IDENT = re.compile(r"[A-Za-z_$][\w$]*")


def strip(src):
    """Remove comments and string literals (template expressions are kept)."""
    out, i, n = [], 0, len(src)
    while i < n:
        c = src[i]
        if c == "/" and i + 1 < n and src[i + 1] == "/":
            j = src.find("\n", i); i = n if j < 0 else j; continue
        if c == "/" and i + 1 < n and src[i + 1] == "*":
            j = src.find("*/", i + 2); i = n if j < 0 else j + 2; out.append(" "); continue
        if c in "'\"`":
            q, j = c, i + 1
            while j < n and src[j] != q:
                if src[j] == "\\": j += 2; continue
                if q == "`" and src[j] == "$" and j + 1 < n and src[j + 1] == "{":
                    depth, k = 1, j + 2
                    while k < n and depth:
                        depth += {"{": 1, "}": -1}.get(src[k], 0); k += 1
                    out.append(" " + src[j + 2:k - 1] + " "); j = k; continue
                j += 1
            out.append('""'); i = j + 1; continue
        if c == "\n": out.append("\n")
        else: out.append(c)
        i += 1
    return "".join(out)


def split_top(s):
    """Split a declarator list at depth-0 commas."""
    parts, depth, cur = [], 0, []
    for ch in s:
        if ch in "([{": depth += 1
        elif ch in ")]}": depth -= 1
        if ch == "," and depth <= 0: parts.append("".join(cur)); cur = []
        else: cur.append(ch)
    parts.append("".join(cur))
    return parts


def top_level_names(lines):
    names = []
    for ln in lines:
        m = re.match(r"^(?:export\s+)?(?:async\s+)?(const|let|var|function|class)\s+(.*)$", ln)
        if not m: continue
        kind, rest = m.group(1), m.group(2)
        if kind in ("function", "class"):
            mm = IDENT.match(rest)
            if mm: names.append(mm.group(0))
            continue
        rest = rest.rstrip(";")
        for part in split_top(rest):
            part = part.strip()
            if not part: continue
            mm = IDENT.match(part)
            if mm: names.append(mm.group(0))
    return names


def header_lines(lines):
    """Indexes of import/export statement lines (including continuation lines up to the ';')."""
    idx, i = set(), 0
    while i < len(lines):
        if re.match(r"^\s*(import|export)\b", lines[i]):
            j = i
            while j < len(lines) and ";" not in lines[j]: j += 1
            idx.update(range(i, j + 1)); i = j + 1
        else: i += 1
    return idx


def parse_imports(text):
    """[(names, module)] for `import {..} from '..'` and `import * as X from '..'`."""
    out = []
    for m in re.finditer(r"import\s+(?:\{([^}]*)\}|\*\s+as\s+(\w+))\s+from\s+['\"]([^'\"]+)['\"]", text):
        if m.group(2): names = [m.group(2)]
        else: names = [n.strip().split(" as ")[-1].strip() for n in m.group(1).split(",") if n.strip()]
        out.append((names, m.group(3)))
    return out


def parse_exports(text):
    names = []
    for m in re.finditer(r"export\s*\{([^}]*)\}", text): names += [n.strip() for n in m.group(1).split(",") if n.strip()]
    for m in re.finditer(r"^export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([\w$]+)", text, re.M): names.append(m.group(1))
    return names


def free_identifiers(stripped_lines, skip):
    used = set()
    for i, ln in enumerate(stripped_lines):
        if i in skip: continue
        for m in IDENT.finditer(ln):
            name = m.group(0)
            if name in KEYWORDS: continue
            before = ln[:m.start()].rstrip()
            after = ln[m.end():].lstrip()
            if before.endswith(".") and not before.endswith("..."): continue   # property access (a spread is a use)
            if after.startswith(":") and not after.startswith("::") and (before.endswith("{") or before.endswith(",") or before == ""):
                continue                                           # object key
            if before.endswith("function") or before.endswith("class"): continue
            used.add(name)
    return used


def main():
    mods = {}
    for fn in sorted(os.listdir(JS)):
        if not fn.endswith(".js"): continue
        text = open(os.path.join(JS, fn), encoding="utf-8").read()
        stripped = strip(text)
        s_lines = stripped.split("\n")
        skip = header_lines(text.split("\n"))
        mods[fn] = dict(text=text, stripped=stripped, top=top_level_names([l for i, l in enumerate(s_lines) if i not in skip]),
                        imports=parse_imports(text), exports=parse_exports(text), used=free_identifiers(s_lines, skip))
    problems, notes = [], []
    owner = {}
    for fn, m in mods.items():
        for n in m["top"]:
            if n in owner: problems.append("%s: top-level %s is also declared in %s" % (fn, n, owner[n]))
            owner[n] = fn
    for fn, m in mods.items():
        imported = {}
        for names, src in m["imports"]:
            if src.startswith("./"):
                target = src[2:]
                if target not in mods: problems.append("%s: imports from unknown module %s" % (fn, src)); continue
                for n in names:
                    if n not in mods[target]["exports"]: problems.append("%s: imports %s which %s does not export" % (fn, n, target))
            for n in names: imported[n] = src
        for n in m["exports"]:
            if n not in m["top"]: problems.append("%s: exports %s which is not declared at its top level" % (fn, n))
        for n in imported:
            if n not in m["used"]: notes.append("%s: import %s is unused" % (fn, n))
        for n in sorted(m["used"]):
            if n in owner and owner[n] != fn and n not in imported and n not in m["top"]:
                problems.append("%s: uses %s (top-level in %s) without importing it" % (fn, n, owner[n]))
    for fn, m in mods.items():
        print("%-13s top-level %3d  exports %3d  imports %3d" % (fn, len(m["top"]), len(m["exports"]), sum(len(n) for n, _ in m["imports"])))
    for n in notes: print("note:", n)
    for p in problems: print("PROBLEM:", p)
    print("-- modcheck: %s" % ("OK" if not problems else "%d problem(s)" % len(problems)))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
